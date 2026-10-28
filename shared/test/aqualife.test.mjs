import test from "node:test";
import assert from "node:assert/strict";
import {
  BoundedEventDeduplicator,
  BoundedGameEventQueue,
  AQUALIFE_CONFIG,
  addJellyfish,
  activateParticipant,
  createAquaLifeState,
  deactivateParticipant,
  FISH_SPECIES_CATALOG,
  getFishSpeciesDefinition,
  createAquaLifeRenderSnapshot,
  normalizeTikTokEvent,
  processGameEvent,
  resolveFishBite,
  resolveJellyfishCollision,
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
  const snapshotFish = createAquaLifeRenderSnapshot(state).fish.find(item => item.id === fish.id);
  assert.ok(snapshotFish);
  assert.equal(snapshotFish.rotation, Math.atan2(fish.directionY, fish.directionX));
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
      likeCount: 1000
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
  assert.equal(state.fish["load-user-0"].speedTargetPxPerSecond, AQUALIFE_CONFIG.maxSpeedPxPerSecond);
  for (const fish of Object.values(state.fish)) {
    assert.ok(Number.isFinite(fish.x) && Number.isFinite(fish.y));
    if (fish.status !== "respawning") {
      assert.ok(fish.x >= 0 && fish.x <= state.world.width);
      assert.ok(fish.y >= 0 && fish.y <= state.world.height);
    }
    assert.ok(fish.speedPxPerSecond <= AQUALIFE_CONFIG.maxSpeedPxPerSecond);
    assert.ok(fish.likesPerSecondSamples.length <= AQUALIFE_CONFIG.maxLikeSamplesPerFish);
  }
});


test("like activity sample history is capped for repeated event bursts", () => {
  const state = createAquaLifeState();
  for (let i = 0; i < AQUALIFE_CONFIG.maxLikeSamplesPerFish + 10; i++) {
    const event = normalizeTikTokEvent("like", {
      msgId: "sample-cap-" + i,
      user: { userId: "sample-cap-viewer", nickname: "Viewer" },
      likeCount: 1
    }, 1_000);
    assert.ok(event);
    processGameEvent(state, event);
  }
  assert.equal(
    state.fish["sample-cap-viewer"].likesPerSecondSamples.length,
    AQUALIFE_CONFIG.maxLikeSamplesPerFish
  );
});


test("HP rewards respect the 4/5/6 like boundaries", () => {
  for (const [likes, expectedHp, expectedRemainder] of [
    [4, 5, 4],
    [5, 6, 0],
    [6, 6, 1]
  ]) {
    const state = createAquaLifeState();
    const event = normalizeTikTokEvent("like", {
      msgId: "hp-boundary-" + likes,
      user: { userId: "hp-boundary-viewer", nickname: "Viewer" },
      likeCount: likes
    }, 1_000);
    assert.ok(event);
    processGameEvent(state, event);
    assert.equal(state.fish["hp-boundary-viewer"].hp, expectedHp);
    assert.equal(state.participants["hp-boundary-viewer"].likesRemainderForHp, expectedRemainder);
  }
});

test("size grows by the configured amount at cumulative 100-like thresholds", () => {
  const state = createAquaLifeState();
  const sendLikes = (id, count, atMs) => {
    const event = normalizeTikTokEvent("like", {
      msgId: id,
      user: { userId: "growth-viewer", nickname: "Viewer" },
      likeCount: count
    }, atMs);
    assert.ok(event);
    processGameEvent(state, event);
  };

  sendLikes("growth-99", 99, 1_000);
  const fish = state.fish["growth-viewer"];
  assert.equal(fish.size, fish.baseSize);
  assert.equal(state.participants["growth-viewer"].likesTotal, 99);

  sendLikes("growth-100", 1, 1_100);
  assert.ok(Math.abs(fish.size - fish.baseSize * 1.15) < 1e-10);
  assert.equal(fish.lastGrowthAtMs, 1_100);

  sendLikes("growth-101", 1, 1_200);
  assert.ok(Math.abs(fish.size - fish.baseSize * 1.15) < 1e-10);
  assert.equal(state.participants["growth-viewer"].likesTotal, 101);
});

