import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import type { ArenaPlayer, ChatMessage, GiftAlert, ServerMessage } from "@tiktok-arena/shared";

type RecordData = any;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const players = new Map<string, ArenaPlayer>();
const username = (process.env.TIKTOK_USERNAME || "rezerv_realdimon2").replace(/^@/, "");
const reconnectDelay = 30_000;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connecting = false;
let connected = false;

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ status: "ok", tiktokConnected: connected, clients: wss.clients.size }));
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
function userId(user?: RecordData): string {
  return String(user?.uniqueId || user?.displayId || user?.userId || user?.id || "unknown");
}
function avatar(user?: RecordData): string {
  return String(user?.profilePictureUrl || user?.profilePicture?.url?.[0] || user?.avatarThumb?.urlList?.[0] || user?.avatarMedium?.urlList?.[0] || user?.avatarLarge?.urlList?.[0] || "");
}
function leaderboard(): ArenaPlayer[] {
  return [...players.values()].sort((a, b) => b.score - a.score);
}
function updatePlayer(id: string, points: number, avatarUrl: string, nickname: string, activity: { likes?: number; comments?: number; gifts?: number; isFollowing?: boolean } = {}): void {
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
  send(client, { type: "connection_status", data: { connected, username } });
  client.on("message", raw => {
    try { if (JSON.parse(raw.toString()).type === "ping") client.send(JSON.stringify({ type: "pong" })); }
    catch { console.warn("[ws] Invalid client message ignored"); }
  });
});

const tiktok = new TikTokLiveConnection(username, {
  ...(process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {})
});
function scheduleReconnect(delay = reconnectDelay): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connectToTikTok(); }, Math.max(1000, delay));
}
function connectToTikTok(): void {
  if (connecting || connected || !process.env.SIGN_API_KEY) return;
  connecting = true;
  tiktok.connect()
    .then(state => {
      connected = true;
      broadcast({ type: "connection_status", data: { connected: true, username } });
      console.log(`[tiktok] Connected to @${username}, room ${state.roomId}`);
    })
    .catch((error: unknown) => {
      const err = error as { message?: string; retryAfter?: number };
      console.error("[tiktok] Connection failed:", err?.message || error);
      scheduleReconnect(Number(err?.retryAfter) > 0 ? Number(err.retryAfter) : reconnectDelay);
    })
    .finally(() => { connecting = false; });
}
tiktok.on(ControlEvent.DISCONNECTED, () => {
  connected = false;
  broadcast({ type: "connection_status", data: { connected: false, username } });
  scheduleReconnect();
});
tiktok.on(ControlEvent.ERROR, (error: RecordData) => console.error("[tiktok] Connection error:", error?.message || error));
tiktok.on(WebcastEvent.STREAM_END, () => {
  connected = false;
  broadcast({ type: "connection_status", data: { connected: false, username } });
});

tiktok.on(WebcastEvent.CHAT, (data: RecordData) => {
  const id = userId(data.user);
  const nickname = String(data.user?.nickname || id);
  const comment = String(data.comment ?? data.content ?? "");
  const message: ChatMessage = { uniqueId: id, nickname, avatarUrl: avatar(data.user), comment, timestamp: Date.now() };
  console.log(`[chat] ${nickname}: ${comment}`);
  updatePlayer(id, 5, message.avatarUrl, nickname, { comments: 1 });
  broadcast({ type: "chat_message", data: message });
});
tiktok.on(WebcastEvent.LIKE, (data: RecordData) => {
  const id = userId(data.user);
  const count = Math.max(1, Number(data.likeCount ?? data.count ?? 1) || 1);
  updatePlayer(id, Math.max(1, Math.floor(count / 10)), avatar(data.user), String(data.user?.nickname || id), { likes: count });
});
if (WebcastEvent.FOLLOW) {
  tiktok.on(WebcastEvent.FOLLOW, (data: RecordData) => {
    const id = userId(data.user);
    updatePlayer(id, 0, avatar(data.user), String(data.user?.nickname || id), { isFollowing: true });
  });
}
tiktok.on(WebcastEvent.GIFT, (data: RecordData) => {
  const giftType = data.giftDetails?.giftType ?? data.gift?.type;
  const giftName = String(data.giftDetails?.giftName ?? data.gift?.name ?? "подарок");
  const diamonds = Number(data.giftDetails?.diamondCount ?? data.gift?.diamondCount ?? 0);
  const count = Math.max(1, Number(data.repeatCount || 1));
  if (giftType === 1 && !data.repeatEnd) return;
  const id = userId(data.user);
  const nickname = String(data.user?.nickname || id);
  const avatarUrl = avatar(data.user);
  const gift: GiftAlert = { uniqueId: id, nickname, giftName, count, avatarUrl };
  updatePlayer(id, diamonds * count, avatarUrl, nickname, { gifts: count });
  broadcast({ type: "gift_alert", data: gift });
  console.log(`[gift] ${nickname}: ${giftName} x${count}`);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[server] Listening on port ${port}`);
  if (process.env.SIGN_API_KEY) connectToTikTok();
  else console.warn("[tiktok] SIGN_API_KEY missing; UI is available, TikTok connection is disabled.");
});
function shutdown(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  wss.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
