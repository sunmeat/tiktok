import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import type { ArenaPlayer, ChatMessage, GiftAlert, NormalizedGameEvent, ServerMessage } from "@tiktok-arena/shared";
import {
  AQUALIFE_CONFIG,
  BoundedEventDeduplicator,
  BoundedGameEventQueue,
  normalizeTikTokEvent
} from "@tiktok-arena/shared";
import type { NormalizedGameEventType } from "@tiktok-arena/shared";
import { STREAMER_USERNAME } from "./config.js";

type RecordData = Record<string, any>;
const dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve env files from this module, not from the shell working directory.
// server/.env takes precedence over the repository-root .env; existing process env wins.
dotenv.config({ path: [path.resolve(dirname, "../.env"), path.resolve(dirname, "../../.env")], override: false });

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const players = new Map<string, ArenaPlayer>();
const reconnectDelay = 30_000;
const eventQueue = new BoundedGameEventQueue(AQUALIFE_CONFIG.maxQueuedEvents, 100);
const eventDeduplicator = new BoundedEventDeduplicator(AQUALIFE_CONFIG.maxQueuedEvents * 2);
const eventTypeCounts: Record<NormalizedGameEventType, number> = {
  "viewer-joined": 0,
  "viewer-left": 0,
  like: 0,
  follow: 0,
  subscribe: 0,
  gift: 0,
  chat: 0
};
const trackedParticipants = new Map<string, number>();
const maxTrackedParticipants = 10_000;
const diagnostics = {
  acceptedEvents: 0,
  invalidEvents: 0,
  duplicateEvents: 0,
  deliveredGameEvents: 0,
  queueDrops: 0,
  reconnectAttempts: 0,
  connectionErrors: 0,
  clientMessageErrors: 0
};