test("size grows linearly at 200 likes and remains after death and respawn", () => {
  const state = createAquaLifeState();
  const event = normalizeTikTokEvent("like", {
    msgId: "growth-200",
    user: { userId: "persistent-growth", nickname: "Viewer" },
    likeCount: 200
  }, 1_000);
  assert.ok(event);
  processGameEvent(state, event);

  const fish = state.fish["persistent-growth"];
  const grownSize = fish.size;
  assert.ok(Math.abs(grownSize - fish.baseSize * 1.30) < 1e-10);

  fish.hp = 0;
  fish.status = "dead";
  fish.respawnAtMs = 5_000;
  stepAquaLife(state, 50, 5_000, () => 0.5);

  assert.equal(fish.status, "respawning");
  assert.equal(fish.hp, 1);
  assert.equal(fish.size, grownSize);
  assert.equal(state.participants["persistent-growth"].likesTotal, 200);
});

test("render snapshots expose short reward feedback without recreating fish views", () => {
  const state = createAquaLifeState();
  const event = normalizeTikTokEvent("like", {
    msgId: "feedback-growth",
    user: { userId: "feedback-viewer", nickname: "Viewer" },
    likeCount: 100
  }, 1_000);
  assert.ok(event);
  processGameEvent(state, event);
  stepAquaLife(state, 50, 1_050, () => 0.5);

  const snapshot = createAquaLifeRenderSnapshot(state);
  const fish = snapshot.fish.find(item => item.id === "fish-1");
  assert.ok(fish);
  assert.equal(fish.rewardFeedback, "growth");
  assert.equal(snapshot.nowMs, state.nowMs);
});


test("fish bites use size-aware range, choose smaller targets and obey cooldown", () => {
  const state = createAquaLifeState();
  const join = (userId, msgId) => normalizeTikTokEvent("member", {
    msgId, user: { userId, nickname: userId }
  }, 1_000);
  const bigJoin = join("big-fish", "big-join");
  const smallJoin = join("small-fish", "small-join");
  assert.ok(bigJoin && smallJoin);
  processGameEvent(state, bigJoin);
  processGameEvent(state, smallJoin);
  const big = state.fish["big-fish"];
  const small = state.fish["small-fish"];
  big.status = "swimming";
  small.status = "swimming";
  big.size = 2;
  big.x = 100;
  big.y = 100;
  small.size = 1;
  small.x = 145;
  small.y = 100;

  const first = resolveFishBite(big, small, 2_000);
  assert.equal(first.hit, true);
  assert.equal(first.killed, false);
  assert.equal(small.hp, 4);
  assert.equal(big.status, "attacking");
  assert.equal(resolveFishBite(big, small, 2_500).hit, false, "cooldown blocks rapid repeat bites");
  assert.equal(small.hp, 4);

  small.x = 300;
  assert.equal(resolveFishBite(big, small, 3_100).hit, false, "out-of-range target is not hit");
  assert.equal(small.hp, 4);
});

test("a lethal bite starts death exactly once and respawn preserves species and size", () => {
  const state = createAquaLifeState();
  const makeJoin = (userId, msgId) => normalizeTikTokEvent("member", {
    msgId, user: { userId, nickname: userId }
  }, 1_000);
  const attackerEvent = makeJoin("elite-attacker", "elite-join");
  const targetEvent = makeJoin("one-hp-target", "target-join");
  assert.ok(attackerEvent && targetEvent);
  processGameEvent(state, attackerEvent);
  processGameEvent(state, targetEvent);
  const attacker = state.fish["elite-attacker"];
  const target = state.fish["one-hp-target"];
  attacker.status = "swimming";
  target.status = "swimming";
  attacker.size = 2;
  attacker.x = 200;
  attacker.y = 200;
  target.size = 1;
  target.x = 220;
  target.y = 200;
  target.hp = 1;
  target.species = "gift-7";
  target.size = 1.37;

  const death = resolveFishBite(attacker, target, 4_000);
  assert.equal(death.killed, true);
  assert.equal(target.status, "dead");
  assert.equal(target.hp, 0);
  assert.equal(target.respawnAtMs, 9_000);
  const repeated = resolveFishBite(attacker, target, 4_100);
  assert.equal(repeated.hit, false);
  assert.equal(target.respawnAtMs, 9_000);

  stepAquaLife(state, 50, 9_000, () => 0.5);
  assert.equal(target.status, "respawning");
  assert.equal(target.hp, 1);
  assert.equal(target.species, "gift-7");
  assert.equal(target.size, 1.37);
});

