import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import { updateFishMovement, type RandomSource } from "./ai.js";
import { resolveFishBite, resolveJellyfishCollision, respawnFish } from "./combat.js";
import { applyLikeReward, updateLikeActivitySpeed } from "./rewards.js";
import { speciesForGiftId } from "./species.js";
import type {
  AquaLifeFish,
  AquaLifeGameState,
  AquaLifeJellyfish,
  AquaLifeParticipant,
  AquaLifeRenderSnapshot,
  NormalizedGameEvent
} from "./types.js";

function safeWorldDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

/** Logical world dimensions never depend on the browser or canvas size. */
export function createAquaLifeState(
  width = AQUALIFE_CONFIG.defaultWorldWidth,
  height = AQUALIFE_CONFIG.defaultWorldHeight,
  nowMs = 0
): AquaLifeGameState {
  return {
    world: {
      width: safeWorldDimension(width, AQUALIFE_CONFIG.defaultWorldWidth),
      height: safeWorldDimension(height, AQUALIFE_CONFIG.defaultWorldHeight)
    },
    participants: Object.create(null) as Record<string, AquaLifeParticipant>,
    fish: Object.create(null) as Record<string, AquaLifeFish>,
    jellyfish: Object.create(null) as Record<string, AquaLifeJellyfish>,
    activeParticipantCount: 0,
    livingFishCount: 0,
    nextEntityNumber: 1,
    processedEventIds: [],
    nowMs: Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : 0
  };
}

function ensureParticipant(
  state: AquaLifeGameState,
  event: NormalizedGameEvent,
  config: AquaLifeConfig
): AquaLifeParticipant | null {
  let participant = state.participants[event.userId];
  if (!participant) {
    if (Object.keys(state.participants).length >= config.maxParticipants) return null;
    participant = {
      userId: event.userId,
      nickname: event.nickname || event.userId,
      avatarUrl: event.avatarUrl,
      isActive: true,
      isFollowing: false,
      likesTotal: 0,
      likesRemainderForHp: 0,
      unlockedSpecies: [],
      subscribed: false
    };
    state.participants[event.userId] = participant;
  }
  if (event.nickname) participant.nickname = event.nickname;
  if (event.avatarUrl) participant.avatarUrl = event.avatarUrl;
  return participant;
}

/** Creates at most one fish per participant and never exceeds maxFish. */
export function createFishForParticipant(
  state: AquaLifeGameState,
  participant: AquaLifeParticipant,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): AquaLifeFish | null {
  const preferredSpecies = participant.unlockedSpecies.at(-1) ?? (participant.subscribed ? "dory" : "standard-gray");
  const existing = state.fish[participant.userId];
  if (existing) {
    existing.isAiControlled = !participant.isActive;
    existing.nickname = participant.nickname;
    existing.avatarUrl = participant.avatarUrl;
    existing.species = preferredSpecies;
    existing.size = existing.baseSize * (1 + config.sizeGrowthPerThreshold * Math.floor(participant.likesTotal / config.likesPerSizeGrowth));
    return existing;
  }
  if (Object.keys(state.fish).length >= config.maxFish) return null;
  const fish: AquaLifeFish = {
    id: `fish-${state.nextEntityNumber++}`,
    participantId: participant.userId,
    nickname: participant.nickname,
    avatarUrl: participant.avatarUrl,
    species: preferredSpecies,
    status: "respawning",
    x: Math.random() < 0.5 ? -Math.max(20, config.baseFishSize * 20) : state.world.width + Math.max(20, config.baseFishSize * 20),
    y: state.world.height * (0.08 + Math.random() * 0.84),
    directionX: Math.random() < 0.5 ? 1 : -1,
    directionY: 0,
    targetDirectionX: Math.cos(((state.nextEntityNumber - 1) % 12) * Math.PI / 6),
    targetDirectionY: Math.sin(((state.nextEntityNumber - 1) % 12) * Math.PI / 6),
    wanderTimeRemaining: 1 + ((state.nextEntityNumber - 1) % 7) * 0.35,
    turnRateRadiansPerSecond: Math.min(config.maxTurnRateRadiansPerSecond, 1.2 + ((state.nextEntityNumber - 1) % 5) * 0.3),
    speedTargetPxPerSecond: config.baseSpeedPxPerSecond,
    lastSpeedUpdateAtMs: state.nowMs,
    baseSpeedPxPerSecond: config.baseSpeedPxPerSecond,
    speedPxPerSecond: config.baseSpeedPxPerSecond,
    baseSize: config.baseFishSize,
    size: config.baseFishSize * (1 + config.sizeGrowthPerThreshold * Math.floor(participant.likesTotal / config.likesPerSizeGrowth)),
    hp: config.initialHp,
    maxHp: null,
    baseAttackDamage: config.baseBiteDamage,
    attackDamage: config.baseBiteDamage,
    isAiControlled: !participant.isActive,
    likesPerSecondSamples: [],
    lastLikeAtMs: null,
    lastHealAtMs: null,
    lastGrowthAtMs: null,
    lastHurtAtMs: null,
    lastAttackAtMs: null,
    attackCooldownUntilMs: state.nowMs,
    attackAnimationUntilMs: 0,
    lastJellyfishHitAtMs: null,
    respawnAtMs: null,
    buffs: []
  };
  state.fish[participant.userId] = fish;
  return fish;
}

