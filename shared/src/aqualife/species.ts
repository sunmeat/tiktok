import type { FishSpeciesId } from "./types.js";

export interface FishSpeciesDefinition {
  id: FishSpeciesId;
  displayName: string;
  bodyColor: number;
  finColor: number;
  accentColor: number;
  bodyLength: number;
  bodyHeight: number;
  tailLength: number;
  eyeSize: number;
  pattern: "solid" | "stripe" | "spots" | "mask" | "belly" | "glow";
}

/** Visual catalog. gift-1..gift-10 are placeholders until real TikTok gift IDs are confirmed. */
export const FISH_SPECIES_CATALOG: readonly FishSpeciesDefinition[] = Object.freeze([
  { id: "standard-gray", displayName: "Серебристая", bodyColor: 0x9aa9b1, finColor: 0x7f9099, accentColor: 0xe0e8ec, bodyLength: 15, bodyHeight: 8, tailLength: 8, eyeSize: 1.5, pattern: "solid" },
  { id: "dory", displayName: "Дори", bodyColor: 0x168de2, finColor: 0xf5bd32, accentColor: 0x102b83, bodyLength: 16, bodyHeight: 9, tailLength: 9, eyeSize: 1.7, pattern: "stripe" },
  { id: "gift-1", displayName: "Коралловая", bodyColor: 0xff8066, finColor: 0xc94b64, accentColor: 0xffd3a4, bodyLength: 15, bodyHeight: 9, tailLength: 10, eyeSize: 1.5, pattern: "belly" },
  { id: "gift-2", displayName: "Лазурная", bodyColor: 0x27c3d4, finColor: 0x117baf, accentColor: 0xb5f6f5, bodyLength: 17, bodyHeight: 7, tailLength: 9, eyeSize: 1.4, pattern: "stripe" },
  { id: "gift-3", displayName: "Золотая", bodyColor: 0xf2bd38, finColor: 0xc77b25, accentColor: 0xfff0a3, bodyLength: 14, bodyHeight: 10, tailLength: 8, eyeSize: 1.6, pattern: "spots" },
  { id: "gift-4", displayName: "Фиолетовая", bodyColor: 0x9b75df, finColor: 0x6542a7, accentColor: 0xe4c9ff, bodyLength: 15, bodyHeight: 9, tailLength: 11, eyeSize: 1.5, pattern: "glow" },
  { id: "gift-5", displayName: "Тигровая", bodyColor: 0xffa13a, finColor: 0x9f482a, accentColor: 0x39252d, bodyLength: 17, bodyHeight: 8, tailLength: 10, eyeSize: 1.4, pattern: "stripe" },
  { id: "gift-6", displayName: "Мятная", bodyColor: 0x5fd4a4, finColor: 0x268d86, accentColor: 0xc9ffe5, bodyLength: 14, bodyHeight: 8, tailLength: 8, eyeSize: 1.5, pattern: "belly" },
  { id: "gift-7", displayName: "Рубиновая", bodyColor: 0xd94f76, finColor: 0x8c284f, accentColor: 0xffc0d2, bodyLength: 16, bodyHeight: 10, tailLength: 9, eyeSize: 1.6, pattern: "spots" },
  { id: "gift-8", displayName: "Полосатая", bodyColor: 0xf1e6ce, finColor: 0x2d536a, accentColor: 0x233d51, bodyLength: 16, bodyHeight: 8, tailLength: 10, eyeSize: 1.4, pattern: "mask" },
  { id: "gift-9", displayName: "Неоновая", bodyColor: 0x70e6ff, finColor: 0x2782e5, accentColor: 0xf4ffff, bodyLength: 15, bodyHeight: 9, tailLength: 12, eyeSize: 1.7, pattern: "glow" },
  { id: "gift-10", displayName: "Глубинная", bodyColor: 0x46556f, finColor: 0x222b47, accentColor: 0x80d7d5, bodyLength: 18, bodyHeight: 7, tailLength: 11, eyeSize: 1.4, pattern: "spots" }
]);

export function getFishSpeciesDefinition(id: FishSpeciesId): FishSpeciesDefinition {
  return FISH_SPECIES_CATALOG.find(species => species.id === id)
    ?? FISH_SPECIES_CATALOG[0];
}

/** Gift IDs are deliberately empty until the real TikTok IDs are verified. */
export const TIKTOK_GIFT_SPECIES_BY_ID: Readonly<Record<number, Exclude<FishSpeciesId, "standard-gray" | "dory">>> = Object.freeze({});

export function speciesForGiftId(giftId: number | undefined): Exclude<FishSpeciesId, "standard-gray" | "dory"> | null {
  if (giftId === undefined || !Number.isSafeInteger(giftId) || giftId <= 0) return null;
  return TIKTOK_GIFT_SPECIES_BY_ID[giftId] ?? null;
}
