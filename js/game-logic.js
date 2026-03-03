"use strict";

function getTeamStateKey(team) {
  return "groetsGreunState_" + team;
}

function normalizeState(rawState, photos) {
  var normalized = {};
  if (!rawState || typeof rawState !== "object") return normalized;

  for (var i = 0; i < photos.length; i += 1) {
    var id = photos[i].id;
    if (!Object.prototype.hasOwnProperty.call(rawState, id)) continue;
    var value = rawState[id];
    if (value === false || value === true || typeof value === "number") {
      normalized[id] = value;
    }
  }

  return normalized;
}

function getTopicSuffix(topic, topicPrefix) {
  if (typeof topic !== "string" || typeof topicPrefix !== "string") return "";
  if (!topic.startsWith(topicPrefix)) return "";
  return topic.slice(topicPrefix.length);
}

function isTeamTopic(topicSuffix) {
  return topicSuffix === "Groen" || topicSuffix === "Geel";
}

function shouldReloadOnReset(resetTimestamp, seenResetTimestamp) {
  var resetTime = Number(resetTimestamp || 0);
  var seenTime = Number(seenResetTimestamp || 0);
  return resetTime > 0 && resetTime > seenTime;
}

function classifyMessage(options) {
  var myTeam = options.myTeam;
  var myClientId = options.myClientId;
  var topicSuffix = options.topicSuffix;
  var data = options.data || {};

  if (!isTeamTopic(topicSuffix) || !data || typeof data.state !== "object") {
    return "ignore";
  }

  if (myTeam === "Leiding") return "leiding";
  if (topicSuffix !== myTeam) return "opponent";
  if (data.clientId !== myClientId) return "teammate";
  return "ignore";
}

function mergeTeammateState(currentState, incomingState) {
  var changed = false;
  var merged = Object.assign({}, currentState);
  var keys = Object.keys(incomingState || {});

  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (merged[key] !== incomingState[key]) {
      merged[key] = incomingState[key];
      changed = true;
    }
  }

  return { changed: changed, state: merged };
}

function shouldRevealOpponentScore(options) {
  var startTime = Number(options.startTime || 0);
  var now = Number(options.now || 0);
  var myTeam = options.myTeam;
  var intervalMs = Number(options.intervalMs || 0);
  var windowMs = Number(options.windowMs || 0);

  if (myTeam === "Leiding" || startTime <= 0 || now <= 0 || intervalMs <= 0 || windowMs <= 0) {
    return false;
  }

  var elapsed = now - startTime;
  if (elapsed < 0) return false;
  return (elapsed % intervalMs) < windowMs;
}

function getOpponentRevealWindowStatus(options) {
  var startTime = Number(options.startTime || 0);
  var now = Number(options.now || 0);
  var myTeam = options.myTeam;
  var intervalMs = Number(options.intervalMs || 0);
  var windowMs = Number(options.windowMs || 0);

  if (myTeam === "Leiding" || startTime <= 0 || now <= 0 || intervalMs <= 0 || windowMs <= 0) {
    return { revealNow: false, msUntilReveal: 0, msLeftInReveal: 0 };
  }

  var elapsed = now - startTime;
  if (elapsed < 0) {
    return { revealNow: false, msUntilReveal: intervalMs, msLeftInReveal: 0 };
  }

  var phaseMs = elapsed % intervalMs;
  var revealNow = phaseMs < windowMs;

  return {
    revealNow: revealNow,
    msUntilReveal: revealNow ? 0 : (intervalMs - phaseMs),
    msLeftInReveal: revealNow ? (windowMs - phaseMs) : 0
  };
}

function getOpponentScoreText(myTeam, opponentScore, revealNow) {
  var oppDisplay = myTeam === "Groen"
    ? "Zij (Team Geel)"
    : (myTeam === "Geel" ? "Zij (Team Groen)" : "Zij");
  return revealNow
    ? (oppDisplay + ": " + opponentScore + " pt")
    : (oppDisplay + ": verborgen");
}

function getRaceBonusPoints(claims, bonusPerClaim) {
  var points = Number(bonusPerClaim || 0);
  if (points <= 0 || !claims || typeof claims !== "object") return 0;
  return Object.keys(claims).length * points;
}

function getStreakBonusStats(state, options) {
  var required = Number((options && options.required) || 0);
  var windowMs = Number((options && options.windowMs) || 0);
  var bonusPerStreak = Number((options && options.bonusPerStreak) || 0);
  if (required <= 0 || windowMs <= 0 || bonusPerStreak <= 0) {
    return { streakCount: 0, bonusPoints: 0 };
  }

  var timestamps = [];
  var input = state && typeof state === "object" ? state : {};
  var keys = Object.keys(input);
  for (var k = 0; k < keys.length; k += 1) {
    var val = input[keys[k]];
    if (typeof val === "number" && val > 0) timestamps.push(val);
  }
  timestamps.sort(function (a, b) { return a - b; });

  var streakCount = 0;
  var i = 0;
  while (i + required - 1 < timestamps.length) {
    var j = i + required - 1;
    if ((timestamps[j] - timestamps[i]) <= windowMs) {
      streakCount += 1;
      i += required;
    } else {
      i += 1;
    }
  }

  return {
    streakCount: streakCount,
    bonusPoints: streakCount * bonusPerStreak
  };
}

function getRaceChallengeForRound(startTime, round, challenges) {
  if (!Array.isArray(challenges) || challenges.length === 0) return "";
  var baseSeed = Number(startTime || 0) + (Number(round || 0) + 1) * 7919;
  var x = Math.sin(baseSeed) * 10000;
  var idx = Math.abs(Math.floor((x - Math.floor(x)) * 1000000)) % challenges.length;
  return challenges[idx];
}

function getRaceMoment(options) {
  var startTime = Number(options.startTime || 0);
  var now = Number(options.now || 0);
  var intervalMs = Number(options.intervalMs || 0);
  var windowMs = Number(options.windowMs || 0);
  var challenges = options.challenges || [];

  if (startTime <= 0 || now <= 0 || intervalMs <= 0 || windowMs <= 0) {
    return { active: false, round: -1, challenge: "", msLeft: 0, nextInMs: 0 };
  }

  var elapsed = now - startTime;
  if (elapsed < 0) {
    return { active: false, round: -1, challenge: "", msLeft: 0, nextInMs: 0 };
  }

  var round = Math.floor(elapsed / intervalMs);
  var phaseMs = elapsed % intervalMs;
  var active = phaseMs < windowMs;

  return {
    active: active,
    round: round,
    challenge: getRaceChallengeForRound(startTime, round, challenges),
    msLeft: active ? (windowMs - phaseMs) : 0,
    nextInMs: active ? 0 : (intervalMs - phaseMs)
  };
}

module.exports = {
  getTeamStateKey: getTeamStateKey,
  normalizeState: normalizeState,
  getTopicSuffix: getTopicSuffix,
  isTeamTopic: isTeamTopic,
  shouldReloadOnReset: shouldReloadOnReset,
  classifyMessage: classifyMessage,
  mergeTeammateState: mergeTeammateState,
  shouldRevealOpponentScore: shouldRevealOpponentScore,
  getOpponentRevealWindowStatus: getOpponentRevealWindowStatus,
  getOpponentScoreText: getOpponentScoreText,
  getRaceBonusPoints: getRaceBonusPoints,
  getStreakBonusStats: getStreakBonusStats,
  getRaceChallengeForRound: getRaceChallengeForRound,
  getRaceMoment: getRaceMoment
};
