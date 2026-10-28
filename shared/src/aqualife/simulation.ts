import { AQUALIFE_CONFIG, type AquaLifeConfig } from "./config.js";
import { updateFishMovement, type RandomSource } from "./ai.js";
import { respawnFish } from "./combat.js";
import { applyLikeReward, updateLikeActivitySpeed } from "./rewards.js";
import type { AquaLifeFish, AquaLifeGameState, AquaLifeParticipant, NormalizedGameEvent } from "./types.js";

export function createAquaLifeState(
  width = AQUALIFE_CONFIG.defaultWorldWidth,
  height = AQUALIFE_CONFIG.defaultWorldHeight,
  nowMs = 0
): AquaLifeGameState {
  return {
    world: { width, height },
    participants: {},
    fish: {},
    jellyfish: {},
    activeParticipantCount: 0,
    livingFishCount: 0,
    nextEntityNumber: 1,
    processedEventIds: [],
    nowMs
  };
}

function ensureParticipant(state: AquaLifeGameState, event: NormalizedGameEvent): AquaLifeParticipant {
  let participant = state.participants[event.userId];
  if (!participant) {
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

function ensureFish(state: AquaLifeGameState, participant: AquaLifeParticipant, config: AquaLifeConfig): AquaLifeFish {
  const existing = state.fish[participant.userId];
  if (existing) {
    existing.isAiControlled = !participant.isActive;
    existing.nickname = participant.nickname;
    existing.avatarUrl = participant.avatarUrl;
    return existing;
  }
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
    speedPxPerSecond: 0,
    size: config.baseFishSize,
    hp: config.initialHp,
    attackDamage: config.baseBiteDamage,
    isAiControlled: !participant.isActive,
    likesPerSecondSamples: [],
    respawnAtMs: null,
    buffs: []
  };
  state.fish[participant.userId] = fish;
  return fish;
}

export function processGameEvent(
  state: AquaLifeGameState,
  event: NormalizedGameEvent,
  config: AquaLifeConfig = AQUALIFE_CONFIG
): void {
  if (!event.eventId || state.processedEventIds.includes(event.eventId)) return;
  state.processedEventIds.push(event.eventId);
  if (state.processedEventIds.length > config.maxQueuedEvents) state.processedEventIds.shift();
  if (event.type === "viewer-left") {
    const participant = state.participants[event.userId];
    if (participant?.isActive) {
      participant.isActive = false;
      const fish = state.fish[event.userId];
      if (fish) fish.isAiControlled = true;
    }
    recalculateCounts(state);
    return;
  }
  const participant = ensureParticipant(state, event);
  if (event.type === "viewer-joined") {
    participant.isActive = true;
    ensureFish(state, participant, config).isAiControlled = false;
  } else if (event.type === "like") {
    participant.isActive = true;
    const fish = ensureFish(state, participant, config);
    applyLikeReward(participant, fish, event.count ?? 1, event.receivedAtMs, config);
    fish.isAiControlled = false;
  } else if (event.type === "follow") {
    participant.isFollowing = true;
    participant.isActive = true;
    ensureFish(state, participant, config).isAiControlled = false;
  } else if (event.type === "subscribe") {
    participant.isActive = true;
    participant.subscribed = true;
    const fish = ensureFish(state, participant, config);
    if (participant.unlockedSpecies.length === 0) fish.species = "dory";
    fish.isAiControlled = false;
  } else if (event.type === "gift") {
    participant.isActive = true;
    ensureFish(state, participant, config).isAiControlled = false;
  } else if (event.type === "chat") {
    participant.isActive = true;
    ensureFish(state, participant, config).isAiControlled = false;
  }
  recalculateCounts(state);
}

export function stepAquaLife(
  state: AquaLifeGameState,
  deltaMs: number,
  nowMs = state.nowMs + deltaMs,
  random: RandomSource = Math.random
): void {
  const boundedDelta = Math.max(0, Math.min(deltaMs, 250));
  state.nowMs = nowMs;
  for (const fish of Object.values(state.fish)) {
    updateLikeActivitySpeed(fish, nowMs);
    if (fish.status === "dead") {
      if (respawnFish(fish, state.world, nowMs)) fish.status = "respawning";
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
    updateFishMovement(fish, state.world, boundedDelta / 1000, random);
  }
  recalculateCounts(state);
}

function recalculateCounts(state: AquaLifeGameState): void {
  state.activeParticipantCount = Object.values(state.participants).filter(participant => participant.isActive).length;
  state.livingFishCount = Object.values(state.fish).filter(fish => fish.status !== "dead").length;
}