let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connecting = false;
let connected = false;
let shuttingDown = false;
const activeUsername = STREAMER_USERNAME.trim().replace(/^@/, "");
let tiktok: TikTokLiveConnection | undefined;

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({
  status: "ok",
  tiktokConnected: connected,
  username: activeUsername || null,
  clients: wss.clients.size,
  diagnostics: {
    ...diagnostics,
    eventTypes: { ...eventTypeCounts },
    trackedParticipants: trackedParticipants.size,
    fishEntitiesExpected: trackedParticipants.size,
    eventQueueLength: eventQueue.length,
    eventQueueCapacity: eventQueue.capacity,
    eventQueueBatchSize: eventQueue.batchSize,
    eventQueueDroppedTotal: eventQueue.dropped,
    dedupeCacheSize: eventDeduplicator.size
  }
}));
const clientDist = path.resolve(dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("/{*path}", (_req, res, next) => {
  res.sendFile(path.join(clientDist, "index.html"), error => { if (error) next(); });
});

function send(client: WebSocket, message: ServerMessage): void {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}
function broadcast(message: ServerMessage): void {
  for (const client of wss.clients) send(client, message);
}
function publishConnectionStatus(isConnected: boolean): void {
  broadcast({ type: "connection_status", data: { connected: isConnected, username: activeUsername || "searching" } });
}
function redact(value: unknown): string {
  let message = value instanceof Error ? value.message : String(value ?? "Unknown error");
  const key = process.env.SIGN_API_KEY;
  if (key) message = message.split(key).join("[redacted]");
  return message.slice(0, 500);
}
function rememberParticipant(userId: string): void {
  trackedParticipants.delete(userId);
  trackedParticipants.set(userId, Date.now());
  if (trackedParticipants.size > maxTrackedParticipants) {
    const oldest = trackedParticipants.keys().next().value as string | undefined;
    if (oldest !== undefined) trackedParticipants.delete(oldest);
  }
}
function ingestEvent(
  kind: "member" | "like" | "follow" | "subscribe" | "gift" | "chat",
  payload: unknown
): NormalizedGameEvent | null {
  const event = normalizeTikTokEvent(kind, payload);
  if (!event) {
    diagnostics.invalidEvents += 1;
    return null;
  }
  if (eventDeduplicator.has(event.dedupeKey)) {
    diagnostics.duplicateEvents += 1;
    return null;
  }
  eventDeduplicator.remember(event.dedupeKey);
  diagnostics.acceptedEvents += 1;
  eventTypeCounts[event.type] += 1;
  rememberParticipant(event.userId);

  const result = eventQueue.enqueue(event);
  diagnostics.queueDrops += result.dropped;
  return event;
}

// Batch delivery on a single managed timer prevents event bursts from immediately
// flooding the overlay. The queue is bounded and never blocks legacy chat/leaderboard updates.
const eventFlushTimer = setInterval(() => {
  const batch = eventQueue.drainBatch();
  for (const event of batch) {
    broadcast({ type: "aqualife_event", data: event });
    diagnostics.deliveredGameEvents += 1;
  }
}, 50);
eventFlushTimer.unref();

function userId(user?: RecordData): string {
  return String(user?.userId || user?.id || user?.secUid || user?.uniqueId || user?.displayId || "unknown");
}
function leaderboard(): ArenaPlayer[] {
  return [...players.values()].sort((a, b) => b.score - a.score);
}
function updatePlayer(
  id: string,
  points: number,
  avatarUrl: string,
  nickname: string,
  activity: { likes?: number; comments?: number; gifts?: number; isFollowing?: boolean } = {}
): void {
  let player = players.get(id);
  if (!player) {
    player = { uniqueId: id, nickname: nickname || id, profilePictureUrl: avatarUrl, score: 0, likes: 0, comments: 0, gifts: 0, isFollowing: false };
    players.set(id, player);
  }
  player.score += points;
  if (avatarUrl) player.profilePictureUrl = avatarUrl;
  if (nickname) player.nickname = nickname;
  player.likes += activity.likes ?? 0;
  player.comments += activity.comments ?? 0;
  player.gifts += activity.gifts ?? 0;
  if (activity.isFollowing) player.isFollowing = true;
  broadcast({ type: "update_leaderboard", data: leaderboard() });
}

wss.on("connection", client => {
  console.log("[overlay] Browser Source connected");
  send(client, { type: "init", data: leaderboard() });
  send(client, { type: "connection_status", data: { connected, username: activeUsername || "searching" } });
  client.on("message", raw => {
    try {
      if (JSON.parse(raw.toString()).type === "ping") client.send(JSON.stringify({ type: "pong" }));
    } catch {
      diagnostics.clientMessageErrors += 1;
      console.warn("[ws] Invalid client message ignored");
    }
  });
});

function createConnection(username: string): TikTokLiveConnection {
  return new TikTokLiveConnection(username, {
    ...(process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {})
  });
}

function scheduleReconnect(delay = reconnectDelay): void {
  if (shuttingDown || reconnectTimer) return;
  diagnostics.reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectToTikTok();
  }, Math.max(1_000, delay));
}

