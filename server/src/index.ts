import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
const onlineIds = new Set<string>();
const pendingDepartures = new Map<string, { timer: ReturnType<typeof setTimeout>; player: ArenaPlayer }>();
const dataDirectory = process.env.DATA_DIR || path.resolve(dirname, "../../data");
mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(process.env.AQUALIFE_DB_PATH || path.join(dataDirectory, "aqualife.sqlite"));
database.exec("CREATE TABLE IF NOT EXISTS departed_viewers (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT NOT NULL, nickname TEXT NOT NULL, profile_picture_url TEXT NOT NULL, likes INTEGER NOT NULL DEFAULT 0, gifts INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, is_following INTEGER NOT NULL DEFAULT 0, departed_at TEXT NOT NULL)");
const saveDepartedViewer = database.prepare("INSERT INTO departed_viewers (unique_id, nickname, profile_picture_url, likes, gifts, comments, is_following, departed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
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
  // Preserve the legacy overlay's public username key; AquaLife uses the stable provider ID separately.
  return String(user?.uniqueId || user?.displayId || user?.userId || user?.id || "unknown");
}
function leaderboard(): ArenaPlayer[] {
  return [...onlineIds].map(id => players.get(id)).filter((player): player is ArenaPlayer => Boolean(player))
    .sort((a, b) => b.gifts - a.gifts || b.likes - a.likes);
}
function updatePlayer(
  id: string,
  points: number,
  avatarUrl: string,
  nickname: string,
  activity: { likes?: number; comments?: number; gifts?: number; isFollowing?: boolean } = {}
): void {
  const pending = pendingDepartures.get(id);
  if (pending) { clearTimeout(pending.timer); pendingDepartures.delete(id); }
  onlineIds.add(id);
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
  if (activity.isFollowing !== undefined) player.isFollowing = activity.isFollowing;
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
  const handleViewerLeft = (data: RecordData): void => {
    const normalized = normalizeTikTokEvent("member", data);
    if (!normalized) return;
    const id = userId(data.user);
    const player = players.get(id) ?? {
      uniqueId: id, nickname: normalized.nickname || id, profilePictureUrl: normalized.avatarUrl,
      score: 0, likes: 0, comments: 0, gifts: 0, isFollowing: false
    };
    onlineIds.delete(id);
    trackedParticipants.delete(normalized.userId);
    const leaveEvent: NormalizedGameEvent = { ...normalized, type: "viewer-left", eventId: "viewer-left:" + normalized.userId + ":" + Date.now(), dedupeKey: null, receivedAtMs: Date.now() };
    broadcast({ type: "aqualife_event", data: leaveEvent });
    broadcast({ type: "update_leaderboard", data: leaderboard() });
    const previous = pendingDepartures.get(id);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      try { saveDepartedViewer.run(player.uniqueId, player.nickname, player.profilePictureUrl, player.likes, player.gifts, player.comments, player.isFollowing ? 1 : 0, new Date().toISOString()); }
      catch (error) { console.error("[sqlite] Could not persist departed viewer:", redact(error)); }
      pendingDepartures.delete(id);
      players.delete(id);
    }, 30_000);
    pendingDepartures.set(id, { timer, player: { ...player } });
  };

  const isLeaveSignal = (data: RecordData): boolean => {
    const values = [data.action, data.actionType, data.event, data.eventType, data.type, data.userAction];
    return values.some(value => typeof value === "string" && /^(leave|left|exit|exited|disconnect|disconnected)$/i.test(value.trim()));
  };

  onConnectorEvent(WebcastEvent.MEMBER, (data: RecordData) => {
    if (isLeaveSignal(data)) { handleViewerLeft(data); return; }
    const event = ingestEvent("member", data);
    if (event) updatePlayer(userId(data.user), 0, event.avatarUrl, event.nickname);
  });
  const webcastEventNames = WebcastEvent as unknown as Record<string, string>;
  for (const key of ["LEAVE", "USER_LEAVE", "MEMBER_LEAVE", "VIEWER_LEAVE"]) {
    const leaveEventName = webcastEventNames[key];
    if (leaveEventName) onConnectorEvent(leaveEventName, (data: RecordData) => handleViewerLeft(data));
  }
  onConnectorEvent(WebcastEvent.CHAT, (data: RecordData) => {
    const event = ingestEvent("chat", data);
    if (!event) return;
    const message: ChatMessage = {
      uniqueId: userId(data.user),
      nickname: event.nickname,
      avatarUrl: event.avatarUrl,
      comment: event.comment ?? "",
      timestamp: event.receivedAtMs
    };
    console.log(`[chat] ${event.nickname}: ${message.comment}`);
    updatePlayer(userId(data.user), 5, event.avatarUrl, event.nickname, { comments: 1 });
    broadcast({ type: "chat_message", data: message });
  });
  onConnectorEvent(WebcastEvent.LIKE, (data: RecordData) => {
    const event = ingestEvent("like", data);
    if (!event) return;
    const count = event.count ?? 0;
    updatePlayer(userId(data.user), Math.max(1, Math.floor(count / 10)), event.avatarUrl, event.nickname, { likes: count });
  });
  if (WebcastEvent.FOLLOW) {
    onConnectorEvent(WebcastEvent.FOLLOW, (data: RecordData) => {
      const event = ingestEvent("follow", data);
      if (!event) return;
      updatePlayer(userId(data.user), 0, event.avatarUrl, event.nickname, { isFollowing: true });
    });
  }
  // Some connector versions expose an unfollow event; handle it when available.
  const unfollowEventName = (WebcastEvent as unknown as Record<string, string>).UNFOLLOW;
  if (unfollowEventName) {
    onConnectorEvent(unfollowEventName, (data: RecordData) => {
      const event = ingestEvent("member", { ...data, isFollowing: false });
      if (!event) return;
      updatePlayer(userId(data.user), 0, event.avatarUrl, event.nickname, { isFollowing: false });
    });
  }
  onConnectorEvent(WebcastEvent.SUB_NOTIFY, (data: RecordData) => {
    ingestEvent("subscribe", data);
  });
  onConnectorEvent(WebcastEvent.GIFT, (data: RecordData) => {
    const giftType = Number(data.giftDetails?.giftType ?? data.gift?.type);
    // Combo gifts emit intermediate packets. Award only on the connector's final packet.
    if (giftType === 1 && data.repeatEnd === false) return;
    const event = ingestEvent("gift", data);
    if (!event) return;
    const giftDetails = data.giftDetails ?? {};
    const gift = data.gift ?? {};
    const diamonds = Number(giftDetails.diamondCount ?? gift.diamondCount ?? 0);
    const count = event.count ?? 1;
    const alert: GiftAlert = {
      uniqueId: userId(data.user),
      nickname: event.nickname,
      giftName: event.giftName ?? "подарок",
      count,
      avatarUrl: event.avatarUrl
    };
    updatePlayer(userId(data.user), Math.max(0, diamonds) * count, event.avatarUrl, event.nickname, { gifts: count });
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
  for (const departure of pendingDepartures.values()) clearTimeout(departure.timer);
  pendingDepartures.clear();
  database.close();
  const connection = tiktok;
  tiktok = undefined;
  if (connection) void connection.disconnect();
  wss.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
