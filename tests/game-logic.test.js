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

test("opponent score text is hidden for teams", function () {
  assert.equal(logic.getOpponentScoreText("Groen"), "Zij (Team Geel): verborgen");
  assert.equal(logic.getOpponentScoreText("Geel"), "Zij (Team Groen): verborgen");
});
