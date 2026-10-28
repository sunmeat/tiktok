import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeWorld } from "./types.js";

export type RandomSource = () => number;

/** Steers fish toward slowly changing targets and keeps them inside the logical world. */
export function updateFishMovement(
  fish: AquaLifeFish,
  world: AquaLifeWorld,
  deltaSeconds: number,
  random: RandomSource = Math.random,
  neighbors: readonly AquaLifeFish[] = [],
  config: AquaLifeConfig = AQUALIFE_CONFIG
): void {
  if (fish.status === "dead" || fish.status === "respawning" || deltaSeconds <= 0) return;

  fish.wanderTimeRemaining -= deltaSeconds;
  if (fish.wanderTimeRemaining <= 0) {
    const angle = random() * Math.PI * 2;
    fish.targetDirectionX = Math.cos(angle);
    fish.targetDirectionY = Math.sin(angle);
    const intervalRange = config.maxWanderIntervalSeconds - config.minWanderIntervalSeconds;
    fish.wanderTimeRemaining = config.minWanderIntervalSeconds + random() * Math.max(0, intervalRange);
  }

  const margin = Math.min(Math.max(1, fish.size * 12), Math.min(world.width, world.height) / 2);
  const edgeX = Math.max(margin, Math.min(world.width - margin, fish.x));
  const edgeY = Math.max(margin, Math.min(world.height - margin, fish.y));
  const edgeRange = Math.max(1, margin * 3);
  const edgeSteerX = (edgeRange / Math.max(1, fish.x - margin) - edgeRange / Math.max(1, world.width - margin - fish.x)) * 0.02;
  const edgeSteerY = (edgeRange / Math.max(1, fish.y - margin) - edgeRange / Math.max(1, world.height - margin - fish.y)) * 0.02;

  let steerX = fish.targetDirectionX + edgeSteerX;
  let steerY = fish.targetDirectionY + edgeSteerY;

  // Soft separation only steers; it never changes collision or combat outcomes.
  if (neighbors.length > 1 && config.separationStrength > 0) {
    let separationX = 0;
    let separationY = 0;
    let nearby = 0;
    for (const other of neighbors) {
      if (other.id === fish.id || other.status === "dead") continue;
      const dx = fish.x - other.x;
      const dy = fish.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < config.separationRadius) {
        const weight = (config.separationRadius - distance) / config.separationRadius;
        separationX += (dx / distance) * weight;
        separationY += (dy / distance) * weight;
        nearby++;
      }
    }
    if (nearby) {
      steerX += (separationX / nearby) * config.separationStrength;
      steerY += (separationY / nearby) * config.separationStrength;
    }
  }

  const desiredMagnitude = Math.hypot(steerX, steerY);
  if (desiredMagnitude > 0.0001) {
    steerX /= desiredMagnitude;
    steerY /= desiredMagnitude;
    const turnAlpha = Math.min(1, Math.max(0, fish.turnRateRadiansPerSecond) * deltaSeconds);
    fish.directionX += (steerX - fish.directionX) * turnAlpha;
    fish.directionY += (steerY - fish.directionY) * turnAlpha;
  }

  const directionMagnitude = Math.hypot(fish.directionX, fish.directionY) || 1;
  fish.directionX /= directionMagnitude;
  fish.directionY /= directionMagnitude;

  const speed = Math.max(config.minSpeedPxPerSecond, Math.min(config.maxSpeedPxPerSecond, fish.speedPxPerSecond));
  fish.x += fish.directionX * speed * deltaSeconds;
  fish.y += fish.directionY * speed * deltaSeconds;

  // Clamp and turn inward immediately if a frame would cross a world boundary.
  if (fish.x < margin) {
    fish.x = margin;
    fish.directionX = Math.abs(fish.directionX);
    fish.targetDirectionX = Math.abs(fish.targetDirectionX);
  } else if (fish.x > world.width - margin) {
    fish.x = world.width - margin;
    fish.directionX = -Math.abs(fish.directionX);
    fish.targetDirectionX = -Math.abs(fish.targetDirectionX);
  }
  if (fish.y < margin) {
    fish.y = margin;
    fish.directionY = Math.abs(fish.directionY);
    fish.targetDirectionY = Math.abs(fish.targetDirectionY);
  } else if (fish.y > world.height - margin) {
    fish.y = world.height - margin;
    fish.directionY = -Math.abs(fish.directionY);
    fish.targetDirectionY = -Math.abs(fish.targetDirectionY);
  }

  // Keep finite coordinates even if malformed state enters the simulation.
  fish.x = Number.isFinite(fish.x) ? Math.max(margin, Math.min(world.width - margin, fish.x)) : edgeX;
  fish.y = Number.isFinite(fish.y) ? Math.max(margin, Math.min(world.height - margin, fish.y)) : edgeY;
}
