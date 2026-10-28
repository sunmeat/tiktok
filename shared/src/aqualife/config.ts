export interface AquaLifeConfig {
  readonly initialHp: number;
  readonly likesPerHp: number;
  readonly likesPerSizeGrowth: number;
  readonly sizeGrowthPerThreshold: number;
  readonly respawnDelayMs: number;
  readonly likeSpeedPxPerSecondPerLikePerSecond: number;
  readonly likeActivityWindowMs: number;
  readonly baseFishSize: number;
  readonly baseSpeedPxPerSecond: number;
  readonly minSpeedPxPerSecond: number;
  readonly maxSpeedPxPerSecond: number;
  readonly speedSmoothingPerSecond: number;
  readonly minWanderIntervalSeconds: number;
  readonly maxWanderIntervalSeconds: number;
  readonly maxTurnRateRadiansPerSecond: number;
  readonly separationRadius: number;
  readonly separationStrength: number;
  readonly baseBiteDamage: number;
  readonly jellyfishDamage: number;
  readonly fishCollisionRadiusPerSize: number;
  readonly attackRangePerSize: number;
  readonly attackCooldownMs: number;
  readonly biteAnimationMs: number;
  readonly jellyfishHitCooldownMs: number;
  readonly jellyfishBaseSpeedPxPerSecond: number;
  readonly defaultWorldWidth: number;
  readonly defaultWorldHeight: number;
  readonly simulationStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxQueuedEvents: number;
  readonly maxParticipants: number;
  readonly maxFish: number;
  readonly maxJellyfish: number;
  readonly maxProcessedEventIds: number;
  readonly maxLikeSamplesPerFish: number;
}

/**
 * Tuning values are centralized here. The like-activity window is provisional
 * and should be adjusted after observing real streams; it is not a gameplay cap.
 */
export const AQUALIFE_CONFIG: AquaLifeConfig = Object.freeze({
  initialHp: 5,
  likesPerHp: 5,
  likesPerSizeGrowth: 100,
  sizeGrowthPerThreshold: 0.08,
  respawnDelayMs: 5_000,
  likeSpeedPxPerSecondPerLikePerSecond: 0.6,
  likeActivityWindowMs: 5_000,
  baseFishSize: 1,
  baseSpeedPxPerSecond: 14,
  minSpeedPxPerSecond: 0,
  maxSpeedPxPerSecond: 120,
  speedSmoothingPerSecond: 2.5,
  minWanderIntervalSeconds: 1.2,
  maxWanderIntervalSeconds: 3.8,
  maxTurnRateRadiansPerSecond: 2.4,
  separationRadius: 26,
  separationStrength: 0.35,
  baseBiteDamage: 1,
  jellyfishDamage: 1,
  fishCollisionRadiusPerSize: 18,
  attackRangePerSize: 24,
  attackCooldownMs: 1_000,
  biteAnimationMs: 180,
  jellyfishHitCooldownMs: 900,
  jellyfishBaseSpeedPxPerSecond: 34,
  defaultWorldWidth: 540,
  defaultWorldHeight: 960,
  simulationStepMs: 50,
  maxCatchUpSteps: 5,
  maxQueuedEvents: 2_000,
  maxParticipants: 1_000,
  maxFish: 500,
  maxJellyfish: 100,
  maxProcessedEventIds: 4_000,
  maxLikeSamplesPerFish: 120
});
