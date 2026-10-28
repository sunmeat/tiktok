import type { AquaLifeFish, AquaLifeWorld } from "./types.js";

export type RandomSource = () => number;

export function updateFishMovement(
  fish: AquaLifeFish,
  world: AquaLifeWorld,
  deltaSeconds: number,
  random: RandomSource = Math.random
): void {
  if (fish.status === "dead" || fish.status === "respawning" || deltaSeconds <= 0) return;
  if (random() < Math.min(1, deltaSeconds * 0.25)) {
    const angle = random() * Math.PI * 2;
    fish.directionX = Math.cos(angle);
    fish.directionY = Math.sin(angle);
  }
  const magnitude = Math.hypot(fish.directionX, fish.directionY) || 1;
  fish.directionX /= magnitude;
  fish.directionY /= magnitude;
  fish.x += fish.directionX * fish.speedPxPerSecond * deltaSeconds;
  fish.y += fish.directionY * fish.speedPxPerSecond * deltaSeconds;

  const margin = Math.max(1, fish.size * 12);
  if (fish.x < margin || fish.x > world.width - margin) fish.directionX *= -1;
  if (fish.y < margin || fish.y > world.height - margin) fish.directionY *= -1;
  fish.x = Math.max(margin, Math.min(world.width - margin, fish.x));
  fish.y = Math.max(margin, Math.min(world.height - margin, fish.y));
}