/** Reactivates an existing participant without replacing their fish entity. */
export function activateParticipant(state: AquaLifeGameState, userId: string, config: AquaLifeConfig = AQUALIFE_CONFIG): boolean {
  const participant = state.participants[userId];
  if (!participant) return false;
  participant.isActive = true;
  const fish = createFishForParticipant(state, participant, config);
  if (fish) fish.isAiControlled = false;
  recalculateCounts(state);
  return fish !== null;
}

/** Keeps the fish alive and switches its behavior to AI control. */
export function deactivateParticipant(state: AquaLifeGameState, userId: string): boolean {
  const participant = state.participants[userId];
  if (!participant) return false;
  participant.isActive = false;
  const fish = state.fish[userId];
  if (fish) fish.isAiControlled = true;
  recalculateCounts(state);
  return true;
}

/** Permanently removes a fish entity; does not silently delete participant history. */
export function removeFish(state: AquaLifeGameState, fishId: string): boolean {
  const entry = Object.entries(state.fish).find(([, fish]) => fish.id === fishId);
  if (!entry) return false;
  delete state.fish[entry[0]];
  recalculateCounts(state);
  return true;
}

/** Permanently removes a participant and their fish. */
export function removeParticipant(state: AquaLifeGameState, userId: string): boolean {
  if (!state.participants[userId]) return false;
  delete state.participants[userId];
  delete state.fish[userId];
  recalculateCounts(state);
  return true;
}

export function addJellyfish(
  state: AquaLifeGameState,
  jellyfish: AquaLifeJellyfish,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): boolean {
  if (!jellyfish.id || !jellyfish.id.trim()) return false;
  if (!state.jellyfish[jellyfish.id] && Object.keys(state.jellyfish).length >= config.maxJellyfish) return false;
  const rawDirectionX = Number.isFinite(jellyfish.directionX) ? jellyfish.directionX : 1;
  const rawDirectionY = Number.isFinite(jellyfish.directionY) ? jellyfish.directionY : 0;
  const directionLength = Math.hypot(rawDirectionX, rawDirectionY);
  const normalized: AquaLifeJellyfish = {
    ...jellyfish,
    x: Number.isFinite(jellyfish.x) ? Math.max(0, Math.min(state.world.width, jellyfish.x)) : state.world.width / 2,
    y: Number.isFinite(jellyfish.y) ? Math.max(0, Math.min(state.world.height, jellyfish.y)) : state.world.height / 2,
    directionX: directionLength > 0.0001 ? rawDirectionX / directionLength : 1,
    directionY: directionLength > 0.0001 ? rawDirectionY / directionLength : 0,
    speedPxPerSecond: Number.isFinite(jellyfish.speedPxPerSecond) && jellyfish.speedPxPerSecond > 0
      ? Math.min(config.maxSpeedPxPerSecond, jellyfish.speedPxPerSecond)
      : config.jellyfishBaseSpeedPxPerSecond,
    size: Number.isFinite(jellyfish.size) && jellyfish.size > 0 ? jellyfish.size : 8
  };
  state.jellyfish[jellyfish.id] = normalized;
  return true;
}

