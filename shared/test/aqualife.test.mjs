import test from "node:test";
import assert from "node:assert/strict";
import {
  BoundedEventDeduplicator,
  BoundedGameEventQueue,
  AQUALIFE_CONFIG,
  createAquaLifeState,
  normalizeTikTokEvent,
  processGameEvent,
  stepAquaLife
} from "../dist/index.js";

test("stable provider IDs deduplicate events and one participant owns one fish", () => {
  const state = createAquaLifeState();
  const payload = {
    msgId: "like-evt-1",
    user: {
      userId: "user-100",
      uniqueId: "alex_dev",
      nickname: "Alex",
      profilePictureUrl: "https://example.test/avatar.png"
    },
    likeCount: 5
  };
  const event = normalizeTikTokEvent("like", payload, 1_000);
  assert.ok(event);
  assert.equal(event.userId, "user-100");
  assert.equal(event.avatarUrl, "https://example.test/avatar.png");
  assert.equal(event.dedupeKey, "like:like-evt-1");

  processGameEvent(state, event);
  processGameEvent(state, event);

  assert.equal(Object.keys(state.participants).length, 1);
  assert.equal(Object.keys(state.fish).length, 1);
  assert.equal(state.fish["user-100"].hp, 6);
  assert.equal(state.participants["user-100"].likesTotal, 5);
  assert.equal(state.fish["user-100"].maxHp, null);
});

test("likes retain their remainder between separate events", () => {
  const state = createAquaLifeState();
  const first = normalizeTikTokEvent("like", {
    msgId: "like-4",
    user: { userId: "user-200", nickname: "Viewer" },
    likeCount: 4
  }, 1_000);
  const second = normalizeTikTokEvent("like", {
    msgId: "like-1",
    user: { userId: "user-200", nickname: "Viewer" },
    likeCount: 1
  }, 2_000);
  assert.ok(first && second);

  processGameEvent(state, first);
  assert.equal(state.fish["user-200"].hp, 5);
  assert.equal(state.participants["user-200"].likesRemainderForHp, 4);
  processGameEvent(state, second);

  assert.equal(state.fish["user-200"].hp, 6);
  assert.equal(state.participants["user-200"].likesTotal, 5);
  assert.equal(state.participants["user-200"].likesRemainderForHp, 0);
});

test("events without provider IDs are not falsely deduplicated", () => {
  const state = createAquaLifeState();
  const payload = { user: { userId: "user-300", nickname: "Viewer" }, likeCount: 1 };
  const first = normalizeTikTokEvent("like", payload, 1_000);
  const second = normalizeTikTokEvent("like", payload, 1_000);
  assert.ok(first && second);
  assert.equal(first.dedupeKey, null);
  assert.equal(second.dedupeKey, null);

  processGameEvent(state, first);
  processGameEvent(state, second);
  assert.equal(state.participants["user-300"].likesTotal, 2);
  assert.equal(Object.keys(state.fish).length, 1);
});

test("later events refresh nickname and avatar without replacing the fish entity", () => {
  const state = createAquaLifeState();
  const join = normalizeTikTokEvent("member", {
    msgId: "join-1",
    user: { userId: "user-400", nickname: "Old name" }
  }, 1_000);
  const update = normalizeTikTokEvent("chat", {
    msgId: "chat-1",
    user: { userId: "user-400", nickname: "New name", profilePictureUrl: "https://example.test/new.png" },
    comment: "hello"
  }, 2_000);
  assert.ok(join && update);

  processGameEvent(state, join);
  const fishId = state.fish["user-400"].id;
  processGameEvent(state, update);

  assert.equal(state.fish["user-400"].id, fishId);
  assert.equal(state.fish["user-400"].nickname, "New name");
  assert.equal(state.fish["user-400"].avatarUrl, "https://example.test/new.png");
  assert.equal(state.activeParticipantCount, 1);
});

test("LIKE packets without an explicit positive count are rejected", () => {
  assert.equal(normalizeTikTokEvent("like", { user: { userId: "viewer" } }, 1_000), null);
  assert.equal(normalizeTikTokEvent("like", { user: { userId: "viewer" }, likeCount: 0 }, 1_000), null);
  assert.equal(normalizeTikTokEvent("like", { user: { userId: "viewer" }, likeCount: 7 }, 1_000)?.count, 7);
});

test("gift normalization preserves repeat count, gift ID and validates avatar URL", () => {
  const event = normalizeTikTokEvent("gift", {
    msgId: "gift-1",
    user: { userId: "viewer", profilePictureUrl: "javascript:alert(1)" },
    repeatCount: 12,
    giftDetails: { giftId: 5655, giftName: "Rose" }
  }, 1_000);
  assert.ok(event);
  assert.equal(event.type, "gift");
  assert.equal(event.count, 12);
  assert.equal(event.giftId, 5655);
  assert.equal(event.giftName, "Rose");
  assert.equal(event.avatarUrl, "");
});

