import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import { updateFishMovement, type RandomSource } from "./ai.js";
import { respawnFish } from "./combat.js";
import { applyLikeReward, updateLikeActivitySpeed } from "./rewards.js";
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
  const existing = state.fish[participant.userId];
  if (existing) {
    existing.isAiControlled = !participant.isActive;
    existing.nickname = participant.nickname;
    existing.avatarUrl = participant.avatarUrl;
    return existing;
  }
  if (Object.keys(state.fish).length >= config.maxFish) return null;
  const fish: AquaLifeFish = {
    id: `fish-${state.nextEntityNumber++}`,
    participantId: participant.userId,
    nickname: participant.nickname,
    avatarUrl: participant.avatarUrl,
    species: participant.unlockedSpecies.at(-1) ?? (participant.subscribed ? "dory" : "standard-gray"),
    status: "spawning",
    x: state.world.width / 2,
    y: state.world.height / 2,
    directionX: 1,
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
    size: config.baseFishSize,
    hp: config.initialHp,
    maxHp: null,
    baseAttackDamage: config.baseBiteDamage,
    attackDamage: config.baseBiteDamage,
    isAiControlled: !participant.isActive,
    likesPerSecondSamples: [],
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
  if (state.jellyfish[jellyfish.id]) {
    state.jellyfish[jellyfish.id] = jellyfish;
    return true;
  }
  if (Object.keys(state.jellyfish).length >= config.maxJellyfish) return false;
  state.jellyfish[jellyfish.id] = jellyfish;
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
  } else if (event.type === "gift" || event.type === "chat") {
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
      if (respawnFish(fish, state.world, state.nowMs)) fish.status = "respawning";
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
        fish.x += fish.directionX * Math.max(1, fish.speedPxPerSecond) * boundedDelta / 1000;
        fish.y += fish.directionY * Math.max(1, fish.speedPxPerSecond) * boundedDelta / 1000;
      }
      continue;
    }
    if (fish.status === "spawning") fish.status = "swimming";
    updateFishMovement(fish, state.world, boundedDelta / 1000, random, allFish, config);
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
      status: fish.status
    })),
    jellyfish: Object.values(state.jellyfish).map(jellyfish => ({ ...jellyfish })),
    activeParticipantCount: state.activeParticipantCount,
    livingFishCount: state.livingFishCount
  };
}
