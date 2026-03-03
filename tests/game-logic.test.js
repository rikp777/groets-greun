"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

var logic = require("../js/game-logic");

var photos = [
  { id: "church", points: 10 },
  { id: "bench", points: 15 },
  { id: "woman", points: 20 }
];

test("getTeamStateKey creates isolated storage keys per team", function () {
  assert.equal(logic.getTeamStateKey("Groen"), "groetsGreunState_Groen");
  assert.equal(logic.getTeamStateKey("Geel"), "groetsGreunState_Geel");
  assert.notEqual(logic.getTeamStateKey("Groen"), logic.getTeamStateKey("Geel"));
});

test("normalizeState keeps only known photo ids and valid value types", function () {
  var raw = {
    church: 1710000000000,
    bench: false,
    woman: true,
    hacker: true,
    weird: "yes"
  };

  assert.deepEqual(logic.normalizeState(raw, photos), {
    church: 1710000000000,
    bench: false,
    woman: true
  });
});

test("reset reload happens only for newer timestamps", function () {
  assert.equal(logic.shouldReloadOnReset(0, 0), false);
  assert.equal(logic.shouldReloadOnReset(100, 100), false);
  assert.equal(logic.shouldReloadOnReset(99, 100), false);
  assert.equal(logic.shouldReloadOnReset(101, 100), true);
});

test("topic parsing and team topic checks ignore unrelated channels", function () {
  var prefix = "groetsgreun/score/panningen/2024/";
  assert.equal(logic.getTopicSuffix(prefix + "Groen", prefix), "Groen");
  assert.equal(logic.getTopicSuffix("other/topic", prefix), "");
  assert.equal(logic.isTeamTopic("Groen"), true);
  assert.equal(logic.isTeamTopic("Geel"), true);
  assert.equal(logic.isTeamTopic("reset"), false);
});

test("classifyMessage routes only exact team messages to teammate/opponent/leiding", function () {
  assert.equal(logic.classifyMessage({
    myTeam: "Groen",
    myClientId: "a1",
    topicSuffix: "Geel",
    data: { clientId: "b2", state: {} }
  }), "opponent");

  assert.equal(logic.classifyMessage({
    myTeam: "Groen",
    myClientId: "a1",
    topicSuffix: "Groen",
    data: { clientId: "b2", state: {} }
  }), "teammate");

  assert.equal(logic.classifyMessage({
    myTeam: "Groen",
    myClientId: "a1",
    topicSuffix: "Groen",
    data: { clientId: "a1", state: {} }
  }), "ignore");

  assert.equal(logic.classifyMessage({
    myTeam: "Leiding",
    myClientId: "lead",
    topicSuffix: "Groen",
    data: { clientId: "x", state: {} }
  }), "leiding");

  assert.equal(logic.classifyMessage({
    myTeam: "Groen",
    myClientId: "a1",
    topicSuffix: "notify",
    data: { clientId: "z", state: {} }
  }), "ignore");
});

test("mergeTeammateState updates changed values including false toggles", function () {
  var current = { church: 111, bench: true };
  var incoming = { church: 111, bench: false, woman: 222 };
  var result = logic.mergeTeammateState(current, incoming);

  assert.equal(result.changed, true);
  assert.deepEqual(result.state, { church: 111, bench: false, woman: 222 });
});

test("opponent score is only revealed inside 10-minute windows", function () {
  var start = 1_000_000;
  var interval = 10 * 60 * 1000;
  var windowMs = 60 * 1000;

  assert.equal(logic.shouldRevealOpponentScore({
    myTeam: "Groen",
    startTime: start,
    now: start + 30 * 1000,
    intervalMs: interval,
    windowMs: windowMs
  }), true);

  assert.equal(logic.shouldRevealOpponentScore({
    myTeam: "Groen",
    startTime: start,
    now: start + 5 * 60 * 1000,
    intervalMs: interval,
    windowMs: windowMs
  }), false);

  assert.equal(logic.shouldRevealOpponentScore({
    myTeam: "Groen",
    startTime: start,
    now: start + 10 * 60 * 1000 + 10 * 1000,
    intervalMs: interval,
    windowMs: windowMs
  }), true);
});

test("opponent reveal countdown reports next/open window timings", function () {
  var start = 1_000_000;
  var interval = 10 * 60 * 1000;
  var windowMs = 60 * 1000;

  var active = logic.getOpponentRevealWindowStatus({
    myTeam: "Groen",
    startTime: start,
    now: start + 20 * 1000,
    intervalMs: interval,
    windowMs: windowMs
  });
  assert.equal(active.revealNow, true);
  assert.equal(active.msUntilReveal, 0);
  assert.equal(active.msLeftInReveal, 40 * 1000);

  var waiting = logic.getOpponentRevealWindowStatus({
    myTeam: "Groen",
    startTime: start,
    now: start + 4 * 60 * 1000,
    intervalMs: interval,
    windowMs: windowMs
  });
  assert.equal(waiting.revealNow, false);
  assert.equal(waiting.msLeftInReveal, 0);
  assert.equal(waiting.msUntilReveal, 6 * 60 * 1000);
});

test("opponent score text follows reveal state", function () {
  assert.equal(logic.getOpponentScoreText("Groen", 75, false), "Zij (Team Geel): verborgen");
  assert.equal(logic.getOpponentScoreText("Geel", 80, false), "Zij (Team Groen): verborgen");
  assert.equal(logic.getOpponentScoreText("Groen", 75, true), "Zij (Team Geel): 75 pt");
});

test("race moment state is deterministic and active in its 2-minute window", function () {
  var start = 1_000_000;
  var challenges = ["A", "B", "C"];
  var interval = 12 * 60 * 1000;
  var windowMs = 2 * 60 * 1000;

  var activeMoment = logic.getRaceMoment({
    startTime: start,
    now: start + 30 * 1000,
    intervalMs: interval,
    windowMs: windowMs,
    challenges: challenges
  });
  assert.equal(activeMoment.active, true);
  assert.equal(activeMoment.round, 0);
  assert.ok(challenges.includes(activeMoment.challenge));

  var inactiveMoment = logic.getRaceMoment({
    startTime: start,
    now: start + 4 * 60 * 1000,
    intervalMs: interval,
    windowMs: windowMs,
    challenges: challenges
  });
  assert.equal(inactiveMoment.active, false);
  assert.equal(inactiveMoment.round, 0);
  assert.ok(inactiveMoment.nextInMs > 0);
});

test("race bonus points use unique claimed rounds", function () {
  assert.equal(logic.getRaceBonusPoints({ "0": 1111, "1": 2222 }, 15), 30);
  assert.equal(logic.getRaceBonusPoints({}, 15), 0);
});

test("streak bonus counts non-overlapping approved-photo streaks in time window", function () {
  var base = 1_000_000;
  var state = {
    a: base + 10_000,
    b: base + 120_000,
    c: base + 300_000, // first streak (within 8 min)
    d: base + 1_200_000,
    e: base + 1_240_000,
    f: base + 1_270_000 // second streak
  };

  var stats = logic.getStreakBonusStats(state, {
    required: 3,
    windowMs: 8 * 60 * 1000,
    bonusPerStreak: 10
  });

  assert.equal(stats.streakCount, 2);
  assert.equal(stats.bonusPoints, 20);
});
