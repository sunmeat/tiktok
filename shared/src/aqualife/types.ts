export type FishSpeciesId = "standard-gray" | "dory" | `gift-${number}`;
export type FishStatus = "spawning" | "swimming" | "attacking" | "hurt" | "dead" | "respawning";
export type BuffKind = "max-hp" | "attack";
export type NormalizedGameEventType = "viewer-joined" | "viewer-left" | "like" | "follow" | "subscribe" | "gift" | "chat";

export interface AquaLifeParticipant {
  userId: string;
  nickname: string;
  avatarUrl: string;
  isActive: boolean;
  isFollowing: boolean;
  likesTotal: number;
  likesRemainderForHp: number;
  unlockedSpecies: FishSpeciesId[];
  subscribed: boolean;
}

export interface AquaLifeBuff {
  id: string;
  kind: BuffKind;
  level: number;
  amount: number;
  expiresAtMs: number | null;
}

export interface AquaLifeFish {
  id: string;
  participantId: string;
  nickname: string;
  avatarUrl: string;
  species: FishSpeciesId;
  status: FishStatus;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  targetDirectionX: number;
  targetDirectionY: number;
  wanderTimeRemaining: number;
  turnRateRadiansPerSecond: number;
  speedTargetPxPerSecond: number;
  lastSpeedUpdateAtMs: number;
  baseSpeedPxPerSecond: number;
  speedPxPerSecond: number;
  baseSize: number;
  size: number;
  hp: number;
  /** null means there is no gameplay maximum HP. */
  maxHp: number | null;
  baseAttackDamage: number;
  attackDamage: number;
  isAiControlled: boolean;
  likesPerSecondSamples: Array<{ atMs: number; count: number }>;
  lastLikeAtMs: number | null;
  lastHealAtMs: number | null;
  lastGrowthAtMs: number | null;
  lastHurtAtMs: number | null;
  lastAttackAtMs: number | null;
  attackCooldownUntilMs: number;
  attackAnimationUntilMs: number;
  lastJellyfishHitAtMs: number | null;
  respawnAtMs: number | null;
  /** Scheduled removal after a viewer leaves; the final 1.2 seconds fade out. */
  leaveAtMs: number | null;
  buffs: AquaLifeBuff[];
}

export interface AquaLifeJellyfish {
  id: string;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speedPxPerSecond: number;
  size: number;
}

export interface AquaLifeWorld {
  width: number;
  height: number;
}

export interface AquaLifeGameState {
  world: AquaLifeWorld;
  participants: Record<string, AquaLifeParticipant>;
  fish: Record<string, AquaLifeFish>;
  jellyfish: Record<string, AquaLifeJellyfish>;
  activeParticipantCount: number;
  livingFishCount: number;
  nextEntityNumber: number;
  processedEventIds: string[];
  nowMs: number;
}

export interface NormalizedGameEvent {
  type: NormalizedGameEventType;
  eventId: string;
  /** Provider event ID namespaced by event type; null when the connector supplied no stable ID. */
  dedupeKey: string | null;
  userId: string;
  nickname: string;
  avatarUrl: string;
  receivedAtMs: number;
  count?: number;
  giftId?: number;
  giftName?: string;
  isFollowing?: boolean;
  comment?: string;
}

export interface FishRenderModel {
  id: string;
  species: FishSpeciesId;
  nickname: string;
  avatarUrl: string;
  x: number;
  y: number;
  rotation: number;
  size: number;
  hp: number;
  maxHp: number | null;
  attackDamage: number;
  status: FishStatus;
  alpha: number;
  rewardFeedback: "activity" | "heal" | "growth" | null;
  combatFeedback: "attack" | "hurt" | null;
}

export interface AquaLifeRenderSnapshot {
  world: AquaLifeWorld;
  fish: FishRenderModel[];
  jellyfish: AquaLifeJellyfish[];
  activeParticipantCount: number;
  livingFishCount: number;
  nowMs: number;
}
