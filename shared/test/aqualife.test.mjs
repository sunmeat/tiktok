import test from "node:test";
import assert from "node:assert/strict";
import {
  createAquaLifeState,
  normalizeTikTokEvent,
  processGameEvent
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
