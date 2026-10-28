/** HP and attack granted per single gift. Both values are multiplied by the gift repeat count. */
export interface GiftBoost {
  readonly hp: number;
  readonly attack: number;
}

export interface GiftGuideEntry {
  readonly emoji: string;
  /** Display name, also matched (case-insensitively) against the connector's gift name. */
  readonly name: string;
  readonly coins: number;
  readonly boost: GiftBoost;
  /** Extra connector gift names (for example the English name) that grant the same boost. */
  readonly aliases: readonly string[];
}

/**
 * Owner-confirmed gift boosts. Matching is by gift name because the real TikTok gift IDs have not
 * been verified yet; add verified IDs to GIFT_BOOSTS_BY_ID, which takes precedence over names.
 */
export const GIFT_GUIDE: readonly GiftGuideEntry[] = Object.freeze([
  { emoji: "🌹", name: "Роза", coins: 1, boost: { hp: 100, attack: 0 }, aliases: ["rose"] },
  { emoji: "💗", name: "Сердечко", coins: 5, boost: { hp: 500, attack: 0 }, aliases: ["heart"] },
  { emoji: "🐿️", name: "Белочка", coins: 10, boost: { hp: 1000, attack: 0 }, aliases: ["squirrel"] },
  { emoji: "🔥", name: "Пламенное сердце", coins: 1, boost: { hp: 0, attack: 5 }, aliases: [] },
  { emoji: "⚡", name: "Бурная реакция", coins: 5, boost: { hp: 0, attack: 25 }, aliases: [] },
  { emoji: "👍", name: "Мне нравится", coins: 10, boost: { hp: 0, attack: 50 }, aliases: [] }
]);

/** Verified TikTok gift IDs go here (id -> boost). Empty until the IDs are confirmed. */
export const GIFT_BOOSTS_BY_ID: Readonly<Record<number, GiftBoost>> = Object.freeze({});

const BOOSTS_BY_NAME: ReadonlyMap<string, GiftBoost> = new Map(
  GIFT_GUIDE.flatMap(entry => [entry.name, ...entry.aliases].map(name => [name.trim().toLowerCase(), entry.boost] as const))
);

/** Returns the confirmed boost for a gift, or null for gifts without a specific rule. */
export function giftBoostFor(giftId: number | undefined, giftName: string | undefined): GiftBoost | null {
  if (giftId !== undefined && Number.isSafeInteger(giftId) && GIFT_BOOSTS_BY_ID[giftId]) return GIFT_BOOSTS_BY_ID[giftId];
  const key = giftName?.trim().toLowerCase();
  return key ? BOOSTS_BY_NAME.get(key) ?? null : null;
}