test("bounded event queue drains in batches and prioritizes important events over likes", () => {
  const queue = new BoundedGameEventQueue(2, 1);
  const like = normalizeTikTokEvent("like", { user: { userId: "viewer" }, likeCount: 1 }, 1_000);
  const chat = normalizeTikTokEvent("chat", { user: { userId: "viewer" }, comment: "hi" }, 1_001);
  const gift = normalizeTikTokEvent("gift", { user: { userId: "viewer" }, giftName: "Rose" }, 1_002);
  assert.ok(like && chat && gift);
  assert.equal(queue.enqueue(like).accepted, true);
  assert.equal(queue.enqueue(chat).accepted, true);
  assert.equal(queue.enqueue(gift).accepted, true);
  assert.equal(queue.length, 2);
  assert.equal(queue.dropped, 1);
  assert.equal(queue.drainBatch().length, 1);
  assert.equal(queue.drainBatch().length, 1);
  assert.equal(queue.length, 0);
});

test("bounded deduplicator evicts old keys and ignores absent IDs", () => {
  const cache = new BoundedEventDeduplicator(2);
  cache.remember("a");
  cache.remember("b");
  assert.equal(cache.has("a"), true);
  cache.remember("c");
  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), true);
  cache.remember(null);
  assert.equal(cache.size, 2);
});


test("queued likes from the same participant are coalesced instead of discarded", () => {
  const queue = new BoundedGameEventQueue(2, 10);
  const first = normalizeTikTokEvent("like", {
    msgId: "like-a",
    user: { userId: "viewer", nickname: "Viewer" },
    likeCount: 4
  }, 1_000);
  const second = normalizeTikTokEvent("like", {
    msgId: "like-b",
    user: { userId: "viewer", nickname: "Viewer" },
    likeCount: 3
  }, 1_010);
  assert.ok(first && second);
  queue.enqueue(first);
  queue.enqueue(second);
  const batch = queue.drainBatch();
  assert.equal(batch.length, 1);
  assert.equal(batch[0].count, 7);
  assert.equal(batch[0].dedupeKey, null);
  assert.equal(queue.dropped, 0);
});


test("fish use smooth wandering and stay inside the logical aquarium bounds", () => {
  const state = createAquaLifeState(540, 960);
  const join = normalizeTikTokEvent("member", {
    msgId: "movement-join",
    user: { userId: "movement-viewer", nickname: "Swimmer" }
  }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["movement-viewer"];
  fish.x = 4;
  fish.y = 4;
  fish.speedPxPerSecond = 120;

  let seed = 123456789;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 120; i++) stepAquaLife(state, 50, (i + 1) * 50, random);

  assert.equal(state.world.width, 540);
  assert.equal(state.world.height, 960);
  assert.ok(fish.x >= fish.size * 12);
  assert.ok(fish.x <= state.world.width - fish.size * 12);
  assert.ok(fish.y >= fish.size * 12);
  assert.ok(fish.y <= state.world.height - fish.size * 12);
  assert.ok(Number.isFinite(fish.directionX));
  assert.ok(Number.isFinite(fish.directionY));
  assert.ok(fish.targetDirectionX !== undefined);
});

test("like activity follows the approved 0.6 px/s formula with smoothed bounded speed", () => {
  const state = createAquaLifeState();
  const event = normalizeTikTokEvent("like", {
    msgId: "speed-spike",
    user: { userId: "speed-viewer", nickname: "Fast swimmer" },
    likeCount: 25
  }, 5_000);
  assert.ok(event);
  processGameEvent(state, event);
  const fish = state.fish["speed-viewer"];

  assert.equal(fish.speedTargetPxPerSecond, 3);
  assert.ok(fish.speedPxPerSecond > 0);
  assert.ok(fish.speedPxPerSecond < fish.speedTargetPxPerSecond);
  for (let i = 0; i < 80; i++) stepAquaLife(state, 50, 5_050 + i * 50, () => 0.5);
  assert.ok(fish.speedPxPerSecond <= AQUALIFE_CONFIG.maxSpeedPxPerSecond);
  assert.ok(fish.speedPxPerSecond >= AQUALIFE_CONFIG.minSpeedPxPerSecond);
  assert.ok(fish.likesPerSecondSamples.length <= AQUALIFE_CONFIG.maxLikeSamplesPerFish);
});

test("movement remains bounded with 500 fish and a burst of likes", () => {
  const state = createAquaLifeState(540, 960);
  for (let i = 0; i < AQUALIFE_CONFIG.maxFish; i++) {
    const event = normalizeTikTokEvent("member", {
      msgId: `load-join-${i}`,
      user: { userId: `load-user-${i}`, nickname: `Viewer ${i}` }
    }, i + 1);
    assert.ok(event);
    processGameEvent(state, event);
  }
  for (let i = 0; i < 100; i++) {
    const event = normalizeTikTokEvent("like", {
      msgId: `load-like-${i}`,
      user: { userId: `load-user-${i}`, nickname: `Viewer ${i}` },
      likeCount: 100
    }, 10_000 + i);
    assert.ok(event);
    processGameEvent(state, event);
  }

  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let frame = 0; frame < 10; frame++) stepAquaLife(state, 50, 11_000 + frame * 50, random);

  assert.equal(Object.keys(state.fish).length, AQUALIFE_CONFIG.maxFish);
  for (const fish of Object.values(state.fish)) {
    assert.ok(Number.isFinite(fish.x) && Number.isFinite(fish.y));
    assert.ok(fish.x >= 0 && fish.x <= state.world.width);
    assert.ok(fish.y >= 0 && fish.y <= state.world.height);
    assert.ok(fish.speedPxPerSecond <= AQUALIFE_CONFIG.maxSpeedPxPerSecond);
    assert.ok(fish.likesPerSecondSamples.length <= AQUALIFE_CONFIG.maxLikeSamplesPerFish);
  }
});
