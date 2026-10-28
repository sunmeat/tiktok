import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeJellyfish, AquaLifeWorld } from "./types.js";

export interface CombatResult {
  hit: boolean;
  killed: boolean;
  respawnAtMs: number | null;
}

/** Larger fish can eat a smaller fish; equal-sized fish do not eat each other. */
export function resolveFishBite(
  attacker: AquaLifeFish,
  target: AquaLifeFish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): CombatResult {
  if (attacker.id === target.id || attacker.status === "dead" || target.status === "dead" || attacker.size <= target.size) {
    return { hit: false, killed: false, respawnAtMs: null };
  }
  target.hp = Math.max(0, target.hp - Math.max(1, attacker.attackDamage || config.baseBiteDamage));
  if (target.hp > 0) return { hit: true, killed: false, respawnAtMs: null };
  target.status = "dead";
  target.respawnAtMs = nowMs + config.respawnDelayMs;
  return { hit: true, killed: true, respawnAtMs: target.respawnAtMs };
}

export function resolveJellyfishCollision(
  fish: AquaLifeFish,
  jellyfish: AquaLifeJellyfish,
  nowMs: number,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): CombatResult {
  const touching = Math.hypot(fish.x - jellyfish.x, fish.y - jellyfish.y) <= (fish.size + jellyfish.size);
  if (!touching || fish.status === "dead") return { hit: false, killed: false, respawnAtMs: null };
  fish.hp = Math.max(0, fish.hp - config.jellyfishDamage);
  if (fish.hp > 0) return { hit: true, killed: false, respawnAtMs: null };
  fish.status = "dead";
  fish.respawnAtMs = nowMs + config.respawnDelayMs;
  return { hit: true, killed: true, respawnAtMs: fish.respawnAtMs };
}

export function respawnFish(fish: AquaLifeFish, world: AquaLifeWorld, nowMs: number): boolean {
  if (fish.status !== "dead" || fish.respawnAtMs === null || nowMs < fish.respawnAtMs) return false;
  fish.status = "respawning";
  fish.hp = Math.max(1, fish.hp);
  fish.x = world.width / 2;
  fish.y = -Math.max(20, fish.size * 20);
  fish.directionX = 0;
  fish.directionY = 1;
  fish.respawnAtMs = null;
  return true;
}
