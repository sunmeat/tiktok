import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeJellyfish, AquaLifeWorld } from "./types.js";

export interface CombatResult {
  hit: boolean;
  killed: boolean;
  respawnAtMs: number | null;
}

function killFishOnce(target: AquaLifeFish, nowMs: number, config: AquaLifeConfig): CombatResult {
  // The status guard makes death idempotent: repeated contacts cannot restart its timer.
  if (target.status === "dead") return { hit: false, killed: false, respawnAtMs: target.respawnAtMs };
  target.hp = 0;
  target.status = "dead";
  target.respawnAtMs = nowMs + config.respawnDelayMs;
  target.attackAnimationUntilMs = 0;
  return { hit: true, killed: true, respawnAtMs: target.respawnAtMs };
}

/** A larger fish can bite a smaller fish only inside its size-scaled attack radius and off cooldown. */
export function resolveFishBite(
  attacker: AquaLifeFish,
  target: AquaLifeFish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): CombatResult {
  if (
    attacker.id === target.id ||
    attacker.status === "dead" || attacker.status === "respawning" ||
    target.status === "dead" || target.status === "respawning" ||
    attacker.size <= target.size ||
    nowMs < attacker.attackCooldownUntilMs
  ) return { hit: false, killed: false, respawnAtMs: null };

  const distance = Math.hypot(attacker.x - target.x, attacker.y - target.y);
  const attackRange = config.attackRangePerSize * (Math.max(0, attacker.size) + Math.max(0, target.size));
  if (distance > attackRange) return { hit: false, killed: false, respawnAtMs: null };

  attacker.lastAttackAtMs = nowMs;
  attacker.attackCooldownUntilMs = nowMs + config.attackCooldownMs;
  attacker.attackAnimationUntilMs = nowMs + config.biteAnimationMs;
  attacker.status = "attacking";

  const damage = Math.max(1, Math.floor(attacker.attackDamage || config.baseBiteDamage));
  target.lastHurtAtMs = nowMs;
  target.lastDamageTaken = damage;
  target.damageSeq += 1;
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp <= 0) return killFishOnce(target, nowMs, config);
  return { hit: true, killed: false, respawnAtMs: null };
}

/** Jellyfish deal one HP on contact; a per-fish cooldown prevents frame-by-frame damage loops. */
export function resolveJellyfishCollision(
  fish: AquaLifeFish,
  jellyfish: AquaLifeJellyfish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): CombatResult {
  if (fish.status === "dead" || fish.status === "respawning" || fish.status === "spawning") {
    return { hit: false, killed: false, respawnAtMs: null };
  }
  if (fish.lastJellyfishHitAtMs !== null && nowMs - fish.lastJellyfishHitAtMs < config.jellyfishHitCooldownMs) {
    return { hit: false, killed: false, respawnAtMs: null };
  }
  const fishRadius = Math.max(0, fish.size) * config.fishCollisionRadiusPerSize;
  const jellyfishRadius = Math.max(0, jellyfish.size);
  const touching = Math.hypot(fish.x - jellyfish.x, fish.y - jellyfish.y) <= fishRadius + jellyfishRadius;
  if (!touching) return { hit: false, killed: false, respawnAtMs: null };

  fish.lastJellyfishHitAtMs = nowMs;
  fish.lastHurtAtMs = nowMs;
  fish.hp = Math.max(0, fish.hp - config.jellyfishDamage);
  if (fish.hp <= 0) return killFishOnce(fish, nowMs, config);
  return { hit: true, killed: false, respawnAtMs: null };
}

/** Respawn reuses the same fish entity and keeps its elite appearance and progression. */
export function respawnFish(fish: AquaLifeFish, world: AquaLifeWorld, nowMs: number): boolean {
  if (fish.status !== "dead" || fish.respawnAtMs === null || nowMs < fish.respawnAtMs) return false;
  fish.status = "respawning";
  fish.hp = Math.max(1, fish.hp);
  const spawnOffset = Math.max(20, fish.size * 20);
  const fromLeft = Math.random() < 0.5;
  const entryAngle = (Math.random() - 0.5) * 0.7;
  fish.x = fromLeft ? -spawnOffset : world.width + spawnOffset;
  fish.y = world.height * (0.18 + Math.random() * 0.64);
  fish.directionX = (fromLeft ? 1 : -1) * Math.cos(entryAngle);
  fish.directionY = Math.sin(entryAngle);
  fish.targetDirectionX = fish.directionX;
  fish.targetDirectionY = fish.directionY;
  fish.wanderTimeRemaining = 2 + Math.random() * 5;
  fish.targetX = Number.NaN;
  fish.targetY = Number.NaN;
  fish.turnVelocity = 0;
  fish.currentSpeedPxPerSecond = 0;
  fish.strokePulse = 0;
  fish.hoverRemainingSeconds = 0;
  fish.attackCooldownUntilMs = nowMs;
  fish.attackAnimationUntilMs = 0;
  fish.lastHurtAtMs = null;
  fish.lastJellyfishHitAtMs = null;
  fish.respawnAtMs = null;
  return true;
}
