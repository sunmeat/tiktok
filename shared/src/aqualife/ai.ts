import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeWorld } from "./types.js";

export type RandomSource = () => number;

/**
 * Natural aquarium wandering: fish cruise in a direction for a while, then
 * make broad, gradual course changes. They do not pick a totally new heading
 * every second, which creates the artificial orbiting seen with random-angle AI.
 */
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
    const currentHeading = Math.atan2(fish.directionY, fish.directionX);
    // Most turns are gentle; occasional larger turns keep fish exploring the whole tank.
    const turn = (random() < 0.22 ? 0.9 : 0.18) + random() * (random() < 0.22 ? 0.8 : 0.72);
    const signedTurn = (random() < 0.5 ? -1 : 1) * turn;
    const heading = currentHeading + signedTurn;
    fish.targetDirectionX = Math.cos(heading);
    fish.targetDirectionY = Math.sin(heading);
    const intervalRange = Math.max(0, config.maxWanderIntervalSeconds - config.minWanderIntervalSeconds);
    fish.wanderTimeRemaining = Math.max(2.8, config.minWanderIntervalSeconds + random() * intervalRange);
  }

  const margin = Math.min(Math.max(1, fish.size * 12), Math.min(world.width, world.height) / 2);
  const edgeX = Math.max(margin, Math.min(world.width - margin, fish.x));
  const edgeY = Math.max(margin, Math.min(world.height - margin, fish.y));
  const safeWidth = Math.max(1, world.width - margin * 2);
  const safeHeight = Math.max(1, world.height - margin * 2);
  const edgeProximityX = Math.min(1, Math.min(fish.x - margin, world.width - margin - fish.x) / Math.max(1, safeWidth * 0.18));
  const edgeProximityY = Math.min(1, Math.min(fish.y - margin, world.height - margin - fish.y) / Math.max(1, safeHeight * 0.14));
  const edgePushX = fish.x < world.width * 0.5 ? 1 : -1;
  const edgePushY = fish.y < world.height * 0.5 ? 1 : -1;
  const steerX = fish.targetDirectionX + edgePushX * (1 - Math.max(0, edgeProximityX)) * 1.25;
  const steerY = fish.targetDirectionY + edgePushY * (1 - Math.max(0, edgeProximityY)) * 1.25;

  let separationX = 0;
  let separationY = 0;
  let nearby = 0;
  if (neighbors.length > 1 && config.separationStrength > 0) {
    for (const other of neighbors) {
      if (other.id === fish.id || other.status === "dead" || other.status === "respawning") continue;
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
  }

  let desiredX = steerX + (nearby ? separationX / nearby * config.separationStrength : 0);
  let desiredY = steerY + (nearby ? separationY / nearby * config.separationStrength : 0);
  const desiredLength = Math.hypot(desiredX, desiredY);
  if (desiredLength > 0.0001) {
    desiredX /= desiredLength;
    desiredY /= desiredLength;
    // Exponential interpolation is stable across different frame rates.
    const turnAlpha = 1 - Math.exp(-Math.min(3.2, Math.max(0.35, fish.turnRateRadiansPerSecond * 0.48)) * deltaSeconds);
    fish.directionX += (desiredX - fish.directionX) * turnAlpha;
    fish.directionY += (desiredY - fish.directionY) * turnAlpha;
  }

  const directionMagnitude = Math.hypot(fish.directionX, fish.directionY) || 1;
  fish.directionX /= directionMagnitude;
  fish.directionY /= directionMagnitude;
  const speed = Math.max(config.minSpeedPxPerSecond, Math.min(config.maxSpeedPxPerSecond, fish.baseSpeedPxPerSecond + fish.speedPxPerSecond));
  fish.x += fish.directionX * speed * deltaSeconds;
  fish.y += fish.directionY * speed * deltaSeconds;

  if (fish.x < margin) {
    fish.x = margin;
    fish.directionX = Math.abs(fish.directionX);
    fish.targetDirectionX = Math.abs(fish.targetDirectionX);
    fish.wanderTimeRemaining = Math.min(fish.wanderTimeRemaining, 0.4);
  } else if (fish.x > world.width - margin) {
    fish.x = world.width - margin;
    fish.directionX = -Math.abs(fish.directionX);
    fish.targetDirectionX = -Math.abs(fish.targetDirectionX);
    fish.wanderTimeRemaining = Math.min(fish.wanderTimeRemaining, 0.4);
  }
  if (fish.y < margin) {
    fish.y = margin;
    fish.directionY = Math.abs(fish.directionY);
    fish.targetDirectionY = Math.abs(fish.targetDirectionY);
    fish.wanderTimeRemaining = Math.min(fish.wanderTimeRemaining, 0.4);
  } else if (fish.y > world.height - margin) {
    fish.y = world.height - margin;
    fish.directionY = -Math.abs(fish.directionY);
    fish.targetDirectionY = -Math.abs(fish.targetDirectionY);
    fish.wanderTimeRemaining = Math.min(fish.wanderTimeRemaining, 0.4);
  }

  fish.x = Number.isFinite(fish.x) ? Math.max(margin, Math.min(world.width - margin, fish.x)) : edgeX;
  fish.y = Number.isFinite(fish.y) ? Math.max(margin, Math.min(world.height - margin, fish.y)) : edgeY;
}