export function removeJellyfish(state: AquaLifeGameState, jellyfishId: string): boolean {
  if (!state.jellyfish[jellyfishId]) return false;
  delete state.jellyfish[jellyfishId];
  return true;
}

export function processGameEvent(
  state: AquaLifeGameState,
  event: NormalizedGameEvent,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): void {
  if (event.dedupeKey) {
    if (state.processedEventIds.includes(event.dedupeKey)) return;
    state.processedEventIds.push(event.dedupeKey);
    if (state.processedEventIds.length > config.maxProcessedEventIds) state.processedEventIds.shift();
  }
  if (event.type === "viewer-left") {
    deactivateParticipant(state, event.userId);
    return;
  }
  const participant = ensureParticipant(state, event, config);
  if (!participant) return;
  if (event.type === "viewer-joined") {
    participant.isActive = true;
    const fish = createFishForParticipant(state, participant, config);
    if (fish) fish.isAiControlled = false;
  } else if (event.type === "like") {
    participant.isActive = true;
    const fish = createFishForParticipant(state, participant, config);
    if (fish) {
      applyLikeReward(participant, fish, event.count ?? 1, event.receivedAtMs, config);
      fish.isAiControlled = false;
    }
  } else if (event.type === "follow") {
    participant.isFollowing = true;
    participant.isActive = true;
    const fish = createFishForParticipant(state, participant, config);
    if (fish) fish.isAiControlled = false;
  } else if (event.type === "subscribe") {
    participant.isActive = true;
    participant.subscribed = true;
    const fish = createFishForParticipant(state, participant, config);
    if (fish) {
      if (participant.unlockedSpecies.length === 0) fish.species = "dory";
      fish.isAiControlled = false;
    }
  } else if (event.type === "gift") {
    participant.isActive = true;
    const species = speciesForGiftId(event.giftId);
    if (species && !participant.unlockedSpecies.includes(species)) participant.unlockedSpecies.push(species);
    const fish = createFishForParticipant(state, participant, config);
    if (fish) fish.isAiControlled = false;
  } else if (event.type === "chat") {
    participant.isActive = true;
    const fish = createFishForParticipant(state, participant, config);
    if (fish) fish.isAiControlled = false;
  }
  recalculateCounts(state);
}

