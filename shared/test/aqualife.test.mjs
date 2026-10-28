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
  giftBoostFor,
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
  fish.status = "swimming";
  fish.x = 24;
  fish.y = 24;
  fish.directionX = 1;
  fish.directionY = 0;
  fish.targetDirectionX = 1;
  fish.targetDirectionY = 0;
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

test("like activity adds 0.6 px/s per like/s on top of the idle cruise speed with smoothed bounded speed", () => {
  const state = createAquaLifeState();
  const event = normalizeTikTokEvent("like", {
    msgId: "speed-spike",
    user: { userId: "speed-viewer", nickname: "Fast swimmer" },
    likeCount: 25
  }, 5_000);
  assert.ok(event);
  processGameEvent(state, event);
  const fish = state.fish["speed-viewer"];

  // Idle cruise (10 px/s) plus 0.6 px/s per like/s: 5 likes/s -> 13 px/s.
  assert.equal(fish.speedTargetPxPerSecond, AQUALIFE_CONFIG.baseSpeedPxPerSecond + 3);
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


test("fish bites allow equal-size opponents, prefer smaller targets and obey cooldown", () => {
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
  const equalA = { ...big, id: "equal-a", size: 1, hp: 5, status: "swimming", attackCooldownUntilMs: 0, attackDamage: 1, x: 200, y: 200 };
  const equalB = { ...small, id: "equal-b", size: 1, hp: 5, status: "swimming", attackCooldownUntilMs: 0, attackDamage: 1, x: 210, y: 200 };
  assert.equal(resolveFishBite(equalA, equalB, 4_000).hit, true, "equal-size fish must fight on contact");
  assert.equal(equalB.hp, 4, "equal-size fish must take combat damage");
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
  assert.equal(fish.lastDamageTaken, 1);
  assert.equal(fish.damageSeq, 1, "jellyfish contact should trigger the floating damage number");
  assert.equal(resolveJellyfishCollision(fish, jellyfish, 2_500).hit, false);
  assert.equal(fish.hp, 4);
  assert.equal(fish.damageSeq, 1, "cooldown must prevent duplicate damage numbers");
  assert.equal(resolveJellyfishCollision(fish, jellyfish, 2_950).hit, true);
  assert.equal(fish.hp, 3);
  assert.equal(fish.damageSeq, 2);
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


test("departed fish fade during the final part of a 30-second grace period", () => {
  const state = createAquaLifeState(540, 960, 0);
  const join = normalizeTikTokEvent("member", {
    msgId: "departing-viewer-join",
    user: { userId: "departing-viewer", nickname: "Leaving viewer" }
  }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["departing-viewer"];
  assert.ok(deactivateParticipant(state, "departing-viewer"));
  assert.equal(fish.leaveAtMs, 30_000);

  stepAquaLife(state, 50, 28_800, () => 0.5);
  assert.equal(createAquaLifeRenderSnapshot(state).fish[0].alpha, 1);
  stepAquaLife(state, 50, 29_400, () => 0.5);
  assert.ok(Math.abs(createAquaLifeRenderSnapshot(state).fish[0].alpha - 0.5) < 1e-10);
  stepAquaLife(state, 50, 30_000, () => 0.5);
  assert.equal(state.fish["departing-viewer"], undefined);
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



test("equal-size fish fight each other when their paths cross", () => {
  const state = createAquaLifeState();
  const first = joinSwimmer("equal-fish-a", state);
  const second = joinSwimmer("equal-fish-b", state);
  first.status = "swimming";
  second.status = "swimming";
  first.size = second.size = 1;
  first.x = 200; first.y = 200;
  second.x = 220; second.y = 200;
  first.hp = second.hp = 5;

  stepAquaLife(state, 50, 1_000, () => 0.5);

  assert.equal(first.hp, 4, "the first fish should take a bite");
  assert.equal(second.hp, 4, "the second fish should bite back even with equal size and HP");
  assert.equal(first.status, "attacking");
  assert.equal(second.status, "attacking");
  assert.equal(first.damageSeq, 1);
  assert.equal(second.damageSeq, 1);
});

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function joinSwimmer(userId, state) {
  const join = normalizeTikTokEvent("member", { msgId: `${userId}-join`, user: { userId, nickname: userId } }, 0);
  assert.ok(join);
  processGameEvent(state, join);
  return state.fish[userId];
}

/** Runs the simulation with 16 ms frames and an optional steady like rate (likes sent once per second). */
function runSwim(state, fish, seconds, likesPerSecond, random, onFrame) {
  let nowMs = state.nowMs;
  const frames = Math.round(seconds * 1000 / 16);
  for (let i = 0; i < frames; i++) {
    nowMs += 16;
    if (likesPerSecond && i % 62 === 0) {
      const like = normalizeTikTokEvent("like", {
        user: { userId: fish.participantId, nickname: fish.participantId },
        likeCount: likesPerSecond
      }, nowMs);
      processGameEvent(state, like);
    }
    stepAquaLife(state, 16, nowMs, random);
    if (fish.status === "swimming") onFrame?.(fish);
  }
}

test("fish burst and coast: speed pulses with each stroke while the average follows the like-driven speed", () => {
  const state = createAquaLifeState(540, 960, 0);
  const fish = joinSwimmer("burst-viewer", state);
  const random = seededRandom(7);
  runSwim(state, fish, 30, 15, random); // warm up: entry, like smoothing
  let minSpeed = Infinity;
  let maxSpeed = 0;
  let distance = 0;
  let frames = 0;
  let previousX = fish.x;
  let previousY = fish.y;
  runSwim(state, fish, 90, 15, random, f => {
    minSpeed = Math.min(minSpeed, f.currentSpeedPxPerSecond);
    maxSpeed = Math.max(maxSpeed, f.currentSpeedPxPerSecond);
    distance += Math.hypot(f.x - previousX, f.y - previousY);
    previousX = f.x;
    previousY = f.y;
    frames++;
  });
  const meanSpeed = distance / (frames * 0.016);
  const target = AQUALIFE_CONFIG.baseSpeedPxPerSecond + AQUALIFE_CONFIG.likeSpeedPxPerSecondPerLikePerSecond * 15;
  assert.ok(maxSpeed > minSpeed * 3, `speed should pulse (min ${minSpeed.toFixed(2)}, max ${maxSpeed.toFixed(2)})`);
  assert.ok(meanSpeed > target * 0.6 && meanSpeed < target * 1.3,
    `mean speed ${meanSpeed.toFixed(2)} px/s should stay near the like-driven ${target} px/s`);
});

test("fish turn smoothly: heading never snaps and the turn rate stays within the configured limit", () => {
  const state = createAquaLifeState(540, 960, 0);
  const fish = joinSwimmer("smooth-turner", state);
  const random = seededRandom(99);
  let previousHeading = Math.atan2(fish.directionY, fish.directionX);
  let maxTurnRate = 0;
  runSwim(state, fish, 120, 30, random, f => {
    const heading = Math.atan2(f.directionY, f.directionX);
    let delta = heading - previousHeading;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    maxTurnRate = Math.max(maxTurnRate, Math.abs(delta) / 0.016);
    previousHeading = heading;
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.turnVelocity));
  });
  assert.ok(maxTurnRate <= AQUALIFE_CONFIG.maxTurnRateRadiansPerSecond * 1.05,
    `max turn rate ${maxTurnRate.toFixed(2)} rad/s must respect the limit`);
});

test("idle fish occasionally hover in place and then swim on", () => {
  const state = createAquaLifeState(540, 960, 0);
  const fish = joinSwimmer("hover-viewer", state);
  const random = seededRandom(2024);
  let hoverFrames = 0;
  let sawSwimmingAfterHover = false;
  let wasHovering = false;
  let slowestWhileHovering = Infinity;
  runSwim(state, fish, 300, 0, random, f => {
    const hovering = f.hoverRemainingSeconds > 0;
    if (hovering) {
      hoverFrames++;
      slowestWhileHovering = Math.min(slowestWhileHovering, f.currentSpeedPxPerSecond);
    }
    if (wasHovering && !hovering) sawSwimmingAfterHover = true;
    wasHovering = hovering;
  });
  assert.ok(hoverFrames > 0, "an idle fish should hover now and then");
  assert.ok(sawSwimmingAfterHover, "hovering must end so the fish keeps exploring");
  assert.ok(slowestWhileHovering < 0.5, "a hovering fish is practically still");
});

test("render snapshots expose the locomotion state used by the swimming animation", () => {
  const state = createAquaLifeState(540, 960, 0);
  const fish = joinSwimmer("snapshot-swimmer", state);
  const random = seededRandom(5);
  runSwim(state, fish, 10, 20, random);
  fish.strokePulse = 0.8;
  fish.currentSpeedPxPerSecond = 7.5;
  fish.turnVelocity = -0.4;
  fish.hoverRemainingSeconds = 0;
  const model = createAquaLifeRenderSnapshot(state).fish.find(item => item.id === fish.id);
  assert.ok(model);
  assert.equal(model.speed, 7.5);
  assert.equal(model.strokePulse, 0.8);
  assert.equal(model.turnVelocity, -0.4);
  assert.equal(model.hovering, false);
  fish.hoverRemainingSeconds = 1;
  assert.equal(createAquaLifeRenderSnapshot(state).fish.find(item => item.id === fish.id)?.hovering, true);
});


test("idle fish never freeze: they keep moving horizontally and vertically across the tank", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const state = createAquaLifeState(540, 960, 0);
    const fish = joinSwimmer(`idle-roamer-${seed}`, state);
    const random = seededRandom(seed * 7919);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let windowStartX = fish.x, windowStartY = fish.y, windowFrames = 0, slowestWindow = Infinity;
    runSwim(state, fish, 300, 0, random, f => {
      minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x);
      minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y);
      if (++windowFrames === Math.round(10_000 / 16)) {
        slowestWindow = Math.min(slowestWindow, Math.hypot(f.x - windowStartX, f.y - windowStartY));
        windowStartX = f.x; windowStartY = f.y; windowFrames = 0;
      }
    });
    assert.ok(maxX - minX > 120, `seed ${seed}: horizontal travel ${(maxX - minX).toFixed(0)} px`);
    assert.ok(maxY - minY > 120, `seed ${seed}: vertical travel ${(maxY - minY).toFixed(0)} px`);
    assert.ok(slowestWindow > 8, `seed ${seed}: fish nearly froze for 10 s (moved ${slowestWindow.toFixed(1)} px)`);
  }
});


test("every fish bite records its damage once so the renderer can float a -N number", () => {
  const state = createAquaLifeState();
  const attacker = joinSwimmer("damage-attacker", state);
  const target = joinSwimmer("damage-target", state);
  attacker.status = "swimming";
  target.status = "swimming";
  attacker.size = 2;
  attacker.attackDamage = 3;
  attacker.x = 100; attacker.y = 100;
  target.size = 1;
  target.x = 120; target.y = 100;
  target.hp = 10;

  assert.equal(target.damageSeq, 0);
  assert.equal(resolveFishBite(attacker, target, 2_000).hit, true);
  assert.equal(target.damageSeq, 1);
  assert.equal(target.lastDamageTaken, 3);
  assert.equal(resolveFishBite(attacker, target, 2_100).hit, false, "cooldown: no new number");
  assert.equal(target.damageSeq, 1);
  assert.equal(resolveFishBite(attacker, target, 3_100).hit, true);
  assert.equal(target.damageSeq, 2);

  const model = createAquaLifeRenderSnapshot(state).fish.find(item => item.id === target.id);
  assert.equal(model?.damageSeq, 2);
  assert.equal(model?.lastDamage, 3);
});


test("confirmed gifts grant their HP/attack boosts and unknown gifts keep the +1/+1 default", () => {
  const state = createAquaLifeState();
  const gift = (userId, giftName, count, id) => {
    const event = normalizeTikTokEvent("gift", {
      msgId: id, user: { userId, nickname: userId }, repeatCount: count, giftDetails: { giftName }
    }, 1_000);
    assert.ok(event);
    processGameEvent(state, event);
    return state.fish[userId];
  };
  const rose = gift("gift-viewer-a", "Rose", 2, "g-a");
  assert.equal(rose.hp, 5 + 200);
  assert.equal(rose.attackDamage, 1);
  const flame = gift("gift-viewer-b", "Пламенное сердце", 3, "g-b");
  assert.equal(flame.attackDamage, 1 + 15);
  assert.equal(flame.hp, 5);
  const squirrel = gift("gift-viewer-c", "белочка", 1, "g-c");
  assert.equal(squirrel.hp, 5 + 1000);
  const unknown = gift("gift-viewer-d", "Mystery Box", 2, "g-d");
  assert.equal(unknown.hp, 7);
  assert.equal(unknown.attackDamage, 3);
});

test("a dead fish fades out smoothly instead of vanishing instantly", () => {
  const state = createAquaLifeState(540, 960, 0);
  const attacker = joinSwimmer("fade-attacker", state);
  const victim = joinSwimmer("fade-victim", state);
  attacker.status = "swimming"; victim.status = "swimming";
  attacker.size = 2; attacker.x = 100; attacker.y = 100;
  victim.size = 1; victim.x = 120; victim.y = 100; victim.hp = 1;
  assert.equal(resolveFishBite(attacker, victim, 10_000).killed, true);
  state.nowMs = 10_000;
  const alphaAt = ms => { state.nowMs = ms; return createAquaLifeRenderSnapshot(state).fish.find(f => f.id === victim.id).alpha; };
  assert.equal(alphaAt(10_000), 1);
  const half = alphaAt(10_000 + AQUALIFE_CONFIG.deathFadeMs / 2);
  assert.ok(half > 0.4 && half < 0.6, `half-way alpha ${half}`);
  assert.equal(alphaAt(10_000 + AQUALIFE_CONFIG.deathFadeMs), 0);
  assert.equal(alphaAt(12_000), 0);
});


test("following the streamer upgrades an existing gray fish to Dory", () => {
  const state = createAquaLifeState();
  const join = normalizeTikTokEvent("member", {
    msgId: "follow-upgrade-join",
    user: { userId: "follow-upgrade-viewer", nickname: "Viewer" }
  }, 1_000);
  const follow = normalizeTikTokEvent("follow", {
    msgId: "follow-upgrade-event",
    user: { userId: "follow-upgrade-viewer", nickname: "Viewer" }
  }, 2_000);
  assert.ok(join && follow);

  processGameEvent(state, join);
  const fish = state.fish["follow-upgrade-viewer"];
  assert.equal(fish.species, "standard-gray");

  processGameEvent(state, follow);
  assert.equal(state.fish["follow-upgrade-viewer"].id, fish.id);
  assert.equal(state.fish["follow-upgrade-viewer"].species, "dory");
});


test("all six configured gifts grant the documented HP and attack boosts", () => {
  const state = createAquaLifeState();
  const join = normalizeTikTokEvent("member", {
    msgId: "gift-test-join",
    user: { userId: "gift-test-viewer", uniqueId: "gift_test", nickname: "Gift Tester" }
  }, 1_000);
  assert.ok(join);
  processGameEvent(state, join);
  const fish = state.fish["gift-test-viewer"];
  assert.equal(fish.hp, AQUALIFE_CONFIG.initialHp);
  assert.equal(fish.attackDamage, AQUALIFE_CONFIG.baseBiteDamage);

  const gifts = [
    ["Rose 🌹", 100, 0],
    ["Finger Heart", 500, 0],
    ["Panther", 1000, 0],
    ["Flame Heart", 0, 5],
    ["Pomegranate", 0, 25],
    ["Squirrel", 0, 50]
  ];
  let expectedHp = AQUALIFE_CONFIG.initialHp;
  let expectedAttack = AQUALIFE_CONFIG.baseBiteDamage;
  for (const [giftName, hp, attack] of gifts) {
    const boost = giftBoostFor(undefined, giftName);
    assert.ok(boost, `expected a configured boost for ${giftName}`);
    assert.equal(boost.hp, hp);
    assert.equal(boost.attack, attack);
    const event = normalizeTikTokEvent("gift", {
      msgId: `gift-test-${giftName}`,
      user: { userId: "gift-test-viewer", uniqueId: "gift_test", nickname: "Gift Tester" },
      giftName,
      repeatCount: 1
    }, 2_000 + expectedHp + expectedAttack);
    assert.ok(event);
    processGameEvent(state, event);
    expectedHp += hp;
    expectedAttack += attack;
    assert.equal(fish.hp, expectedHp, `${giftName} should change HP`);
    assert.equal(fish.attackDamage, expectedAttack, `${giftName} should change attack`);
  }
});

test("follow status from TikTok join events changes an existing fish between Dory and gray", () => {
  const state = createAquaLifeState();
  const joinedFollowing = normalizeTikTokEvent("member", {
    msgId: "follow-status-yes",
    user: {
      userId: "follow-status-viewer",
      nickname: "Follower",
      followInfo: { followStatus: 1 }
    }
  }, 1_000);
  assert.ok(joinedFollowing);
  assert.equal(joinedFollowing.isFollowing, true);
  processGameEvent(state, joinedFollowing);
  assert.equal(state.fish["follow-status-viewer"].species, "dory");

  const joinedNotFollowing = normalizeTikTokEvent("member", {
    msgId: "follow-status-no",
    user: {
      userId: "follow-status-viewer",
      nickname: "Follower",
      followInfo: { followStatus: 0 }
    }
  }, 2_000);
  assert.ok(joinedNotFollowing);
  assert.equal(joinedNotFollowing.isFollowing, false);
  processGameEvent(state, joinedNotFollowing);
  assert.equal(state.fish["follow-status-viewer"].species, "standard-gray");
});