test("jellyfish damage is one HP and contact damage has a cooldown", () => {
  const state = createAquaLifeState();
  const event = normalizeTikTokEvent("member", {
    msgId: "jelly-target-join", user: { userId: "jelly-target", nickname: "Target" }
  }, 1_000);
  assert.ok(event);
  processGameEvent(state, event);
  const fish = state.fish["jelly-target"];
  fish.status = "swimming";
  fish.x = 100;
  fish.y = 100;
  const jellyfish = {
    id: "jelly-1", x: 100, y: 100,
    directionX: 1, directionY: 0, speedPxPerSecond: 34, size: 8
  };

  const first = resolveJellyfishCollision(fish, jellyfish, 2_000);
  assert.equal(first.hit, true);
  assert.equal(fish.hp, 4);
  assert.equal(resolveJellyfishCollision(fish, jellyfish, 2_500).hit, false);
  assert.equal(fish.hp, 4);
  assert.equal(resolveJellyfishCollision(fish, jellyfish, 2_950).hit, true);
  assert.equal(fish.hp, 3);
});


test("simulation automatically selects the nearest smaller fish and updates HP", () => {
  const state = createAquaLifeState();
  for (const [userId, msgId] of [["hunter", "hunter-join"], ["prey", "prey-join"]]) {
    const event = normalizeTikTokEvent("member", {
      msgId, user: { userId, nickname: userId }
    }, 0);
    assert.ok(event);
    processGameEvent(state, event);
  }
  const hunter = state.fish.hunter;
  const prey = state.fish.prey;
  hunter.size = 2;
  hunter.x = 200;
  hunter.y = 200;
  prey.size = 1;
  prey.x = 220;
  prey.y = 200;

  stepAquaLife(state, 50, 1_000, () => 0.5);

  assert.equal(prey.hp, 4);
  assert.equal(hunter.status, "attacking");
  assert.equal(hunter.attackCooldownUntilMs, 2_000);
  const snapshot = createAquaLifeRenderSnapshot(state);
  assert.equal(snapshot.fish.find(fish => fish.id === hunter.id)?.combatFeedback, "attack");
  assert.equal(snapshot.fish.find(fish => fish.id === prey.id)?.combatFeedback, "hurt");
});


test("jellyfish are normalized, move in the simulation and remain inside the aquarium", () => {
  const state = createAquaLifeState(100, 120);
  assert.equal(addJellyfish(state, {
    id: "jelly-moving",
    x: 98,
    y: 60,
    directionX: 4,
    directionY: 0,
    speedPxPerSecond: 20,
    size: 5
  }), true);
  const jellyfish = state.jellyfish["jelly-moving"];
  assert.equal(jellyfish.directionX, 1);
  assert.equal(jellyfish.directionY, 0);

  stepAquaLife(state, 250, 250, () => 0.5);
  assert.ok(jellyfish.x >= 0 && jellyfish.x <= state.world.width);
  assert.ok(jellyfish.y >= 0 && jellyfish.y <= state.world.height);
  assert.ok(jellyfish.directionX < 0, "jellyfish reflects when it reaches the right edge");
  assert.equal(addJellyfish(state, {
    id: "jelly-moving", x: 10, y: 10,
    directionX: 0, directionY: 0, speedPxPerSecond: 0, size: 0
  }), true, "updating an existing jellyfish does not consume another slot");
  assert.equal(state.jellyfish["jelly-moving"].speedPxPerSecond, AQUALIFE_CONFIG.jellyfishBaseSpeedPxPerSecond);
});


test("the fish catalog has ten distinct gift species with unique visual parameters", () => {
  const giftSpecies = FISH_SPECIES_CATALOG.filter(species => species.id.startsWith("gift-"));
  assert.equal(giftSpecies.length, 10);
  assert.equal(new Set(giftSpecies.map(species => species.bodyColor)).size, 10);
  assert.equal(new Set(giftSpecies.map(species => species.finColor)).size, 10);
  assert.equal(new Set(giftSpecies.map(species => species.pattern)).size >= 5, true);
  assert.equal(getFishSpeciesDefinition("gift-7").displayName, "Рубиновая");
});

