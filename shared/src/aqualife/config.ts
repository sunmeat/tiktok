export interface AquaLifeConfig {
  readonly initialHp: number;
  readonly likesPerHp: number;
  readonly respawnDelayMs: number;
  readonly likeSpeedPxPerSecondPerLikePerSecond: number;
  readonly likeActivityWindowMs: number;
  readonly baseFishSize: number;
  readonly baseSpeedPxPerSecond: number;
  readonly baseBiteDamage: number;
  readonly jellyfishDamage: number;
  readonly defaultWorldWidth: number;
  readonly defaultWorldHeight: number;
  readonly simulationStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxQueuedEvents: number;
}

/**
 * Tuning values are centralized here. The like-activity window is provisional
 * and should be adjusted after observing real streams; it is not a gameplay cap.
 */
export const AQUALIFE_CONFIG: AquaLifeConfig = Object.freeze({
  initialHp: 5,
  likesPerHp: 5,
  respawnDelayMs: 5_000,
  likeSpeedPxPerSecondPerLikePerSecond: 0.6,
  likeActivityWindowMs: 5_000,
  baseFishSize: 1,
  baseSpeedPxPerSecond: 0,
  baseBiteDamage: 1,
  jellyfishDamage: 1,
  defaultWorldWidth: 540,
  defaultWorldHeight: 960,
  simulationStepMs: 50,
  maxCatchUpSteps: 5,
  maxQueuedEvents: 2_000
});
