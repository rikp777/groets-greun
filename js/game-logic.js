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

function getOpponentScoreText(myTeam, opponentScore, revealNow) {
  var oppDisplay = myTeam === "Groen"
    ? "Zij (Team Geel)"
    : (myTeam === "Geel" ? "Zij (Team Groen)" : "Zij");
  return revealNow
    ? (oppDisplay + ": " + opponentScore + " pt")
    : (oppDisplay + ": verborgen");
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
  getOpponentScoreText: getOpponentScoreText
};