test("subscription selects Dory unless a gift species has already been unlocked", () => {
  const state = createAquaLifeState();
  const join = normalizeTikTokEvent("member", {
    msgId: "subscription-species-join",
    user: { userId: "subscription-fish", nickname: "Viewer" }
  }, 0);
  const subscribe = normalizeTikTokEvent("subscribe", {
    msgId: "subscription-species-sub",
    user: { userId: "subscription-fish", nickname: "Viewer" }
  }, 1);
  assert.ok(join && subscribe);
  processGameEvent(state, join);
  const fish = state.fish["subscription-fish"];
  const fishEntityId = fish.id;
  processGameEvent(state, subscribe);
  assert.equal(fish.species, "dory");
  assert.equal(fish.id, fishEntityId);

  state.participants["subscription-fish"].unlockedSpecies.push("gift-7");
  activateParticipant(state, "subscription-fish");
  assert.equal(fish.species, "gift-7");
  assert.equal(fish.id, fishEntityId);
});

test("deactivated viewer fish is AI-controlled and is removed after its death delay", () => {
  const state = createAquaLifeState();
  const join = normalizeTikTokEvent("member", {
    msgId: "ai-lifecycle-join",
    user: { userId: "ai-lifecycle-viewer", nickname: "Viewer" }
  }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["ai-lifecycle-viewer"];
  const entityId = fish.id;

  assert.equal(deactivateParticipant(state, "ai-lifecycle-viewer"), true);
  assert.equal(fish.isAiControlled, true);
  fish.hp = 0;
  fish.status = "dead";
  fish.respawnAtMs = 5_000;
  stepAquaLife(state, 50, 4_999, () => 0.5);
  assert.equal(state.fish["ai-lifecycle-viewer"].id, entityId);
  stepAquaLife(state, 50, 5_000, () => 0.5);
  assert.equal(state.fish["ai-lifecycle-viewer"], undefined);
  assert.ok(state.participants["ai-lifecycle-viewer"], "participant progression remains available");
  assert.equal(activateParticipant(state, "ai-lifecycle-viewer"), true);
  assert.notEqual(state.fish["ai-lifecycle-viewer"].id, entityId);
  assert.equal(state.fish["ai-lifecycle-viewer"].isAiControlled, false);
});


test("idle fish keep cruising without likes and change heading gradually", () => {
  const state = createAquaLifeState(540, 960);
  const join = normalizeTikTokEvent("member", {
    msgId: "idle-swim-join",
    user: { userId: "idle-swimmer", nickname: "Reef fish" }
  }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["idle-swimmer"];
  const startX = fish.x;
  const startY = fish.y;
  let seed = 0x51a7;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 100; i++) stepAquaLife(state, 50, (i + 1) * 50, random);

  assert.ok(Math.hypot(fish.x - startX, fish.y - startY) > 2, "fish should gently cruise even without likes");
  assert.equal(fish.baseSpeedPxPerSecond, AQUALIFE_CONFIG.baseSpeedPxPerSecond, "idle speed should remain separate from like bonus");
  assert.ok(Math.abs(fish.directionX) + Math.abs(fish.directionY) > 0.9);
  assert.ok(fish.x > fish.size * 12 && fish.x < state.world.width - fish.size * 12);
  assert.ok(fish.y > fish.size * 12 && fish.y < state.world.height - fish.size * 12);
});


test("respawning fish continue moving even when they have no recent likes", () => {
  const state = createAquaLifeState(540, 960);
  const join = normalizeTikTokEvent("member", {
    msgId: "idle-respawn-join",
    user: { userId: "idle-respawn", nickname: "Idle swimmer" }
  }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["idle-respawn"];
  fish.status = "dead";
  fish.hp = 0;
  fish.respawnAtMs = 1_000;

  stepAquaLife(state, 50, 1_000, () => 0.5);
  assert.equal(fish.status, "respawning");
  const initialX = fish.x;
  const initialY = fish.y;
  const entryDirectionX = fish.directionX;
  const entryDirectionY = fish.directionY;
  stepAquaLife(state, 50, 1_050, () => 0.5);
  assert.ok((fish.x - initialX) * entryDirectionX > 0, "respawning fish should keep its chosen entry direction");
  assert.ok(Math.abs((fish.y - initialY) - entryDirectionY * 1.4) < 0.01,
    "respawning fish should follow its shallow entry angle instead of steering toward the center");
});