function attachEvents(connection: TikTokLiveConnection, username: string): void {
  // v2.5.0 exposes .on() at runtime, but its public class type omits the emitter method.
  const onConnectorEvent = (event: string, listener: (...args: any[]) => void): void => {
    (connection as unknown as { on: (name: string, handler: (...args: any[]) => void) => unknown }).on(
      event,
      (...args: any[]) => {
        // Ignore late events from stale connections after reconnect.
        if (tiktok !== connection || shuttingDown) return;
        listener(...args);
      }
    );
  };

  onConnectorEvent(ControlEvent.DISCONNECTED, () => {
    connected = false;
    publishConnectionStatus(false);
    scheduleReconnect();
  });
  onConnectorEvent(ControlEvent.ERROR, (error: unknown) => {
    diagnostics.connectionErrors += 1;
    console.error("[tiktok] Connection error:", redact(error));
  });
  onConnectorEvent(WebcastEvent.STREAM_END, () => {
    connected = false;
    publishConnectionStatus(false);
    console.log(`[tiktok] @${username}'s LIVE ended.`);
    scheduleReconnect();
  });
  onConnectorEvent(WebcastEvent.MEMBER, (data: RecordData) => {
    ingestEvent("member", data);
  });
  onConnectorEvent(WebcastEvent.CHAT, (data: RecordData) => {
    const event = ingestEvent("chat", data);
    if (!event) return;
    const message: ChatMessage = {
      uniqueId: event.userId,
      nickname: event.nickname,
      avatarUrl: event.avatarUrl,
      comment: event.comment ?? "",
      timestamp: event.receivedAtMs
    };
    console.log(`[chat] ${event.nickname}: ${message.comment}`);
    updatePlayer(event.userId, 5, event.avatarUrl, event.nickname, { comments: 1 });
    broadcast({ type: "chat_message", data: message });
  });
  onConnectorEvent(WebcastEvent.LIKE, (data: RecordData) => {
    const event = ingestEvent("like", data);
    if (!event) return;
    const count = event.count ?? 0;
    updatePlayer(event.userId, Math.max(1, Math.floor(count / 10)), event.avatarUrl, event.nickname, { likes: count });
  });
  if (WebcastEvent.FOLLOW) {
    onConnectorEvent(WebcastEvent.FOLLOW, (data: RecordData) => {
      const event = ingestEvent("follow", data);
      if (!event) return;
      updatePlayer(event.userId, 0, event.avatarUrl, event.nickname, { isFollowing: true });
    });
  }
  onConnectorEvent(WebcastEvent.SUB_NOTIFY, (data: RecordData) => {
    ingestEvent("subscribe", data);
  });
  onConnectorEvent(WebcastEvent.GIFT, (data: RecordData) => {
    const giftType = Number(data.giftDetails?.giftType ?? data.gift?.type);
    // Combo gifts emit intermediate packets. Award only on the connector's final packet.
    if (giftType === 1 && !data.repeatEnd) return;
    const event = ingestEvent("gift", data);
    if (!event) return;
    const giftDetails = data.giftDetails ?? {};
    const gift = data.gift ?? {};
    const diamonds = Number(giftDetails.diamondCount ?? gift.diamondCount ?? 0);
    const count = event.count ?? 1;
    const alert: GiftAlert = {
      uniqueId: event.userId,
      nickname: event.nickname,
      giftName: event.giftName ?? "подарок",
      count,
      avatarUrl: event.avatarUrl
    };
    updatePlayer(event.userId, Math.max(0, diamonds) * count, event.avatarUrl, event.nickname, { gifts: count });
    broadcast({ type: "gift_alert", data: alert });
    console.log(`[gift] ${event.nickname}: ${alert.giftName} x${count}`);
  });
}

async function connectToTikTok(): Promise<void> {
  if (connecting || connected || shuttingDown || !process.env.SIGN_API_KEY) return;
  if (!activeUsername) {
    console.error("[tiktok] STREAMER_USERNAME is empty. Set it in server/src/config.ts.");
    return;
  }

  connecting = true;
  const previous = tiktok;
  tiktok = undefined;
  if (previous) void previous.disconnect();
  const connection = createConnection(activeUsername);
  tiktok = connection;
  try {
    attachEvents(connection, activeUsername);
    publishConnectionStatus(false);
    try {
      const state = await connection.connect();
      if (tiktok !== connection || shuttingDown) {
        void connection.disconnect();
        return;
      }
      connected = true;
      publishConnectionStatus(true);
      console.log(`[tiktok] Connected to @${activeUsername}, room ${state.roomId}`);
    } catch (error) {
      diagnostics.connectionErrors += 1;
      console.error(`[tiktok] Connection to @${activeUsername} failed:`, redact(error));
      if (tiktok === connection) tiktok = undefined;
      connected = false;
      void connection.disconnect();
      const retryAfter = Number((error as { retryAfter?: number })?.retryAfter);
      scheduleReconnect(retryAfter > 0 ? retryAfter : reconnectDelay);
    }
  } finally {
    connecting = false;
  }
}

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`);
  console.log(`[tiktok] Configured LIVE target: @${activeUsername}`);
  if (process.env.SIGN_API_KEY) void connectToTikTok();
  else console.warn("[tiktok] SIGN_API_KEY missing; UI is available, TikTok connection is disabled.");
});

function shutdown(): void {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  clearInterval(eventFlushTimer);
  const connection = tiktok;
  tiktok = undefined;
  if (connection) void connection.disconnect();
  wss.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