export function stepAquaLife(
  state: AquaLifeGameState,
  deltaMs: number,
  nowMs = state.nowMs + deltaMs,
  random: RandomSource = Math.random,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): void {
  const boundedDelta = Math.max(0, Math.min(Number.isFinite(deltaMs) ? deltaMs : 0, 250));
  state.nowMs = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : state.nowMs + boundedDelta;
  const allFish = Object.values(state.fish);
  for (const fish of allFish) {
    updateLikeActivitySpeed(fish, state.nowMs, config);
    if (fish.status === "dead") {
      if (!state.participants[fish.participantId]?.isActive) {
        if (fish.respawnAtMs !== null && state.nowMs >= fish.respawnAtMs) removeFish(state, fish.id);
      } else {
        respawnFish(fish, state.world, state.nowMs);
      }
      continue;
    }
    if (fish.status === "respawning") {
      const targetX = state.world.width / 2;
      const targetY = state.world.height / 2;
      const dx = targetX - fish.x;
      const dy = targetY - fish.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 8) fish.status = "swimming";
      else {
        fish.directionX = dx / (distance || 1);
        fish.directionY = dy / (distance || 1);
        // Respawn travel must not depend on like activity: otherwise an idle fish
        // can crawl a fraction of a pixel per frame and appear frozen at center.
        const respawnSpeed = Math.max(120, fish.baseSpeedPxPerSecond + fish.speedPxPerSecond);
        const travel = Math.min(distance, respawnSpeed * boundedDelta / 1000);
        fish.x += fish.directionX * travel;
        fish.y += fish.directionY * travel;
        if (distance <= travel + 0.5) {
          fish.status = "swimming";
          fish.wanderTimeRemaining = 0;
        }
      }
      continue;
    }
    if (fish.status === "spawning") fish.status = "swimming";
    if (fish.status === "attacking" && state.nowMs >= fish.attackAnimationUntilMs) fish.status = "swimming";
    updateFishMovement(fish, state.world, boundedDelta / 1000, random, allFish, config);
  }

  // Each fish chooses its nearest smaller living target. Cooldowns prevent repeat bites each frame.
  for (const attacker of allFish) {
    if (attacker.status === "dead" || attacker.status === "respawning" || state.nowMs < attacker.attackCooldownUntilMs) continue;
    let target: AquaLifeFish | null = null;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (const candidate of allFish) {
      if (candidate.id === attacker.id || candidate.status === "dead" || candidate.status === "respawning" || candidate.status === "spawning") continue;
      if (candidate.size >= attacker.size) continue;
      const distance = Math.hypot(attacker.x - candidate.x, attacker.y - candidate.y);
      const range = config.attackRangePerSize * (attacker.size + candidate.size);
      if (distance <= range && distance < targetDistance) {
        target = candidate;
        targetDistance = distance;
      }
    }
    if (target) resolveFishBite(attacker, target, state.nowMs, config);
  }

  // Jellyfish use the same central simulation tick, reflect at the aquarium edges,
  // and apply at most one hit per fish during the configured cooldown window.
  for (const jellyfish of Object.values(state.jellyfish)) {
    jellyfish.x += jellyfish.directionX * jellyfish.speedPxPerSecond * boundedDelta / 1000;
    jellyfish.y += jellyfish.directionY * jellyfish.speedPxPerSecond * boundedDelta / 1000;
    if (jellyfish.x < jellyfish.size) {
      jellyfish.x = jellyfish.size;
      jellyfish.directionX = Math.abs(jellyfish.directionX);
    } else if (jellyfish.x > state.world.width - jellyfish.size) {
      jellyfish.x = state.world.width - jellyfish.size;
      jellyfish.directionX = -Math.abs(jellyfish.directionX);
    }
    if (jellyfish.y < jellyfish.size) {
      jellyfish.y = jellyfish.size;
      jellyfish.directionY = Math.abs(jellyfish.directionY);
    } else if (jellyfish.y > state.world.height - jellyfish.size) {
      jellyfish.y = state.world.height - jellyfish.size;
      jellyfish.directionY = -Math.abs(jellyfish.directionY);
    }
    for (const fish of allFish) resolveJellyfishCollision(fish, jellyfish, state.nowMs, config);
  }
  recalculateCounts(state);
}

function recalculateCounts(state: AquaLifeGameState): void {
  state.activeParticipantCount = Object.values(state.participants).filter(participant => participant.isActive).length;
  state.livingFishCount = Object.values(state.fish).filter(fish => fish.status !== "dead").length;
}


/** Builds a renderer-only snapshot; rotation follows the current swimming direction. */
export function createAquaLifeRenderSnapshot(state: AquaLifeGameState): AquaLifeRenderSnapshot {
  return {
    world: { ...state.world },
    fish: Object.values(state.fish).map(fish => ({
      id: fish.id,
      species: fish.species,
      nickname: fish.nickname,
      avatarUrl: fish.avatarUrl,
      x: fish.x,
      y: fish.y,
      rotation: Math.atan2(fish.directionY, fish.directionX),
      size: fish.size,
      hp: fish.hp,
      maxHp: fish.maxHp,
      attackDamage: fish.attackDamage,
      status: fish.status,
      combatFeedback:
        fish.attackAnimationUntilMs > state.nowMs
          ? "attack"
          : fish.lastHurtAtMs !== null && state.nowMs - fish.lastHurtAtMs >= 0 && state.nowMs - fish.lastHurtAtMs < 350
            ? "hurt"
            : null,
      rewardFeedback:
        fish.lastGrowthAtMs !== null && state.nowMs - fish.lastGrowthAtMs >= 0 && state.nowMs - fish.lastGrowthAtMs < 450
          ? "growth"
          : fish.lastHealAtMs !== null && state.nowMs - fish.lastHealAtMs >= 0 && state.nowMs - fish.lastHealAtMs < 450
            ? "heal"
            : fish.lastLikeAtMs !== null && state.nowMs - fish.lastLikeAtMs >= 0 && state.nowMs - fish.lastLikeAtMs < 250
              ? "activity"
              : null
    })),
    jellyfish: Object.values(state.jellyfish).map(jellyfish => ({ ...jellyfish })),
    activeParticipantCount: state.activeParticipantCount,
    livingFishCount: state.livingFishCount,
    nowMs: state.nowMs
  };
}
