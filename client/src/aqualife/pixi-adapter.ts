import type { AquaLifeGameState, AquaLifeRenderSnapshot } from "@tiktok-arena/shared";

/** Keeps rendering data derived from simulation state without mutating gameplay. */
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
      status: fish.status
    })),
    jellyfish: Object.values(state.jellyfish).map(jellyfish => ({ ...jellyfish })),
    activeParticipantCount: state.activeParticipantCount,
    livingFishCount: state.livingFishCount
  };
}
