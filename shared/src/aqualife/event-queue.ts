import type { NormalizedGameEvent } from "./types.js";

export interface QueueEnqueueResult {
  accepted: boolean;
  dropped: number;
}

/**
 * Bounded FIFO with an overload policy that protects important events.
 * Likes are the first events sacrificed under pressure; chat is next.
 */
export class BoundedGameEventQueue {
  private readonly items: NormalizedGameEvent[] = [];
  private droppedCount = 0;

  constructor(
    readonly capacity = 2_000,
    readonly batchSize = 100
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError("batchSize must be a positive integer");
  }

  enqueue(event: NormalizedGameEvent): QueueEnqueueResult {
    // Coalesce adjacent like packets from the same participant without reordering other event types.
    // The server has already deduplicated provider IDs, so summing distinct adjacent packets is safe.
    if (event.type === "like") {
      const last = this.items[this.items.length - 1];
      const existing = last?.type === "like" && last.userId === event.userId ? last : undefined;
      if (existing) {
        existing.count = Math.min(1_000_000, (existing.count ?? 0) + (event.count ?? 0));
        existing.receivedAtMs = Math.max(existing.receivedAtMs, event.receivedAtMs);
        existing.eventId = `batch:like:${event.userId}:${existing.receivedAtMs}`;
        existing.dedupeKey = null;
        if (event.nickname) existing.nickname = event.nickname;
        if (event.avatarUrl) existing.avatarUrl = event.avatarUrl;
        return { accepted: true, dropped: 0 };
      }
    }
    let dropped = 0;
    if (this.items.length >= this.capacity) {
      if (event.type === "like") {
        this.droppedCount += 1;
        return { accepted: false, dropped: 1 };
      }
      let discardIndex = this.items.findIndex(item => item.type === "like");
      if (discardIndex < 0 && event.type === "chat") {
        this.droppedCount += 1;
        return { accepted: false, dropped: 1 };
      }
      if (discardIndex < 0) discardIndex = this.items.findIndex(item => item.type === "chat");
      if (discardIndex < 0) discardIndex = 0;
      this.items.splice(discardIndex, 1);
      this.droppedCount += 1;
      dropped += 1;
    }
    this.items.push(event);
    return { accepted: true, dropped };
  }

  drainBatch(limit = this.batchSize): NormalizedGameEvent[] {
    const count = Math.max(0, Math.min(this.items.length, Math.floor(limit)));
    return this.items.splice(0, count);
  }

  get length(): number {
    return this.items.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }
}

/** Bounded event-ID cache. Events without provider IDs are deliberately not deduplicated. */
export class BoundedEventDeduplicator {
  private readonly keys = new Map<string, true>();

  constructor(readonly capacity = 4_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
  }

  has(key: string | null): boolean {
    return key !== null && this.keys.has(key);
  }

  remember(key: string | null): void {
    if (!key) return;
    this.keys.delete(key);
    this.keys.set(key, true);
    if (this.keys.size > this.capacity) {
      const oldest = this.keys.keys().next().value as string | undefined;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
  }

  get size(): number {
    return this.keys.size;
  }
}
