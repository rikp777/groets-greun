'use strict';

const TOTAL_MINUTES = 75;
        const STORAGE_KEYS = {
            stateLegacy: 'groetsGreunState',
            start: 'groetsGreunStart',
            team: 'groetsGreunTeam',
            showOpp: 'groetsGreunShowOpp',
            messageHistoryPrefix: 'groetsGreunLeidingMsg_',
            sentHistory: 'groetsGreunLeidingSentHistory'
        };
        const RESET_SESSION_KEY = 'groetsGreunLastResetTime';
        const RESET_MAX_AGE_MS = 2 * 60 * 1000; // Ignore stale retained reset events

        let state = {};
        let startTime = localStorage.getItem(STORAGE_KEYS.start);
        let myTeam = localStorage.getItem(STORAGE_KEYS.team);
        let showOpponentProgress = localStorage.getItem(STORAGE_KEYS.showOpp) === 'true';
        let timerInterval;
        let lastTrollTime = 0;
        const TROLL_COOLDOWN = 75 * 1000;
        const RACE_BONUS_POINTS = 15;
        const RACE_INTERVAL_MS = 12 * 60 * 1000; // new challenge every 12 minutes
        const RACE_WINDOW_MS = 2 * 60 * 1000; // challenge active for 2 minutes
        const RACE_CHALLENGES = [
            "Maak een creatieve teamselfie met iets roods.",
            "Doe een groepsfoto met iedereen springend in de lucht.",
            "Maak een foto met een dier of dierensymbool.",
            "Maak een foto met een straatnaambord dat met 'B' begint.",
            "Maak een foto met iets dat rond is (fietswiel, klok, bord).",
            "Maak een foto met een persoon die jullie een duim omhoog geeft.",
            "Maak een teamfoto waar iedereen op 1 been staat.",
            "Maak een foto met 3 verschillende soorten bladeren in beeld.",
            "Maak een foto met iets dat glimt als een spiegel.",
            "Maak een foto met een huisnummer waarin een 7 zit.",
            "Maak een foto met een bankje en jullie hele team erop.",
            "Maak een foto met iets geel en iets groen samen in beeld.",
            "Maak een foto met een fietsbel of fietslamp in close-up.",
            "Maak een foto met een kunstwerk of muurschildering.",
            "Maak een foto met een winkelraam en jullie spiegeling.",
            "Maak een foto waar iedereen dezelfde pose nadoet.",
            "Maak een foto met een verkeersbord dat een richting aangeeft.",
            "Maak een foto met iets dat begint met de letter S.",
            "Maak een foto met een plant die hoger is dan 2 meter.",
            "Maak een foto met een grappige team-piramide pose.",
            "Maak een foto met 5 verschillende kleuren in 1 shot.",
            "Maak een foto met iets dat oud of roestig lijkt.",
            "Maak een foto met een hond OF een pootafdruk symbool.",
            "Maak een foto waar iedereen wijst naar hetzelfde object.",
            "Maak een foto met een deur in een opvallende kleur.",
            "Maak een foto met een schaduw-spel van jullie team.",
            "Maak een foto met een ronde tafel of rond object.",
            "Maak een foto met een opvallend patroon (strepen, stippen, tegels).",
            "Maak een foto met iets dat op een dier lijkt."
        ];

        // --- Network Sync Setup ---
        const MQTT_BROKER = "wss://broker.hivemq.com:8884/mqtt";
        const TOPIC_PREFIX = "groetsgreun/score/panningen/2024/";
        const TOPIC_APPROVED_PREFIX = TOPIC_PREFIX + 'approved/';
        const TOPIC_APPROVED_RACE_PREFIX = TOPIC_PREFIX + 'approvedRace/';
        const GAME_START_TOPIC = TOPIC_PREFIX + 'gameStart';
        const myClientId = Math.random().toString(36).substring(7);
        let mqttClient = null;
        let opponentState = {};
        let raceClaims = {};
        let opponentRaceClaims = {};
        let opponentScore = 0;
        let leidingState = { 'Groen': {}, 'Geel': {} };
        let leidingRaceClaims = { 'Groen': {}, 'Geel': {} };
        let approvedState = { 'Groen': {}, 'Geel': {} };
        let leidingMessageHistory = [];
        let approvedRaceClaims = { 'Groen': {}, 'Geel': {} };
        let leidingSentHistory = [];
        function getTeamStateKey(team) {
            return `groetsGreunState_${team}`;
        }
        function getTeamRaceClaimsKey(team) {
            return `groetsGreunRaceClaims_${team}`;
        }
        function getTeamApprovedKey(team) {
            return `groetsGreunApproved_${team}`;
        }
        function getTeamApprovedRaceKey(team) {
            return `groetsGreunApprovedRace_${team}`;
        }
        function getMessageHistoryKey(team) {
            return `${STORAGE_KEYS.messageHistoryPrefix}${team}`;
        }

        function normalizeState(rawState) {
            const normalized = {};
            if (!rawState || typeof rawState !== 'object') return normalized;

            photos.forEach(photo => {
                if (!Object.prototype.hasOwnProperty.call(rawState, photo.id)) return;
                const value = rawState[photo.id];
                if (value === false || value === true || typeof value === 'number') {
                    normalized[photo.id] = value;
                }
            });
            return normalized;
        }

        function loadStateForTeam(team) {
            if (!team || team === 'Leiding') return {};

            let parsed = {};
            try {
                parsed = JSON.parse(localStorage.getItem(getTeamStateKey(team)) || '{}') || {};
            } catch (e) {
                parsed = {};
            }

            // One-time migration from the old single shared state key.
            if (Object.keys(parsed).length === 0) {
                try {
                    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEYS.stateLegacy) || '{}') || {};
                    parsed = legacy;
                } catch (e) {
                    parsed = {};
                }
            }

            return normalizeState(parsed);
        }

        function saveStateForTeam() {
            if (!myTeam || myTeam === 'Leiding') return;
            localStorage.setItem(getTeamStateKey(myTeam), JSON.stringify(normalizeState(state)));
        }

        function normalizeRaceClaims(rawClaims) {
            const normalized = {};
            if (!rawClaims || typeof rawClaims !== 'object') return normalized;

            for (const key in rawClaims) {
                if (!Object.prototype.hasOwnProperty.call(rawClaims, key)) continue;
                const round = Number(key);
                if (!Number.isInteger(round) || round < 0) continue;
                const value = rawClaims[key];
                if (value === true || typeof value === 'number') {
                    normalized[String(round)] = value;
                }
            }
            return normalized;
        }

        function loadRaceClaimsForTeam(team) {
            if (!team || team === 'Leiding') return {};
            let parsed = {};
            try {
                parsed = JSON.parse(localStorage.getItem(getTeamRaceClaimsKey(team)) || '{}') || {};
            } catch (e) {
                parsed = {};
            }
            return normalizeRaceClaims(parsed);
        }

        function saveRaceClaimsForTeam() {
            if (!myTeam || myTeam === 'Leiding') return;
            localStorage.setItem(getTeamRaceClaimsKey(myTeam), JSON.stringify(normalizeRaceClaims(raceClaims)));
        }

        function loadApprovedForTeam(team) {
            let parsed = {};
            try {
                parsed = JSON.parse(localStorage.getItem(getTeamApprovedKey(team)) || '{}') || {};
            } catch (e) {
                parsed = {};
            }
            return normalizeState(parsed);
        }

        function saveApprovedForTeam(team) {
            localStorage.setItem(getTeamApprovedKey(team), JSON.stringify(normalizeState(approvedState[team] || {})));
        }

        function loadApprovedRaceForTeam(team) {
            let parsed = {};
            try {
                parsed = JSON.parse(localStorage.getItem(getTeamApprovedRaceKey(team)) || '{}') || {};
            } catch (e) {
                parsed = {};
            }
            return normalizeRaceClaims(parsed);
        }

        function saveApprovedRaceForTeam(team) {
            localStorage.setItem(getTeamApprovedRaceKey(team), JSON.stringify(normalizeRaceClaims(approvedRaceClaims[team] || {})));
        }

        function getRacePointsFromClaims(claims) {
            return Object.keys(normalizeRaceClaims(claims)).length * RACE_BONUS_POINTS;
        }

        function getPointsFromState(teamState) {
            let score = 0;
            photos.forEach(p => {
                if (teamState[p.id]) score += p.points;
            });
            return score;
        }

        function loadLeidingSentHistory() {
            let parsed = [];
            try {
                parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.sentHistory) || '[]') || [];
            } catch (e) {
                parsed = [];
            }
            return Array.isArray(parsed) ? parsed : [];
        }

        function saveLeidingSentHistory() {
            localStorage.setItem(STORAGE_KEYS.sentHistory, JSON.stringify(leidingSentHistory.slice(0, 40)));
        }

        function loadMessageHistory(team) {
            if (!team || team === 'Leiding') return [];
            let parsed = [];
            try {
                parsed = JSON.parse(localStorage.getItem(getMessageHistoryKey(team)) || '[]') || [];
            } catch (e) {
                parsed = [];
            }
            return Array.isArray(parsed) ? parsed : [];
        }

        function saveMessageHistory(team, history) {
            if (!team || team === 'Leiding') return;
            localStorage.setItem(getMessageHistoryKey(team), JSON.stringify(history.slice(0, 30)));
        }

        function renderMessageHistory() {
            const list = document.getElementById('leiding-message-list');
            if (!list) return;
            list.innerHTML = '';

            if (!leidingMessageHistory.length) {
                const empty = document.createElement('li');
                empty.innerText = "Nog geen berichten.";
                list.appendChild(empty);
                return;
            }

            leidingMessageHistory.forEach(item => {
                const li = document.createElement('li');
                const when = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                li.textContent = String(item.message || '');
                const meta = document.createElement('span');
                meta.className = 'meta';
                meta.textContent = when;
                li.appendChild(meta);
                list.appendChild(li);
            });
        }

        function renderAssignedPointsList() {
            const list = document.getElementById('assigned-points-list');
            if (!list || !myTeam || myTeam === 'Leiding') return;
            list.innerHTML = '';

            const teamApproved = normalizeState(approvedState[myTeam] || {});
            const raceApproved = normalizeRaceClaims(approvedRaceClaims[myTeam] || {});
            const awarded = photos
                .filter(photo => !!teamApproved[photo.id])
                .map(photo => ({
                    id: photo.id,
                    label: photo.label,
                    points: photo.points,
                    timestamp: typeof teamApproved[photo.id] === 'number' ? teamApproved[photo.id] : 0
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

            if (!awarded.length && !Object.keys(raceApproved).length) {
                const empty = document.createElement('li');
                empty.textContent = "Nog geen punten toegekend.";
                list.appendChild(empty);
                return;
            }

            awarded.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${item.label}</span><strong>+${item.points}</strong>`;
                list.appendChild(li);
            });

            Object.keys(raceApproved)
                .sort((a, b) => Number(b) - Number(a))
                .forEach(roundKey => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span>Race Moment #${Number(roundKey) + 1}</span><strong>+${RACE_BONUS_POINTS}</strong>`;
                    list.appendChild(li);
                });
        }

        function renderLeidingSentHistory() {
            const list = document.getElementById('leiding-sent-list');
            if (!list || myTeam !== 'Leiding') return;
            list.innerHTML = '';

            if (!leidingSentHistory.length) {
                const li = document.createElement('li');
                li.style.opacity = '0.75';
                li.textContent = "Nog geen berichten verstuurd.";
                list.appendChild(li);
                return;
            }

            leidingSentHistory.forEach(item => {
                const li = document.createElement('li');
                li.style.marginBottom = '6px';
                li.style.padding = '6px 8px';
                li.style.background = 'rgba(255,255,255,0.08)';
                li.style.borderRadius = '8px';
                const when = new Date(item.timestamp || Date.now()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
                li.textContent = `[${when}] (${item.target}) ${item.message}`;
                list.appendChild(li);
            });
        }

        function renderRaceApprovalList() {
            const el = document.getElementById('race-approval-list');
            if (!el || myTeam !== 'Leiding') return;

            const rows = [];
            ['Groen', 'Geel'].forEach(team => {
                const claimed = normalizeRaceClaims(leidingRaceClaims[team] || {});
                const approved = normalizeRaceClaims(approvedRaceClaims[team] || {});
                Object.keys(claimed)
                    .sort((a, b) => Number(b) - Number(a))
                    .forEach(roundKey => {
                        const isApproved = !!approved[roundKey];
                        rows.push(
                            `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px; background:rgba(255,255,255,0.08); padding:6px 8px; border-radius:8px;">
                                <span>${team} - Race #${Number(roundKey) + 1}</span>
                                <button class="mini-btn" style="background:${isApproved ? '#66bb6a' : '#ffca28'}; color:${isApproved ? 'white' : 'black'};" onclick="toggleRaceApproval('${team}','${roundKey}', event)">
                                    ${isApproved ? 'Goedgekeurd' : `+${RACE_BONUS_POINTS} toekennen`}
                                </button>
                            </div>`
                        );
                    });
            });

            el.innerHTML = rows.length ? rows.join('') : "<span style='opacity:0.75;'>Nog geen race-claims ontvangen.</span>";
        }

        function pushLeidingMessage(message, timestamp = Date.now()) {
            if (!myTeam || myTeam === 'Leiding') return;
            leidingMessageHistory.unshift({ message: String(message || ''), timestamp: Number(timestamp || Date.now()) });
            leidingMessageHistory = leidingMessageHistory.slice(0, 30);
            saveMessageHistory(myTeam, leidingMessageHistory);
            renderMessageHistory();
        }

        function seededRoundIndex(seed) {
            const x = Math.sin(seed) * 10000;
            return Math.floor((x - Math.floor(x)) * 1000000);
        }

        function getRaceChallengeForRound(round) {
            if (!RACE_CHALLENGES.length) return "";
            const baseSeed = Number(startTime || 0) + (round + 1) * 7919;
            const idx = Math.abs(seededRoundIndex(baseSeed)) % RACE_CHALLENGES.length;
            return RACE_CHALLENGES[idx];
        }

        function getCurrentRaceMoment() {
            if (!startTime) return { active: false, round: -1, msLeft: 0, nextInMs: 0, challenge: "" };
            const elapsed = Date.now() - Number(startTime);
            if (elapsed < 0) return { active: false, round: -1, msLeft: 0, nextInMs: 0, challenge: "" };

            const round = Math.floor(elapsed / RACE_INTERVAL_MS);
            const phaseMs = elapsed % RACE_INTERVAL_MS;
            const active = phaseMs < RACE_WINDOW_MS;
            const challenge = getRaceChallengeForRound(round);

            return {
                active: active,
                round: round,
                challenge: challenge,
                msLeft: active ? (RACE_WINDOW_MS - phaseMs) : 0,
                nextInMs: active ? 0 : (RACE_INTERVAL_MS - phaseMs)
            };
        }

        function formatClock(ms) {
            const totalSec = Math.max(0, Math.floor(ms / 1000));
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return `${m}:${s < 10 ? '0' : ''}${s}`;
        }

        function updateRaceMomentUI() {
            const box = document.getElementById('race-moment');
            const text = document.getElementById('race-moment-text');
            const meta = document.getElementById('race-moment-meta');
            const btn = document.getElementById('race-claim-btn');
            if (!box || !text || !meta || !btn) return;

            if (!startTime) {
                text.innerText = "Wachten op Leiding...";
                meta.innerText = "";
                btn.style.display = 'none';
                return;
            }

            const moment = getCurrentRaceMoment();
            const isLeiding = myTeam === 'Leiding';
            const alreadyClaimed = !!raceClaims[String(moment.round)];

            if (moment.active) {
                box.style.opacity = '1';
                text.innerText = moment.challenge;
                meta.innerText = `Nog ${formatClock(moment.msLeft)} | Extra team challenge`;
                btn.style.display = isLeiding ? 'none' : 'block';
                btn.disabled = alreadyClaimed;
                btn.innerText = alreadyClaimed ? 'CHALLENGE AL GEMELD' : 'CHALLENGE KLAAR';
                btn.style.opacity = alreadyClaimed ? '0.65' : '1';
            } else {
                box.style.opacity = '0.85';
                text.innerText = "Volgend Race Moment komt eraan";
                meta.innerText = `Over ${formatClock(moment.nextInMs)} start een 2-min challenge`;
                btn.style.display = 'none';
            }
        }

        function clearGameLocalData() {
            localStorage.removeItem(STORAGE_KEYS.stateLegacy);
            localStorage.removeItem(getTeamStateKey('Groen'));
            localStorage.removeItem(getTeamStateKey('Geel'));
            localStorage.removeItem(getTeamRaceClaimsKey('Groen'));
            localStorage.removeItem(getTeamRaceClaimsKey('Geel'));
            localStorage.removeItem(getTeamApprovedKey('Groen'));
            localStorage.removeItem(getTeamApprovedKey('Geel'));
            localStorage.removeItem(getTeamApprovedRaceKey('Groen'));
            localStorage.removeItem(getTeamApprovedRaceKey('Geel'));
            localStorage.removeItem(getMessageHistoryKey('Groen'));
            localStorage.removeItem(getMessageHistoryKey('Geel'));
            localStorage.removeItem(STORAGE_KEYS.sentHistory);
            localStorage.removeItem(STORAGE_KEYS.start);
            localStorage.removeItem(STORAGE_KEYS.team);
            localStorage.removeItem(STORAGE_KEYS.showOpp);
        }

        function applyRoleUi() {
            const isLeiding = myTeam === 'Leiding';

            // Hide all reset buttons for teams; only leiding can full-reset.
            document.querySelectorAll('.reset-btn').forEach(btn => {
                btn.style.display = isLeiding ? 'inline-block' : 'none';
            });

            const leidingControls = document.getElementById('leiding-controls');
            if (leidingControls) {
                leidingControls.style.display = isLeiding ? 'block' : 'none';
            }

            const toggleContainer = document.querySelector('.toggle-container');
            if (toggleContainer) {
                toggleContainer.style.display = isLeiding ? 'none' : 'block';
            }

            const historyBox = document.getElementById('leiding-message-history');
            if (historyBox) {
                historyBox.style.display = isLeiding ? 'none' : 'block';
            }

            const assignedBox = document.getElementById('assigned-points-box');
            if (assignedBox) {
                assignedBox.style.display = isLeiding ? 'none' : 'block';
            }
        }

        function getRelativeTime(timestamp) {
            if (!timestamp) return "";
            const diff = Math.floor((Date.now() - timestamp) / 60000);
            if (diff < 1) return "zojuist";
            return `${diff} min. geleden`;
        }

        function initApp() {
            if (myTeam) {
                state = myTeam === 'Leiding' ? {} : loadStateForTeam(myTeam);
                raceClaims = myTeam === 'Leiding' ? {} : loadRaceClaimsForTeam(myTeam);
                approvedState['Groen'] = loadApprovedForTeam('Groen');
                approvedState['Geel'] = loadApprovedForTeam('Geel');
                approvedRaceClaims['Groen'] = loadApprovedRaceForTeam('Groen');
                approvedRaceClaims['Geel'] = loadApprovedRaceForTeam('Geel');
                leidingMessageHistory = loadMessageHistory(myTeam);
                leidingSentHistory = loadLeidingSentHistory();
                if (myTeam === 'Groen' || myTeam === 'Geel') {
                    const myOppTeam = myTeam === 'Groen' ? 'Geel' : 'Groen';
                    opponentScore = getPointsFromState(approvedState[myOppTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myOppTeam] || {});
                }
                document.getElementById('intro-screen').style.display = 'none';
                document.getElementById('game-screen').style.display = 'block';
                
                // Initialize toggle state
                const toggle = document.getElementById('opp-toggle');
                if (toggle) toggle.checked = showOpponentProgress;

                startTimerInterval();
                initMQTT();
                updateScore();
                renderGrid();
                updateRaceMomentUI();
                renderMessageHistory();
                renderAssignedPointsList();
                renderLeidingSentHistory();
                renderRaceApprovalList();

                // Refresh relative times every 30 seconds
                setInterval(renderGrid, 30000);
                updateTrollButton();
                
                // Hide reset button for regular teams
                applyRoleUi();

                if (!startTime) {
                    document.getElementById('timer').innerText = "Wachten op Leiding...";
                }
            }

            // Pinch Zoom Listeners
            let currentScale = 1;
            let initialDist = 0;
            const modalImg = document.getElementById('modal-img');
            
            modalImg.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) {
                    initialDist = Math.hypot(
                        e.touches[0].pageX - e.touches[1].pageX,
                        e.touches[0].pageY - e.touches[1].pageY
                    );
                }
            });

            modalImg.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2 && initialDist > 0) {
                    const dist = Math.hypot(
                        e.touches[0].pageX - e.touches[1].pageX,
                        e.touches[0].pageY - e.touches[1].pageY
                    );
                    const delta = dist / initialDist;
                    currentScale = Math.min(Math.max(1, currentScale * delta), 4);
                    modalImg.style.transform = `scale(${currentScale})`;
                    initialDist = dist;
                }
            });

            modalImg.addEventListener('touchend', () => { initialDist = 0; });
        }

        function initMQTT() {
            if (!myTeam || mqttClient) return;
            
            console.log("Connecting to MQTT sync...");
            mqttClient = mqtt.connect(MQTT_BROKER, {
                clientId: 'gg_' + myClientId,
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000,
            });
            
            mqttClient.on('connect', () => {
                console.log("Connected to sync server");
                document.getElementById('sync-indicator').classList.add('connected');
                // Subscribe to both teams' topics
                mqttClient.subscribe(TOPIC_PREFIX + '#', (err) => {
                    if (!err) {
                        console.log("Subscribed to sync topics");
                        publishState();
                        if (myTeam === 'Leiding' && startTime) {
                            publishGameStartWhenConnected(Number(startTime), 0, false);
                            publishApprovedState('Groen');
                            publishApprovedState('Geel');
                            publishApprovedRaceState('Groen');
                            publishApprovedRaceState('Geel');
                        }
                    }
                });
            });

            mqttClient.on('reconnect', () => {
                console.log("Reconnecting to sync server...");
            });

            mqttClient.on('offline', () => {
                console.log("Sync server offline");
                document.getElementById('sync-indicator').classList.remove('connected');
            });

            mqttClient.on('error', (err) => {
                console.error("Sync error:", err);
                document.getElementById('sync-indicator').classList.remove('connected');
            });

            mqttClient.on('message', (topic, message) => {
                try {
                    if (!message || message.length === 0) return;
                    const data = JSON.parse(message.toString());
                    
                    if (topic.endsWith('/troll')) {
                        if (data.targetTeam === myTeam) {
                            triggerTrollEffect();
                        }
                        return;
                    }
                    
                    if (topic.endsWith('/reset')) {
                        const resetTime = Number(data.timestamp || 0);
                        const seenResetTime = Number(sessionStorage.getItem(RESET_SESSION_KEY) || 0);
                        const resetAge = Date.now() - resetTime;
                        const isFreshReset = resetTime > 0 && resetAge >= 0 && resetAge <= RESET_MAX_AGE_MS;

                        if (resetTime > seenResetTime) {
                            // Always remember the newest reset timestamp to suppress stale retained loops.
                            sessionStorage.setItem(RESET_SESSION_KEY, String(resetTime));
                        }

                        if (isFreshReset && resetTime > seenResetTime) {
                            console.log("Global reset received, reloading...");
                            clearGameLocalData();
                            location.reload();
                        }
                        return;
                    }

                    if (topic.endsWith('/notify')) {
                        if (data.targetTeam === myTeam || data.targetTeam === 'Beide') {
                            pushLeidingMessage(data.message, data.timestamp || Date.now());
                            showNotification(data.message);
                        }
                        return;
                    }

                    if (topic.endsWith('/gameStart')) {
                        const syncedStart = Number(data.timestamp || 0);
                        if (syncedStart > 0 && Number(startTime || 0) !== syncedStart) {
                            startTime = syncedStart;
                            localStorage.setItem(STORAGE_KEYS.start, String(startTime));
                            startTimerInterval();
                            updateScoreDisplay();
                            updateRaceMomentUI();
                        }
                        return;
                    }

                    if (topic.startsWith(TOPIC_APPROVED_PREFIX)) {
                        const team = topic.substring(TOPIC_APPROVED_PREFIX.length);
                        if (team === 'Groen' || team === 'Geel') {
                            approvedState[team] = normalizeState(data.state || {});
                            saveApprovedForTeam(team);
                            if (myTeam === team) {
                                let claimUpdated = false;
                                for (const key in approvedState[team]) {
                                    if (approvedState[team][key] && !state[key]) {
                                        state[key] = typeof approvedState[team][key] === 'number' ? approvedState[team][key] : Date.now();
                                        claimUpdated = true;
                                    }
                                }
                                if (claimUpdated) {
                                    saveStateForTeam();
                                    publishState();
                                }
                            }
                            const myOppTeam = myTeam === 'Groen' ? 'Geel' : 'Groen';
                            if (myTeam !== 'Leiding' && (team === myTeam || team === myOppTeam)) {
                                opponentScore = getPointsFromState(approvedState[myOppTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myOppTeam] || {});
                            }
                            updateScore();
                            renderGrid();
                            renderAssignedPointsList();
                        }
                        return;
                    }

                    if (topic.startsWith(TOPIC_APPROVED_RACE_PREFIX)) {
                        const team = topic.substring(TOPIC_APPROVED_RACE_PREFIX.length);
                        if (team === 'Groen' || team === 'Geel') {
                            approvedRaceClaims[team] = normalizeRaceClaims(data.raceClaims || {});
                            saveApprovedRaceForTeam(team);
                            const myOppTeam = myTeam === 'Groen' ? 'Geel' : 'Groen';
                            if (myTeam !== 'Leiding') {
                                opponentScore = getPointsFromState(approvedState[myOppTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myOppTeam] || {});
                            } else {
                                renderRaceApprovalList();
                            }
                            updateScore();
                            renderAssignedPointsList();
                        }
                        return;
                    }

                    const topicSuffix = topic.startsWith(TOPIC_PREFIX) ? topic.substring(TOPIC_PREFIX.length) : "";
                    const isTeamTopic = topicSuffix === 'Groen' || topicSuffix === 'Geel';
                    if (!isTeamTopic || !data || typeof data.state !== 'object') return;

                    if (myTeam === 'Leiding') {
                        leidingState[topicSuffix] = normalizeState(data.state);
                        leidingRaceClaims[topicSuffix] = normalizeRaceClaims(data.raceClaims || {});
                        updateScoreDisplay();
                        renderRaceApprovalList();
                        renderGrid();
                    } else if (topicSuffix !== myTeam) {
                        // Received Opponent's State
                        opponentState = normalizeState(data.state);
                        opponentRaceClaims = normalizeRaceClaims(data.raceClaims || {});
                        const myOppTeam = myTeam === 'Groen' ? 'Geel' : 'Groen';
                        opponentScore = getPointsFromState(approvedState[myOppTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myOppTeam] || {});
                        updateScoreDisplay();
                        renderGrid(); 
                    } else if (data.clientId !== myClientId) {
                        // Received State from Teammate
                        const incomingState = normalizeState(data.state);
                        const incomingRaceClaims = normalizeRaceClaims(data.raceClaims || {});
                        let changed = false;
                        for (const key in incomingState) {
                            if (state[key] !== incomingState[key]) {
                                state[key] = incomingState[key];
                                changed = true;
                            }
                        }
                        for (const key in incomingRaceClaims) {
                            if (raceClaims[key] !== incomingRaceClaims[key]) {
                                raceClaims[key] = incomingRaceClaims[key];
                                changed = true;
                            }
                        }
                        if (changed) {
                            saveStateForTeam();
                            saveRaceClaimsForTeam();
                            renderGrid();
                            updateScore();
                            updateRaceMomentUI();
                        }
                    }
                } catch (e) {
                    console.error("Sync error", e);
                }
            });
        }

        function publishState() {
            if (mqttClient && mqttClient.connected && myTeam && myTeam !== 'Leiding') {
                const payload = JSON.stringify({
                    team: myTeam,
                    clientId: myClientId,
                    timestamp: Date.now(),
                    state: normalizeState(state),
                    raceClaims: normalizeRaceClaims(raceClaims)
                });
                mqttClient.publish(TOPIC_PREFIX + myTeam, payload, { retain: true });
            }
        }

        function publishApprovedState(team) {
            if (!mqttClient || !mqttClient.connected || myTeam !== 'Leiding') return;
            const payload = JSON.stringify({
                team: team,
                state: normalizeState(approvedState[team] || {}),
                timestamp: Date.now(),
                by: 'Leiding'
            });
            mqttClient.publish(TOPIC_APPROVED_PREFIX + team, payload, { retain: true, qos: 1 });
        }

        function publishApprovedRaceState(team) {
            if (!mqttClient || !mqttClient.connected || myTeam !== 'Leiding') return;
            const payload = JSON.stringify({
                team: team,
                raceClaims: normalizeRaceClaims(approvedRaceClaims[team] || {}),
                timestamp: Date.now(),
                by: 'Leiding'
            });
            mqttClient.publish(TOPIC_APPROVED_RACE_PREFIX + team, payload, { retain: true, qos: 1 });
        }

        function toggleApproval(team, photoId, event) {
            if (event) event.stopPropagation();
            if (myTeam !== 'Leiding') return;
            if (!approvedState[team]) approvedState[team] = {};

            if (approvedState[team][photoId]) {
                approvedState[team][photoId] = false;
            } else {
                approvedState[team][photoId] = Date.now();
            }

            saveApprovedForTeam(team);
            publishApprovedState(team);
            updateScoreDisplay();
            renderGrid();
        }

        function toggleRaceApproval(team, roundKey, event) {
            if (event) event.stopPropagation();
            if (myTeam !== 'Leiding') return;
            if (!approvedRaceClaims[team]) approvedRaceClaims[team] = {};
            const rk = String(roundKey);

            if (approvedRaceClaims[team][rk]) {
                approvedRaceClaims[team][rk] = false;
            } else {
                approvedRaceClaims[team][rk] = Date.now();
            }

            saveApprovedRaceForTeam(team);
            publishApprovedRaceState(team);
            updateScoreDisplay();
            renderRaceApprovalList();
        }

        function publishGameStartWhenConnected(startTimestamp, attempt = 0, announce = true) {
            const maxAttempts = 30; // ~6 seconds total retry window
            if (!mqttClient || !mqttClient.connected) {
                if (attempt < maxAttempts) {
                    setTimeout(() => publishGameStartWhenConnected(startTimestamp, attempt + 1, announce), 200);
                } else {
                    console.warn("Game start broadcast skipped: MQTT not connected");
                }
                return;
            }

            mqttClient.publish(
                GAME_START_TOPIC,
                JSON.stringify({ action: 'start', timestamp: startTimestamp, by: 'Leiding' }),
                { retain: true, qos: 1 }
            );

            if (announce && myTeam === 'Leiding') {
                showNotification("Spel gestart!");
            }
        }

        function selectTeam(teamName) {
            myTeam = teamName;
            localStorage.setItem(STORAGE_KEYS.team, myTeam);
            state = loadStateForTeam(myTeam);
            raceClaims = loadRaceClaimsForTeam(myTeam);
            opponentState = {};
            opponentRaceClaims = {};
            approvedState['Groen'] = loadApprovedForTeam('Groen');
            approvedState['Geel'] = loadApprovedForTeam('Geel');
            approvedRaceClaims['Groen'] = loadApprovedRaceForTeam('Groen');
            approvedRaceClaims['Geel'] = loadApprovedRaceForTeam('Geel');
            leidingMessageHistory = loadMessageHistory(myTeam);
            opponentScore = 0;
            const myOppTeam = myTeam === 'Groen' ? 'Geel' : 'Groen';
            opponentScore = getPointsFromState(approvedState[myOppTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myOppTeam] || {});
            startTime = localStorage.getItem(STORAGE_KEYS.start);
            
            document.getElementById('intro-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'block';
            
            initMQTT();
            startTimerInterval();
            updateScore();
            renderGrid();
            updateRaceMomentUI();
            renderMessageHistory();
            renderAssignedPointsList();
            renderRaceApprovalList();
            applyRoleUi();

            if (!startTime) {
                document.getElementById('timer').innerText = "Wachten op Leiding...";
            }
        }

        function selectLeiding() {
            myTeam = 'Leiding';
            localStorage.setItem(STORAGE_KEYS.team, 'Leiding');
            state = {};
            raceClaims = {};
            approvedState['Groen'] = loadApprovedForTeam('Groen');
            approvedState['Geel'] = loadApprovedForTeam('Geel');
            approvedRaceClaims['Groen'] = loadApprovedRaceForTeam('Groen');
            approvedRaceClaims['Geel'] = loadApprovedRaceForTeam('Geel');
            leidingMessageHistory = [];
            leidingSentHistory = loadLeidingSentHistory();
            
            // Leiding sets the authoritative game start time for all devices.
            if (!startTime) startTime = Date.now();
            localStorage.setItem(STORAGE_KEYS.start, String(startTime));

            document.getElementById('intro-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'block';
            
            initMQTT();
            startTimerInterval();
            updateScoreDisplay();
            renderGrid();
            updateRaceMomentUI();
            renderMessageHistory();
            renderAssignedPointsList();
            renderLeidingSentHistory();
            renderRaceApprovalList();
            applyRoleUi();
            publishGameStartWhenConnected(Number(startTime));
        }

        function claimRaceBonus() {
            if (!myTeam || myTeam === 'Leiding') return;

            const moment = getCurrentRaceMoment();
            if (!moment.active || moment.round < 0) {
                alert("Er is nu geen actieve Race Moment challenge.");
                return;
            }

            const roundKey = String(moment.round);
            if (raceClaims[roundKey]) {
                alert("Deze bonus is al geclaimd door jullie team.");
                return;
            }

            if (!confirm("Hebben jullie de Race Moment foto echt gemaakt?")) return;

            raceClaims[roundKey] = Date.now();
            saveRaceClaimsForTeam();
            updateScore();
            updateRaceMomentUI();
            publishState();
            triggerConfetti();
        }

        function renderGrid() {
            const grid = document.getElementById('photo-grid');
            grid.innerHTML = '';
            
            photos.forEach(photo => {
                const card = document.createElement('div');
                card.className = 'photo-card';
                
                let badges = `<div class="points-badge">${photo.points} pt</div>`;
                
                if (myTeam === 'Leiding') {
                    card.classList.add('leiding-view');
                    const groenVal = leidingState['Groen'][photo.id];
                    const geelVal = leidingState['Geel'][photo.id];
                    const groenApproved = approvedState['Groen'][photo.id];
                    const geelApproved = approvedState['Geel'][photo.id];
                    
                    if (groenVal) {
                        const time = typeof groenVal === 'number' ? ` (${getRelativeTime(groenVal)})` : "";
                        badges += `<div class="opp-badge" style="background:#2e7d32; color:white; margin-top:35px;">Groen gevonden${time}</div>`;
                    }
                    if (geelVal) {
                        const time = typeof geelVal === 'number' ? ` (${getRelativeTime(geelVal)})` : "";
                        badges += `<div class="opp-badge" style="background:#fbc02d; color:black; margin-top:2px;">Geel gevonden${time}</div>`;
                    }

                    if (groenApproved) {
                        badges += `<div class="opp-badge" style="color:#2e7d32;">Groen: punten toegekend</div>`;
                    }
                    if (geelApproved) {
                        badges += `<div class="opp-badge" style="color:#f9a825;">Geel: punten toegekend</div>`;
                    }

                    badges += `
                        <div class="approval-row">
                            <button class="mini-btn" style="background:${groenApproved ? '#1b5e20' : '#4caf50'}; color:white; flex:1;" onclick="toggleApproval('Groen','${photo.id}', event)">
                                ${groenApproved ? 'Groen OK' : '+ Groen'}
                            </button>
                            <button class="mini-btn" style="background:${geelApproved ? '#f57f17' : '#fbc02d'}; color:black; flex:1;" onclick="toggleApproval('Geel','${photo.id}', event)">
                                ${geelApproved ? 'Geel OK' : '+ Geel'}
                            </button>
                        </div>
                    `;
                    
                    if (groenVal && geelVal) card.classList.add('found');
                } else {
                    const myFoundVal = state[photo.id];
                    const isFound = myFoundVal === true || typeof myFoundVal === 'number';
                    const myApprovedVal = approvedState[myTeam] ? approvedState[myTeam][photo.id] : false;
                    
                    const oppFoundVal = opponentState[photo.id];
                    const isOpponentFound = (oppFoundVal === true || typeof oppFoundVal === 'number') && showOpponentProgress;
                    
                    if (isFound) card.classList.add('found');
                    card.onclick = () => togglePhoto(photo.id);
                    
                    if (isOpponentFound) {
                        const timeStr = typeof oppFoundVal === 'number' ? ` (${getRelativeTime(oppFoundVal)})` : "";
                        badges += `<div class="opp-badge">Tegenstander gevonden${timeStr}</div>`;
                    }

                    if (myApprovedVal) {
                        badges += `<div class="opp-badge" style="color:#2e7d32;">Punten toegekend</div>`;
                    }
                }
                
                card.innerHTML = `
                    ${badges}
                    <img src="pictures/${photo.file}" alt="${photo.label}">
                    <div class="zoom-btn" onclick="openModal('pictures/${photo.file}', event)">🔍</div>
                    <div class="label">${photo.label}</div>
                    <div class="found-stamp">GEVONDEN</div>
                `;
                grid.appendChild(card);
            });
        }

        function toggleOpponentVisibility(visible) {
            showOpponentProgress = visible;
            localStorage.setItem(STORAGE_KEYS.showOpp, visible);
            renderGrid();
        }

        function sendTroll() {
            const now = Date.now();
            if (now - lastTrollTime < TROLL_COOLDOWN) {
                const remaining = Math.ceil((TROLL_COOLDOWN - (now - lastTrollTime)) / 1000);
                alert(`Nog even wachten! (${remaining}s)`);
                return;
            }
            
            if (mqttClient && mqttClient.connected && myTeam && myTeam !== 'Leiding') {
                const target = myTeam === 'Groen' ? 'Geel' : 'Groen';
                mqttClient.publish(TOPIC_PREFIX + 'troll', JSON.stringify({
                    targetTeam: target,
                    from: myTeam
                }));
                lastTrollTime = now;
                updateTrollButton();
            }
        }

        function updateTrollButton() {
            const btn = document.getElementById('troll-btn');
            if (!btn) return;
            
            const now = Date.now();
            if (now - lastTrollTime < TROLL_COOLDOWN) {
                const remaining = Math.ceil((TROLL_COOLDOWN - (now - lastTrollTime)) / 1000);
                btn.innerText = `COOLDOWN (${remaining}s)`;
                btn.disabled = true;
                btn.style.opacity = '0.5';
                setTimeout(updateTrollButton, 1000);
            } else {
                btn.innerText = `TROLL TEGENSTANDER!`;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }

        function triggerTrollEffect() {
            document.body.classList.add('trolled');
            const overlay = document.getElementById('troll-overlay');
            overlay.style.display = 'flex';
            
            setTimeout(() => {
                document.body.classList.remove('trolled');
                overlay.style.display = 'none';
            }, 4000); // Effect lasts 4 seconds
        }

        function sendNotification(target) {
            const msgInput = document.getElementById('notify-msg');
            const message = msgInput.value.trim();
            if (!message) return;

            if (mqttClient && mqttClient.connected) {
                const now = Date.now();
                mqttClient.publish(TOPIC_PREFIX + 'notify', JSON.stringify({
                    targetTeam: target,
                    message: message,
                    timestamp: now
                }));
                if (myTeam === 'Leiding') {
                    leidingSentHistory.unshift({ target: target, message: message, timestamp: now });
                    leidingSentHistory = leidingSentHistory.slice(0, 40);
                    saveLeidingSentHistory();
                    renderLeidingSentHistory();
                }
                msgInput.value = '';
                alert("Bericht verstuurd naar " + target);
            }
        }

        function leidingTroll(target) {
            if (mqttClient && mqttClient.connected) {
                // Leiding troll targets can be individual or 'Beide'
                const targets = target === 'Beide' ? ['Groen', 'Geel'] : [target];
                targets.forEach(t => {
                    mqttClient.publish(TOPIC_PREFIX + 'troll', JSON.stringify({
                        targetTeam: t,
                        from: 'Leiding'
                    }));
                });
                alert("Troll verstuurd naar " + target);
            }
        }

        function showNotification(message) {
            const toast = document.getElementById('notification-toast');
            toast.innerText = "📢 BERICHT VAN LEIDING:\n" + message;
            toast.style.display = 'block';
            
            // Auto hide after 8 seconds
            setTimeout(() => {
                toast.style.display = 'none';
            }, 8000);
        }

        function openModal(src, event) {
            event.stopPropagation();
            const modalImg = document.getElementById('modal-img');
            modalImg.src = src;
            modalImg.style.transform = 'scale(1)';
            document.getElementById('image-modal').style.display = 'flex';
        }

        function closeModal(event) {
            document.getElementById('image-modal').style.display = 'none';
        }

        function confirmLocalReset() {
            if(confirm("Wil je dit spel verlaten en terug naar het beginscherm? Je voortgang op dit toestel wordt gewist!")) {
                clearGameLocalData();
                location.reload();
            }
        }

        function togglePhoto(id) {
            if (!state[id]) {
                if(confirm("Hebben jullie de groepsfoto naar de leiding ge-WhatsAppt?")) {
                    state[id] = Date.now();
                    triggerConfetti();
                } else {
                    return;
                }
            } else {
                state[id] = false;
            }
            
            saveStateForTeam();
            renderGrid();
            updateScore();
            publishState(); // Broadcast the new state to teammates and opponents
        }

        function updateScore() {
            let myScore = 0;
            if (myTeam === 'Groen' || myTeam === 'Geel') {
                myScore = getPointsFromState(approvedState[myTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myTeam] || {});
            }
            updateScoreDisplay(myScore);
        }

        function updateScoreDisplay(myScore = null) {
            if (myTeam === 'Leiding') {
                const groenScore = getPointsFromState(approvedState['Groen'] || {}) + getRacePointsFromClaims(approvedRaceClaims['Groen'] || {});
                const geelScore = getPointsFromState(approvedState['Geel'] || {}) + getRacePointsFromClaims(approvedRaceClaims['Geel'] || {});
                document.getElementById('my-team-score').innerText = `Team Groen: ${groenScore} pt`;
                document.getElementById('opp-team-score').innerText = `Team Geel: ${geelScore} pt`;
                return;
            }

            if (myScore === null) {
                myScore = getPointsFromState(approvedState[myTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myTeam] || {});
            }
            
            const teamDisplay = myTeam ? `Wij (Team ${myTeam})` : "Wij";
            const oppDisplay = myTeam === 'Groen' ? "Zij (Team Geel)" : (myTeam === 'Geel' ? "Zij (Team Groen)" : "Zij");

            document.getElementById('my-team-score').innerText = `${teamDisplay}: ${myScore} pt`;
            document.getElementById('opp-team-score').innerText = `${oppDisplay}: verborgen`;
        }

        function startTimerInterval() {
            clearInterval(timerInterval);
            timerInterval = setInterval(tickTimer, 1000);
            tickTimer();
        }

        function tickTimer() {
            if (!startTime) {
                document.getElementById('timer').innerText = "Wachten op Leiding...";
                updateRaceMomentUI();
                return;
            }
            const now = Date.now();
            const elapsed = now - parseInt(startTime);
            const totalMs = TOTAL_MINUTES * 60 * 1000;
            const remaining = totalMs - elapsed;
            const timerEl = document.getElementById('timer');

            if (remaining <= 0) {
                timerEl.innerText = "00:00";
                timerEl.classList.remove('urgent-timer');
                showWinner();
                return;
            }

            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            timerEl.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
            
            if (m < 10) {
                timerEl.classList.add('urgent-timer');
            } else if (m < 20) {
                timerEl.style.backgroundColor = "#ffc107";
                timerEl.style.color = "#000";
            }

            if (myTeam !== 'Leiding') {
                updateScoreDisplay();
            }
            updateRaceMomentUI();
        }

        function showWinner() {
            let groenScore = 0;
            let geelScore = 0;
            
            // Calculate scores based on current role
            if (myTeam === 'Leiding') {
                groenScore = getPointsFromState(approvedState['Groen'] || {}) + getRacePointsFromClaims(approvedRaceClaims['Groen'] || {});
                geelScore = getPointsFromState(approvedState['Geel'] || {}) + getRacePointsFromClaims(approvedRaceClaims['Geel'] || {});
            } else {
                const myScore = getPointsFromState(approvedState[myTeam] || {}) + getRacePointsFromClaims(approvedRaceClaims[myTeam] || {});
                
                if (myTeam === 'Groen') {
                    groenScore = myScore;
                    geelScore = opponentScore;
                } else {
                    geelScore = myScore;
                    groenScore = opponentScore;
                }
            }

            const winnerOverlay = document.getElementById('winner-overlay');
            const winnerName = document.getElementById('winner-name');
            const finalScores = document.getElementById('final-scores');
            
            if (groenScore > geelScore) {
                winnerName.innerText = "TEAM GROEN WINT!";
                winnerName.style.color = "#4caf50";
            } else if (geelScore > groenScore) {
                winnerName.innerText = "TEAM GEEL WINT!";
                winnerName.style.color = "#fbc02d";
            } else {
                winnerName.innerText = "HET IS GELIJKSPEL!";
                winnerName.style.color = "white";
            }

            finalScores.innerText = `Score: Groen ${groenScore} - ${geelScore} Geel`;
            winnerOverlay.style.display = 'flex';
            
            if (myTeam === 'Leiding') {
                document.getElementById('admin-reset-area').style.display = 'block';
            }
            
            triggerConfetti();
        }

        function triggerConfetti() {
            var duration = 2 * 1000;
            var end = Date.now() + duration;

            (function frame() {
                confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#2e7d32', '#4caf50', '#ffc107'] });
                confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#2e7d32', '#4caf50', '#ffc107'] });
                if (Date.now() < end) requestAnimationFrame(frame);
            }());
        }

        function broadcastResetWhenConnected(resetTimestamp, attempt = 0) {
            const maxAttempts = 30; // ~6 seconds total retry window
            if (!mqttClient || !mqttClient.connected) {
                if (attempt < maxAttempts) {
                    setTimeout(() => broadcastResetWhenConnected(resetTimestamp, attempt + 1), 200);
                } else {
                    console.warn("Reset broadcast skipped: MQTT not connected");
                }
                return;
            }

            const clearPayload = JSON.stringify({ team: 'Groen', state: {}, raceClaims: {}, timestamp: resetTimestamp });
            const geelPayload = JSON.stringify({ team: 'Geel', state: {}, raceClaims: {}, timestamp: resetTimestamp });
            const resetPayload = JSON.stringify({ action: 'reload', timestamp: resetTimestamp });

            // Persist cleared team states for reconnecting clients.
            mqttClient.publish(TOPIC_PREFIX + 'Groen', clearPayload, { retain: true, qos: 1 });
            mqttClient.publish(TOPIC_PREFIX + 'Geel', geelPayload, { retain: true, qos: 1 });
            mqttClient.publish(TOPIC_APPROVED_PREFIX + 'Groen', JSON.stringify({ team: 'Groen', state: {}, timestamp: resetTimestamp }), { retain: true, qos: 1 });
            mqttClient.publish(TOPIC_APPROVED_PREFIX + 'Geel', JSON.stringify({ team: 'Geel', state: {}, timestamp: resetTimestamp }), { retain: true, qos: 1 });
            mqttClient.publish(TOPIC_APPROVED_RACE_PREFIX + 'Groen', JSON.stringify({ team: 'Groen', raceClaims: {}, timestamp: resetTimestamp }), { retain: true, qos: 1 });
            mqttClient.publish(TOPIC_APPROVED_RACE_PREFIX + 'Geel', JSON.stringify({ team: 'Geel', raceClaims: {}, timestamp: resetTimestamp }), { retain: true, qos: 1 });

            // Retained reset makes sure briefly disconnected clients still receive it.
            mqttClient.publish(TOPIC_PREFIX + 'reset', resetPayload, { retain: true, qos: 1 });

            // Clear authoritative game start so a new round can start cleanly.
            mqttClient.publish(GAME_START_TOPIC, '', { retain: true, qos: 1 });

            // Remove retained reset event after delivery window to avoid stale future reloads.
            setTimeout(() => {
                if (mqttClient && mqttClient.connected) {
                    mqttClient.publish(TOPIC_PREFIX + 'reset', '', { retain: true, qos: 1 });
                }
            }, 15000);
        }

        function resetGame() {
            if (myTeam !== 'Leiding') {
                return;
            }
            if(confirm("Weet je zeker dat je het hele spel wilt resetten? Iedereen wordt teruggestuurd naar het beginscherm!")) {
                // Clear local storage
                clearGameLocalData();
                
                if (mqttClient) {
                    const resetTimestamp = Date.now();
                    broadcastResetWhenConnected(resetTimestamp);
                    
                    // Longer delay to ensure message is sent
                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                } else {
                    location.reload();
                }
            }
        }

        // Ensure inline HTML onclick handlers can always resolve these functions.
        Object.assign(window, {
            selectTeam,
            selectLeiding,
            toggleOpponentVisibility,
            sendTroll,
            sendNotification,
            leidingTroll,
            claimRaceBonus,
            toggleApproval,
            toggleRaceApproval,
            resetGame,
            openModal,
            closeModal,
            confirmLocalReset
        });

        initApp();
