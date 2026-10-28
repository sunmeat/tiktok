/** HP and attack granted per single gift. Both values are multiplied by the gift repeat count. */
export interface GiftBoost {
  readonly hp: number;
  readonly attack: number;
}

export interface GiftGuideEntry {
  readonly emoji: string;
  /** Official TikTok LIVE gift artwork hosted on TikTok's webcast CDN. */
  readonly imageUrl: string;
  /** Display name, also matched (case-insensitively) against the connector's gift name. */
  readonly name: string;
  readonly boost: GiftBoost;
  /** Extra connector gift names that grant the same boost. */
  readonly aliases: readonly string[];
}

/**
 * Owner-confirmed gift boosts. Artwork URLs point to the matching TikTok LIVE gift icons.
 * Matching is by gift name because gift IDs have not yet been verified.
 */
export const GIFT_GUIDE: readonly GiftGuideEntry[] = Object.freeze([
  { emoji: "🌹", imageUrl: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.webp", name: "Rose", boost: { hp: 100, attack: 0 }, aliases: ["Роза"] },
  { emoji: "🫰", imageUrl: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/a4c4dc437fd3a6632aba149769491f49.png~tplv-obj.webp", name: "Finger Heart", boost: { hp: 500, attack: 0 }, aliases: ["Finger heart"] },
  { emoji: "🐈‍⬛", imageUrl: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/8e779968d715ee8f47b94d5ac6245da5~tplv-obj.webp", name: "Panther", boost: { hp: 1000, attack: 0 }, aliases: [] },
  { emoji: "❤️‍🔥", imageUrl: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/b199d028d5beb081fe16edcf77db0830.png~tplv-obj.webp", name: "Flame Heart", boost: { hp: 0, attack: 5 }, aliases: ["Flame heart", "Flaming Heart", "Пламенное сердце"] },
  { emoji: "🍎", imageUrl: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/3940ea39b5180e353c49c5ebe207289c~tplv-obj.webp", name: "Pomegranate", boost: { hp: 0, attack: 25 }, aliases: [] },
  { emoji: "🐿️", imageUrl: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/1739fceef111004d05fb5b8abea8a778.png~tplv-obj.webp", name: "Squirrel", boost: { hp: 0, attack: 50 }, aliases: ["Белочка"] }
]);

/** Verified TikTok gift IDs go here (id -> boost). Empty until the IDs are confirmed. */
export const GIFT_BOOSTS_BY_ID: Readonly<Record<number, GiftBoost>> = Object.freeze({});

function normalizeGiftName(name: string): string {
  return name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
}

const BOOSTS_BY_NAME: ReadonlyMap<string, GiftBoost> = new Map(
  GIFT_GUIDE.flatMap(entry => [entry.name, ...entry.aliases].map(name => [normalizeGiftName(name), entry.boost] as const))
);

/** Returns a configured boost even when the connector appends emoji or gift metadata to its display name. */
export function giftBoostFor(giftId: number | undefined, giftName: string | undefined): GiftBoost | null {
  if (giftId !== undefined && Number.isSafeInteger(giftId) && GIFT_BOOSTS_BY_ID[giftId]) return GIFT_BOOSTS_BY_ID[giftId];
  const key = normalizeGiftName(giftName ?? "");
  if (!key) return null;
  const exact = BOOSTS_BY_NAME.get(key);
  if (exact) return exact;
  for (const [knownName, boost] of BOOSTS_BY_NAME) {
    if (key.startsWith(knownName) || knownName.startsWith(key)) return boost;
  }
  return null;
}
