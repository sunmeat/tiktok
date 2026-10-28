import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import type { AquaLifeFish, AquaLifeWorld } from "./types.js";

export type RandomSource = () => number;

const TWO_PI = Math.PI * 2;

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= TWO_PI;
  while (value < -Math.PI) value += TWO_PI;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Arrival radius around a waypoint. Capped so very large (heavily liked) fish still swim to their waypoints. */
function arrivalRadius(fish: AquaLifeFish): number {
  return 12 + Math.min(fish.size, 3) * 6;
}

/** Cheap smooth pseudo-noise in [-1, 1]: two incommensurate sines, no allocation. */
function smoothNoise(timeSeconds: number, phase: number): number {
  return 0.6 * Math.sin(timeSeconds * 0.37 + phase) + 0.4 * Math.sin(timeSeconds * 0.91 + phase * 2.3);
}

/** Picks a nearby waypoint roughly ahead of the fish so the path is a smooth arc, not a zig-zag. */
function pickWaypoint(
  fish: AquaLifeFish,
  world: AquaLifeWorld,
  margin: number,
  random: RandomSource,
  config: AquaLifeConfig
): void {
  const heading = Math.atan2(fish.directionY, fish.directionX);
  const inset = Math.min(margin * 1.5, Math.min(world.width, world.height) / 2 - 1);
  if (random() < 0.35) {
    // Roam: head for any spot in the tank (up, down, left or right) so idle fish keep
    // exploring the whole aquarium instead of lingering along the walls. The turn-rate limit
    // still makes the path a smooth arc, and there is no fixed target such as the center.
    fish.targetX = inset + random() * Math.max(1, world.width - inset * 2);
    fish.targetY = inset + random() * Math.max(1, world.height - inset * 2);
  } else {
    // Mostly gentle course changes (about +/-60 degrees); occasionally a wide one to explore.
    const spread = random() < 0.2 ? 2.0 : 1.05;
    const angle = heading + (random() * 2 - 1) * spread;
    const distance = config.waypointMinDistance + random() * Math.max(0, config.waypointMaxDistance - config.waypointMinDistance);
    fish.targetX = clamp(fish.x + Math.cos(angle) * distance, inset, world.width - inset);
    fish.targetY = clamp(fish.y + Math.sin(angle) * distance, inset, world.height - inset);
  }
  const intervalRange = Math.max(0, config.maxWanderIntervalSeconds - config.minWanderIntervalSeconds);
  fish.wanderTimeRemaining = Math.max(3.5, config.minWanderIntervalSeconds + random() * intervalRange);
}

