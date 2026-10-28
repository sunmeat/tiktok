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

function safePositiveCount(value: unknown, fallback: number | null = null): number | null {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const integer = Math.floor(parsed);
  if (integer < 1) return fallback;
  return Math.min(1_000_000, integer);
}

function followingStatus(user: UnknownRecord, data: UnknownRecord): boolean | undefined {
  const followInfo = record(user.followInfo ?? data.followInfo);
  const directValues = [user.isFollowing, user.following, data.isFollowing, data.following, followInfo.isFollowing, followInfo.following];
  for (const value of directValues) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  }
  const status = followInfo.followStatus ?? followInfo.followStatusType ?? user.followStatus ?? data.followStatus;
  if (typeof status === "boolean") return status;
  if (typeof status === "number" && Number.isFinite(status)) return status > 0;
  if (typeof status === "string" && /^(true|false|0|1|2)$/i.test(status.trim())) {
    const normalized = status.trim().toLowerCase();
    return normalized === "true" || (normalized !== "false" && Number(normalized) > 0);
  }
  return undefined;
}

function profileAvatar(user: UnknownRecord): string {
  const picture = record(user.profilePicture);
  const avatarThumb = record(user.avatarThumb);
  const avatarMedium = record(user.avatarMedium);
  const avatarLarge = record(user.avatarLarge);
  const candidates: unknown[] = [
    user.profilePictureUrl,
    picture.url,
    picture.urlList,
    avatarThumb.urlList,
    avatarMedium.urlList,
    avatarLarge.urlList
  ];
  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      const url = typeof value === "string" ? value.trim() : "";
      if (!url) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
      } catch {
        // Ignore malformed provider avatar values.
      }
    }
  }
  return "";
}

/** Convert connector-specific payloads into a validated internal event contract. */
export function normalizeTikTokEvent(
  kind: "member" | "like" | "follow" | "subscribe" | "gift" | "chat",
  payload: unknown,
  receivedAtMs = Date.now()
): NormalizedGameEvent | null {
  if (!Number.isFinite(receivedAtMs) || receivedAtMs < 0) return null;
  const data = record(payload);
  const user = record(data.user ?? data);
  // Prefer stable provider IDs; a username is only a fallback when no stable ID is exposed.
  const rawUserId = stringValue(
    user.userId, user.id, user.secUid, data.userId, data.secUid, user.uniqueId, user.displayId, data.uniqueId
  );
  if (!rawUserId || rawUserId.toLowerCase() === "unknown" || rawUserId.length > 256) return null;

  const userId = rawUserId;
  const nickname = stringValue(user.nickname, user.uniqueId, user.displayId, userId).slice(0, 80);
  const avatarUrl = profileAvatar(user);
  const isFollowing = kind === "follow" ? true : followingStatus(user, data);
  const providerEventId = stringValue(data.msgId, data.messageId, data.eventId);
  const dedupeKey = providerEventId && providerEventId.length <= 256 ? `${kind}:${providerEventId}` : null;
  // Without a provider event ID, do not suppress legitimate repeated likes or gifts.
  const eventId = dedupeKey ?? `untracked:${kind}:${userId}:${receivedAtMs}`;

  if (kind === "member") {
    return { type: "viewer-joined", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, ...(isFollowing === undefined ? {} : { isFollowing }) };
  }
  if (kind === "like") {
    // A LIKE packet without an explicit positive count is malformed; never invent one like.
    const count = safePositiveCount(data.likeCount ?? data.count);
    if (count === null) return null;
    return { type: "like", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, count, ...(isFollowing === undefined ? {} : { isFollowing }) };
  }
  if (kind === "follow") {
    return { type: "follow", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, isFollowing: true };
  }
  if (kind === "subscribe") {
    return { type: "subscribe", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, ...(isFollowing === undefined ? {} : { isFollowing }) };
  }
  if (kind === "gift") {
    const giftDetails = record(data.giftDetails);
    const gift = record(data.gift);
    const count = safePositiveCount(data.repeatCount ?? data.giftCount ?? data.count, 1);
    const rawGiftId = data.giftId ?? giftDetails.giftId ?? gift.id;
    const parsedGiftId = Number(rawGiftId);
    const giftId = rawGiftId !== undefined && Number.isFinite(parsedGiftId) && parsedGiftId > 0
      ? parsedGiftId
      : undefined;
    return {
      type: "gift",
      eventId,
      dedupeKey,
      userId,
      nickname,
      avatarUrl,
      receivedAtMs,
      ...(isFollowing === undefined ? {} : { isFollowing }),
      count: count ?? 1,
      giftId,
      giftName: stringValue(data.giftName, giftDetails.giftName, gift.name, giftDetails.name, data.describe, record(data.extendedGiftInfo).name, record(data.giftInfo).name).slice(0, 120) || "подарок"
    };
  }
  const comment = stringValue(data.comment, data.content).slice(0, 2_000);
  return { type: "chat", eventId, dedupeKey, userId, nickname, avatarUrl, receivedAtMs, comment, ...(isFollowing === undefined ? {} : { isFollowing }) };
}
