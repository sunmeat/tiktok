export interface AquaLifeConfig {
  readonly initialHp: number;
  readonly likesPerHp: number;
  readonly likesPerSizeGrowth: number;
  readonly sizeGrowthPerThreshold: number;
  readonly respawnDelayMs: number;
  /** A dead fish fades out smoothly over this many ms (same as a leaving viewer's final fade). */
  readonly deathFadeMs: number;
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
  /** Slowest heading change in rad/s, so even a gliding fish can still reorient. */
  readonly minTurnRateRadiansPerSecond: number;
  /** Turning radius in px per unit of fish size; faster fish turn in wider arcs. */
  readonly turnRadiusPerSize: number;
  /**
   * Burst-and-coast: product of drag and stroke interval. Speed decays by exp(-glide)
   * between strokes, so 1.6 means a fish glides down to ~20% of its post-stroke speed.
   */
  readonly strokeGlideFactor: number;
  readonly minStrokeIntervalSeconds: number;
  readonly maxStrokeIntervalSeconds: number;
  /** Chance of hovering instead of choosing a new waypoint; scaled down for fast (liked) fish. */
  readonly hoverChance: number;
  readonly hoverMinSeconds: number;
  readonly hoverMaxSeconds: number;
  readonly waypointMinDistance: number;
  readonly waypointMaxDistance: number;
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
  sizeGrowthPerThreshold: 0.15,
  respawnDelayMs: 5_000,
  deathFadeMs: 1_200,
  likeSpeedPxPerSecondPerLikePerSecond: 0.6,
  likeActivityWindowMs: 5_000,
  baseFishSize: 1,
  baseSpeedPxPerSecond: 10,
  minSpeedPxPerSecond: 10,
  maxSpeedPxPerSecond: 120,
  speedSmoothingPerSecond: 1.4,
  minWanderIntervalSeconds: 4.5,
  maxWanderIntervalSeconds: 9,
  maxTurnRateRadiansPerSecond: 2.4,
  minTurnRateRadiansPerSecond: 0.45,
  turnRadiusPerSize: 14,
  strokeGlideFactor: 1.6,
  minStrokeIntervalSeconds: 0.8,
  maxStrokeIntervalSeconds: 1.9,
  hoverChance: 0.45,
  hoverMinSeconds: 0.9,
  hoverMaxSeconds: 2.7,
  waypointMinDistance: 70,
  waypointMaxDistance: 220,
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
