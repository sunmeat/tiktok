import type { NormalizedGameEvent } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? value as UnknownRecord : {};
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function safeCount(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Convert connector-specific payloads into a stable internal event contract. */
export function normalizeTikTokEvent(
  kind: "member" | "like" | "follow" | "subscribe" | "gift" | "chat",
  payload: unknown,
  receivedAtMs = Date.now()
): NormalizedGameEvent | null {
  const data = record(payload);
  const user = record(data.user ?? data);
  // Prefer provider identifiers that are not display names; usernames are the fallback only.
  const userId = stringValue(user.userId, user.id, user.secUid, user.uniqueId, user.displayId, data.userId, data.uniqueId);
  if (!userId || userId.toLowerCase() === "unknown") return null;

  const avatar = record(user.profilePicture);
  const avatarUrl = stringValue(
    user.profilePictureUrl,
    record(avatar.url).url,
    Array.isArray(avatar.url) ? avatar.url[0] : undefined,
    record(user.avatarThumb).urlList instanceof Array ? (record(user.avatarThumb).urlList as unknown[])[0] : undefined
  );
  const nickname = stringValue(user.nickname, user.uniqueId, userId);
  const providerEventId = stringValue(data.msgId, data.messageId, data.eventId);
  const dedupeKey = providerEventId ? `${kind}:${providerEventId}` : null;
  // Without a provider ID, keep a unique diagnostic ID but do not pretend it can deduplicate delivery.
  const eventId = dedupeKey ?? `untracked:${kind}:${userId}:${receivedAtMs}`;

  if (kind === "member") return { type: "viewer-joined", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs };
  if (kind === "like") {
    return { type: "like", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, count: safeCount(data.likeCount ?? data.count) };
  }
  if (kind === "follow") return { type: "follow", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, isFollowing: true };
  if (kind === "subscribe") return { type: "subscribe", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs };
  if (kind === "gift") {
    return {
      type: "gift", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs,
      count: safeCount(data.repeatCount),
      giftId: Number.isFinite(Number(data.giftId)) ? Number(data.giftId) : undefined,
      giftName: stringValue(data.giftName, record(data.giftDetails).giftName, record(data.gift).name) || "подарок"
    };
  }
  return {
    type: "chat", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs,
    comment: stringValue(data.comment, data.content)
  };
}
