import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeParticipant } from "./types.js";

export interface LikeRewardResult {
  hpGained: number;
  sizeMultiplier: number;
  speedPxPerSecond: number;
}

/** Applies only the confirmed HP rule. HP has no gameplay maximum. */
export function applyLikeReward(
  participant: AquaLifeParticipant,
  fish: AquaLifeFish,
  count: number,
  atMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): LikeRewardResult {
  const safeLikes = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  participant.likesTotal += safeLikes;
  participant.likesRemainderForHp += safeLikes;
  const hpGained = Math.floor(participant.likesRemainderForHp / config.likesPerHp);
  participant.likesRemainderForHp %= config.likesPerHp;
  fish.hp += hpGained;
  fish.likesPerSecondSamples.push({ atMs, count: safeLikes });
  const cutoff = atMs - config.likeActivityWindowMs;
  while (fish.likesPerSecondSamples.length && fish.likesPerSecondSamples[0].atMs < cutoff) {
    fish.likesPerSecondSamples.shift();
  }
  updateLikeActivitySpeed(fish, atMs, config);
  // Size growth is intentionally not applied until its gameplay formula is confirmed.
  const sizeMultiplier = fish.size / config.baseFishSize;
  return { hpGained, sizeMultiplier, speedPxPerSecond: fish.speedPxPerSecond };
}

/** Recalculate a smoothed rate and let it decay when no new likes arrive. */
export function updateLikeActivitySpeed(
  fish: AquaLifeFish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): number {
  const cutoff = nowMs - config.likeActivityWindowMs;
  while (fish.likesPerSecondSamples.length && fish.likesPerSecondSamples[0].atMs < cutoff) {
    fish.likesPerSecondSamples.shift();
  }
  const totalInWindow = fish.likesPerSecondSamples.reduce((sum, sample) => sum + sample.count, 0);
  const likesPerSecond = totalInWindow * 1000 / Math.max(1, config.likeActivityWindowMs);
  fish.speedPxPerSecond = config.likeSpeedPxPerSecondPerLikePerSecond * likesPerSecond;
  return fish.speedPxPerSecond;
}