/**
 * Natural fish locomotion (no center attraction, no deliberate collision targets):
 *
 * 1. Waypoints: the fish picks a nearby point and swims there; on arrival, or when the
 *    wander timer ends, it either hovers in place for a moment or picks a new waypoint.
 * 2. Smooth turning: heading follows the steering direction through a limited, smoothed
 *    angular velocity. The turn rate depends on speed (a turning radius), so a fish never
 *    snaps to a new direction.
 * 3. Burst-and-coast: speed jumps with each tail stroke and then decays exponentially.
 *    The stroke impulse is scaled so the AVERAGE speed equals the like-driven speed
 *    (`fish.speedPxPerSecond`), keeping the confirmed likes-to-speed mapping intact.
 *    Strokes stop when the fish nears its waypoint, so it glides to a halt.
 * 4. Hovering: with no stroke the fish drifts almost still; the renderer adds the
 *    small balancing sway.
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

  const dt = deltaSeconds;
  const margin = Math.min(Math.max(1, fish.size * 12), Math.min(world.width, world.height) / 2);
  const speedTarget = clamp(fish.speedPxPerSecond, config.minSpeedPxPerSecond, config.maxSpeedPxPerSecond);
  fish.noiseTimeSeconds += dt;

  // --- Behavior state: hover / waypoint selection ---
  let hovering = fish.hoverRemainingSeconds > 0;
  if (hovering) {
    fish.hoverRemainingSeconds -= dt;
    if (fish.hoverRemainingSeconds <= 0) {
      fish.hoverRemainingSeconds = 0;
      hovering = false;
      pickWaypoint(fish, world, margin, random, config);
    }
  } else {
    fish.wanderTimeRemaining -= dt;
    const hasWaypoint = Number.isFinite(fish.targetX) && Number.isFinite(fish.targetY);
    const arriveRadius = arrivalRadius(fish);
    const arrived = hasWaypoint && Math.hypot(fish.targetX - fish.x, fish.targetY - fish.y) < arriveRadius;
    if (!hasWaypoint) {
      pickWaypoint(fish, world, margin, random, config);
    } else if (fish.wanderTimeRemaining <= 0 || arrived) {
      // Fast (liked) fish rarely stop; idle fish pause now and then.
      const activity = clamp(1 - (speedTarget - config.minSpeedPxPerSecond) / 18, 0.1, 1);
      if (random() < config.hoverChance * activity) {
        fish.hoverRemainingSeconds = config.hoverMinSeconds + random() * Math.max(0, config.hoverMaxSeconds - config.hoverMinSeconds);
        fish.wanderTimeRemaining = fish.hoverRemainingSeconds;
        hovering = true;
      } else {
        pickWaypoint(fish, world, margin, random, config);
      }
    }
  }

  // --- Steering: waypoint, soft wall avoidance, separation, and a little smooth noise ---
  let heading = Math.atan2(fish.directionY, fish.directionX);
  let toTargetX = Math.cos(heading);
  let toTargetY = Math.sin(heading);
  let targetDistance = Number.POSITIVE_INFINITY;
  if (Number.isFinite(fish.targetX) && Number.isFinite(fish.targetY)) {
    const dx = fish.targetX - fish.x;
    const dy = fish.targetY - fish.y;
    targetDistance = Math.hypot(dx, dy);
    if (targetDistance > 0.001) {
      toTargetX = dx / targetDistance;
      toTargetY = dy / targetDistance;
    }
  }

  const safeWidth = Math.max(1, world.width - margin * 2);
  const safeHeight = Math.max(1, world.height - margin * 2);
  // Avoid only nearby walls. The tank center is not a destination or attraction point.
  const avoidXDistance = safeWidth * 0.14;
  const avoidYDistance = safeHeight * 0.12;
  const leftDistance = fish.x - margin;
  const rightDistance = world.width - margin - fish.x;
  const topDistance = fish.y - margin;
  const bottomDistance = world.height - margin - fish.y;
  const edgeAvoidX = leftDistance < avoidXDistance
    ? (1 - Math.max(0, leftDistance) / avoidXDistance)
    : rightDistance < avoidXDistance
      ? -(1 - Math.max(0, rightDistance) / avoidXDistance)
      : 0;
  const edgeAvoidY = topDistance < avoidYDistance
    ? (1 - Math.max(0, topDistance) / avoidYDistance)
    : bottomDistance < avoidYDistance
      ? -(1 - Math.max(0, bottomDistance) / avoidYDistance)
      : 0;

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

  // While hovering the fish keeps its heading instead of chasing the (old) waypoint.
  const goalWeight = hovering ? 0.15 : 1;
  const desiredX = toTargetX * goalWeight + (hovering ? Math.cos(heading) : 0) + edgeAvoidX * 1.4 +
    (nearby ? separationX / nearby * config.separationStrength : 0);
  const desiredY = toTargetY * goalWeight + (hovering ? Math.sin(heading) : 0) + edgeAvoidY * 1.4 +
    (nearby ? separationY / nearby * config.separationStrength : 0);

  // --- Turning: limited, smoothed angular velocity (turning radius grows with speed) ---
  if (Math.hypot(desiredX, desiredY) > 0.0001) {
    const noise = hovering ? 0 : smoothNoise(fish.noiseTimeSeconds, fish.noisePhase) * 0.3;
    const desiredAngle = Math.atan2(desiredY, desiredX) + noise;
    const angleError = wrapAngle(desiredAngle - heading);
    const maxOmega = clamp(
      fish.currentSpeedPxPerSecond / Math.max(1, config.turnRadiusPerSize * fish.size),
      config.minTurnRateRadiansPerSecond,
      Math.max(config.minTurnRateRadiansPerSecond, Math.min(fish.turnRateRadiansPerSecond, config.maxTurnRateRadiansPerSecond))
    );
    const desiredOmega = clamp(angleError * 2.2, -maxOmega, maxOmega);
    // Exponential smoothing is stable across different frame rates.
    fish.turnVelocity += (desiredOmega - fish.turnVelocity) * (1 - Math.exp(-4 * dt));
  } else {
    fish.turnVelocity *= Math.exp(-4 * dt);
  }
  heading += fish.turnVelocity * dt;
  fish.directionX = Math.cos(heading);
  fish.directionY = Math.sin(heading);

  // --- Burst-and-coast speed ---
  const baseInterval = clamp(
    config.maxStrokeIntervalSeconds - (speedTarget - config.minSpeedPxPerSecond) * 0.012,
    config.minStrokeIntervalSeconds,
    config.maxStrokeIntervalSeconds
  ) * fish.strokeRhythm;
  const drag = config.strokeGlideFactor / Math.max(0.1, baseInterval);
  fish.currentSpeedPxPerSecond *= Math.exp(-drag * dt * (hovering ? 2.2 : 1));
  fish.strokeTimerSeconds -= dt;
  fish.strokePulse *= Math.exp(-dt / 0.55);
  if (fish.strokeTimerSeconds <= 0) {
    // Near the waypoint the fish stops stroking and glides to a halt.
    const glidingToStop = targetDistance < 2 * arrivalRadius(fish);
    if (!hovering && !glidingToStop) {
      // impulse = glide * mean speed keeps the long-run average equal to speedTarget.
      fish.currentSpeedPxPerSecond += config.strokeGlideFactor * speedTarget * (0.85 + random() * 0.3);
      fish.strokePulse = 1;
      fish.strokeTimerSeconds += baseInterval * (0.85 + random() * 0.3);
    } else {
      fish.strokeTimerSeconds = 0.2;
    }
  }
  fish.currentSpeedPxPerSecond = clamp(fish.currentSpeedPxPerSecond, 0, config.maxSpeedPxPerSecond * 2.2);

  fish.x += fish.directionX * fish.currentSpeedPxPerSecond * dt;
  fish.y += fish.directionY * fish.currentSpeedPxPerSecond * dt;

  // --- Walls: keep inside the tank and aim the next waypoint away from the wall ---
  let wallNormalX = 0;
  let wallNormalY = 0;
  if (fish.x < margin) { fish.x = margin; wallNormalX = 1; }
  else if (fish.x > world.width - margin) { fish.x = world.width - margin; wallNormalX = -1; }
  if (fish.y < margin) { fish.y = margin; wallNormalY = 1; }
  else if (fish.y > world.height - margin) { fish.y = world.height - margin; wallNormalY = -1; }
  if (wallNormalX !== 0 || wallNormalY !== 0) {
    const inset = Math.min(margin * 1.5, Math.min(world.width, world.height) / 2 - 1);
    fish.targetX = clamp(fish.x + wallNormalX * 110 - wallNormalY * 30, inset, world.width - inset);
    fish.targetY = clamp(fish.y + wallNormalY * 110 + wallNormalX * 30, inset, world.height - inset);
    fish.wanderTimeRemaining = Math.max(fish.wanderTimeRemaining, 3);
    fish.hoverRemainingSeconds = 0;
  }

  fish.x = Number.isFinite(fish.x) ? clamp(fish.x, margin, world.width - margin) : clamp(world.width / 2, margin, world.width - margin);
  fish.y = Number.isFinite(fish.y) ? clamp(fish.y, margin, world.height - margin) : clamp(world.height / 2, margin, world.height - margin);
  if (!Number.isFinite(fish.directionX) || !Number.isFinite(fish.directionY)) {
    fish.directionX = 1;
    fish.directionY = 0;
  }
  if (!Number.isFinite(fish.currentSpeedPxPerSecond)) fish.currentSpeedPxPerSecond = 0;
  if (!Number.isFinite(fish.turnVelocity)) fish.turnVelocity = 0;
}
