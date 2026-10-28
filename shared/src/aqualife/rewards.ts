import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeParticipant } from "./types.js";

export interface LikeRewardResult {
  hpGained: number;
  sizeMultiplier: number;
  speedPxPerSecond: number;
  grew: boolean;
}

/** Applies cumulative HP/size rewards and bounded like-activity samples. */
export function applyLikeReward(
  participant: AquaLifeParticipant,
  fish: AquaLifeFish,
  count: number,
  atMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): LikeRewardResult {
  const safeLikes = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const safeAtMs = Number.isFinite(atMs) ? Math.max(0, atMs) : 0;
  const previousLikesTotal = participant.likesTotal;
  participant.likesTotal += safeLikes;
  participant.likesRemainderForHp += safeLikes;

  const hpGained = Math.floor(participant.likesRemainderForHp / config.likesPerHp);
  participant.likesRemainderForHp %= config.likesPerHp;
  if (hpGained > 0) {
    fish.hp += hpGained;
    fish.lastHealAtMs = safeAtMs;
  }

  const previousGrowthThreshold = Math.floor(previousLikesTotal / config.likesPerSizeGrowth);
  const currentGrowthThreshold = Math.floor(participant.likesTotal / config.likesPerSizeGrowth);
  const grew = currentGrowthThreshold > previousGrowthThreshold;
  fish.size = fish.baseSize * Math.pow(
    1 + config.sizeGrowthPerThreshold,
    currentGrowthThreshold
  );
  if (grew) fish.lastGrowthAtMs = safeAtMs;
  if (safeLikes > 0) fish.lastLikeAtMs = safeAtMs;

  if (safeLikes > 0) {
    fish.likesPerSecondSamples.push({ atMs: safeAtMs, count: safeLikes });
    fish.likesPerSecondSamples.sort((a, b) => a.atMs - b.atMs);
  }
  const cutoff = safeAtMs - config.likeActivityWindowMs;
  while (fish.likesPerSecondSamples.length && fish.likesPerSecondSamples[0].atMs < cutoff) {
    fish.likesPerSecondSamples.shift();
  }
  while (fish.likesPerSecondSamples.length > config.maxLikeSamplesPerFish) {
    fish.likesPerSecondSamples.shift();
  }
  updateLikeActivitySpeed(fish, safeAtMs, config);

  return {
    hpGained,
    sizeMultiplier: fish.baseSize > 0 ? fish.size / fish.baseSize : 1,
    speedPxPerSecond: fish.speedPxPerSecond,
    grew
  };
}

/** Converts rolling like activity to a bounded target speed and smooths toward it. */
export function updateLikeActivitySpeed(
  fish: AquaLifeFish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): number {
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : fish.lastSpeedUpdateAtMs;
  const cutoff = safeNow - config.likeActivityWindowMs;
  while (fish.likesPerSecondSamples.length && fish.likesPerSecondSamples[0].atMs < cutoff) {
    fish.likesPerSecondSamples.shift();
  }
  while (fish.likesPerSecondSamples.length > config.maxLikeSamplesPerFish) {
    fish.likesPerSecondSamples.shift();
  }
  const totalInWindow = fish.likesPerSecondSamples.reduce((sum, sample) => sum + sample.count, 0);
  const likesPerSecond = totalInWindow * 1000 / Math.max(1, config.likeActivityWindowMs);
  const rawTarget = config.likeSpeedPxPerSecondPerLikePerSecond * likesPerSecond;
  fish.speedTargetPxPerSecond = Math.max(
    config.minSpeedPxPerSecond,
    Math.min(config.maxSpeedPxPerSecond, rawTarget)
  );

  const elapsedMs = Math.max(0, Math.min(250, safeNow - fish.lastSpeedUpdateAtMs));
  const alpha = 1 - Math.exp(-Math.max(0, config.speedSmoothingPerSecond) * elapsedMs / 1000);
  fish.speedPxPerSecond += (fish.speedTargetPxPerSecond - fish.speedPxPerSecond) * alpha;
  fish.speedPxPerSecond = Math.max(
    config.minSpeedPxPerSecond,
    Math.min(config.maxSpeedPxPerSecond, fish.speedPxPerSecond)
  );
  fish.lastSpeedUpdateAtMs = Math.max(fish.lastSpeedUpdateAtMs, safeNow);
  return fish.speedPxPerSecond;
}
