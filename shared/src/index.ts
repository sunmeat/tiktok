export interface ArenaPlayer {
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string;
  score: number;
  likes: number;
  comments: number;
  gifts: number;
  isFollowing: boolean;
}
export interface ChatMessage {
  uniqueId: string;
  nickname: string;
  avatarUrl: string;
  comment: string;
  timestamp: number;
}
export interface GiftAlert {
  uniqueId: string;
  nickname: string;
  giftName: string;
  count: number;
  avatarUrl: string;
}
export * from "./aqualife/types.js";
export * from "./aqualife/config.js";
export * from "./aqualife/events.js";
export * from "./aqualife/event-queue.js";
export * from "./aqualife/rewards.js";
export * from "./aqualife/ai.js";
export * from "./aqualife/combat.js";
export * from "./aqualife/simulation.js";

import type { NormalizedGameEvent } from "./aqualife/types.js";

export type ServerMessage =
  | { type: "init"; data: ArenaPlayer[] }
  | { type: "update_leaderboard"; data: ArenaPlayer[] }
  | { type: "chat_message"; data: ChatMessage }
  | { type: "gift_alert"; data: GiftAlert }
  | { type: "connection_status"; data: { connected: boolean; username: string } }
  | { type: "aqualife_event"; data: NormalizedGameEvent };
