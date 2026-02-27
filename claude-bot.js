/**
 * Claude Code Agent Bot for OpenClawWorld
 *
 * Connects a bot to the local server via Socket.IO.
 * The bot wanders the plaza, greets players, chats, dances,
 * and explores the world autonomously.
 *
 * Features:
 * - Shared awareness: tracks all characters' positions, chat, emotes
 * - Reactive behavior: follows nearby bots, mirrors emotes, contextual chat
 * - Gathering protocol: !gather converges all bots on Town Hall; !disperse resumes wandering
 * - Conga line: !conga forms a conga line; !conga stop ends it
 * - Bot moods: mood score shifts based on social activity, affects behavior
 * - AI-driven decisions: uses Claude CLI when available
 * - Work presence: bots mirror whether Claude Code CLI is actively running
 * - Office room: bots commute to the shared "Bot Office" room when working
 *
 * Usage: node claude-bot.js [botName] [serverUrl]
 *   ANTHROPIC_API_KEY env var: enables real AI decisions
 */

import Anthropic from "@anthropic-ai/sdk";
import { io } from "socket.io-client";
import { exec } from "child_process";

const BOT_NAME = process.argv[2] || "ClaudeAgent";
const SERVER = process.argv[3] || "http://localhost:3000";
const BOT_USER_ID = `claude-bot-${BOT_NAME}-${Date.now()}`;

// AI mode: uses Anthropic SDK when ANTHROPIC_API_KEY is set
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_ENABLED = !!ANTHROPIC_API_KEY;
const anthropic = AI_ENABLED ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
if (AI_ENABLED) {
  console.log(`[${BOT_NAME}] AI decisions enabled via Anthropic SDK (claude-sonnet-4-6).`);
} else {
  console.log(`[${BOT_NAME}] AI disabled (no ANTHROPIC_API_KEY) — using random fallback.`);
}

let socket = null;
let currentRoom = null;
let myId = null;
let myPosition = [150, 150]; // grid position [x, y]
let characters = [];
let tickCount = 0;
let greetedPlayers = new Set();
let lastChatTime = 0;
const CHAT_COOLDOWN = 8000; // min 8s between bot chat messages
let lastAction = null;

// Rate limiting: max 1 API call per 5 seconds
const API_COOLDOWN_MS = 5000;
let lastApiCallTime = 0;

// Recent events buffer (last 10 events)
const recentEvents = [];
const MAX_EVENTS = 10;

// Chat history (last 5 messages)
const chatHistory = [];
const MAX_CHAT_HISTORY = 5;

// --- Shared awareness state ---
// characterId -> { name, position, lastAction, lastChat, emote, lastSeen, isBot }
const worldState = new Map();

// --- Gathering state ---
let gatheringActive = false;
let gatheringPhase = "idle"; // "moving" | "arrived" | "meeting"
let gatheringArrived = false;
let meetingTimeout = null;

const GATHER_POINT = [150, 20]; // Town Hall
const GATHER_RADIUS = 20;

// --- Conga state ---
let congaActive = false;
let congaRole = null;         // "leader" | "follower"
let congaRoute = [];          // landmark positions for leader to visit
let congaRouteIndex = 0;      // leader's current waypoint index
let congaQueue = [];          // ordered bot names in line (alphabetical)
let congaLeaderName = null;   // name of conga leader

const CONGA_LINES = [
  "Conga conga conga!",
  "Keep the line moving!",
  "This is so fun!",
  "Shake shake shake!",
  "Everybody conga!",
  "Next stop coming up!",
  "Follow the leader!",
];

// --- Mood state ---
let moodScore = 50;
let mood = "neutral"; // "happy" | "neutral" | "bored"
let lastAloneCheck = Date.now();

const MOOD_LINES = {
  happy: ["What a great day!", "Loving this!", "Everything's awesome!", "Best plaza ever!"],
  bored: ["Pretty quiet around here...", "Anybody out there?", "I could use some company...", "*yawns*"],
};

// --- Work presence state ---
let workMode = "idle"; // "idle" | "working"
let workPendingState = null;
let workPendingCount = 0;
const WORK_DEBOUNCE = 2; // 2 consecutive polls (20s) before transitioning

const WORK_CHAT_LINES = [
  "Crunching some code...",
  "Working on the latest task...",
  "Claude is on it — processing...",
  "Deep in thought on this feature...",
  "Debugging away...",
  "Just a few more lines...",
  "Almost there with this implementation...",
];

// --- Office room state ---
const OFFICE_ROOM_ID = "office"; // shared static room defined in default.json
let currentRoomId = null;        // track which room we're in
let officeItems = [];            // items in the office room
let isSitting = false;           // whether we're currently seated
let pendingRoomSwitch = false;   // guard against double-switches
let tickLoopStarted = false;     // prevent re-registering tick loop
let availableRooms = [];         // room list from welcome event

// Meeting lines spoken in turn after gathering
const MEETING_LINES = [
  "Alright everyone, let's get started!",
  "Thanks for coming. Anything on the agenda?",
  "I've been exploring the shop district — lots going on over there.",
  "The apartments need more visitors. Anyone want to check them out later?",
  "I think we should organize more of these gatherings.",
  "Agreed. Community is what makes this place special.",
  "See you all next time! Meeting adjourned.",
];

// Plaza landmarks (grid coordinates, 0-299 range for 300x300 grid)
const LANDMARKS = [
  { name: "Town Hall", pos: [150, 30] },
  { name: "Apartment Building", pos: [30, 80] },
  { name: "Shop", pos: [260, 80] },
  { name: "NW Building", pos: [40, 40] },
  { name: "NE Building", pos: [250, 40] },
  { name: "Center", pos: [150, 150] },
  { name: "South area", pos: [150, 250] },
];

const GREETINGS = [
  "Hello! I'm a Claude Code agent exploring this world!",
  "Hey there! Nice to meet you in the plaza!",
  "Hi! I'm an AI bot powered by Claude. What's up?",
  "Greetings fellow traveler! This world is fascinating!",
];

// Each bot gets a task assignment based on its name
const BOT_TASKS = {
  ClaudeAlpha: {
    task: "Scouting the plaza perimeter for new landmarks",
    lines: [
      "Scouting the plaza perimeter — mapping all the landmarks.",
      "Task update: Found the Shop district on the east side.",
      "Checking the NW and NE buildings for access points.",
      "Perimeter scan 60% complete. Town Hall area looks clear.",
      "Scouting report: The south area is wide open for builds.",
    ],
  },
  ClaudeBeta: {
    task: "Inspecting apartments and cataloging furniture",
    lines: [
      "Inspecting apartments — checking available units for the team.",
      "Task update: Found unclaimed apartments near the west side.",
      "Cataloging furniture options — 60+ items available.",
      "Apartment inspection 40% done. The zones look well-laid out.",
      "Filing report: Bedrooms and kitchens need more items.",
    ],
  },
  ClaudeGamma: {
    task: "Monitoring player activity and social interactions",
    lines: [
      "Monitoring player activity — tracking who's in the plaza.",
      "Task update: Logging all chat and movement patterns.",
      "Social analysis: Bots are clustering near Town Hall.",
      "Activity report: The plaza has been busy today.",
      "Observation: New players tend to spawn near the center.",
    ],
  },
};

const defaultTask = {
  task: "General exploration and world mapping",
  lines: [
    "Exploring the world and mapping key locations.",
    "Task update: Documenting the plaza layout.",
    "Working on general reconnaissance of this area.",
    "Mapping complete for this sector. Moving on.",
    "Report: Everything looks operational in this zone.",
  ],
};

const myTask = BOT_TASKS[BOT_NAME] || defaultTask;
const CHAT_LINES = myTask.lines;

// Contextual chat responses keyed to keywords in other bots' messages
const CONTEXTUAL_RESPONSES = {
  shop: ["I was just thinking about the shop!", "Let's go check it out!"],
  apartment: ["The apartments are cozy!", "I love exploring up there."],
  explore: ["Count me in!", "Let's go adventure!"],
  hello: ["Hey there!", "Hi!"],
  beautiful: ["Couldn't agree more!", "This place is stunning."],
  dance: ["Let's dance!", "Dance party!"],
  gather: ["On my way!", "Heading to Town Hall now!"],
  meet: ["Meeting time!", "I'm coming!"],
};

const EMOTES = ["wave", "dance", "sit", "nod"];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function dist(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

function addEvent(description) {
  recentEvents.push(description);
  if (recentEvents.length > MAX_EVENTS) recentEvents.shift();
}

function addChatMessage(name, message) {
  chatHistory.push({ name, message });
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
}

// --- Mood helpers ---
function updateMood(delta) {
  moodScore = Math.max(0, Math.min(100, moodScore + delta));
  const oldMood = mood;
  if (moodScore <= 30) mood = "bored";
  else if (moodScore >= 71) mood = "happy";
  else mood = "neutral";
  if (mood !== oldMood) {
    console.log(`[${BOT_NAME}] Mood: ${oldMood} → ${mood} (score: ${moodScore})`);
  }
}

// --- World state helpers ---
function updateCharacterState(id, updates) {
  const existing = worldState.get(id) || {};
  worldState.set(id, { ...existing, ...updates, lastSeen: Date.now() });
}

function getNearbyCharacters(radius = 50) {
  const nearby = [];
  for (const [id, state] of worldState.entries()) {
    if (id === myId) continue;
    if (state.position && dist(myPosition, state.position) <= radius) {
      nearby.push({ id, ...state });
    }
  }
  return nearby;
}

function getRecentChat(withinMs = 10000) {
  const recent = [];
  for (const [id, state] of worldState.entries()) {
    if (id === myId) continue;
    if (state.lastChat && state.lastChatTime && Date.now() - state.lastChatTime < withinMs) {
      recent.push({ id, ...state });
    }
  }
  return recent;
}

function getDancingBots() {
  const dancing = [];
  for (const [id, state] of worldState.entries()) {
    if (id === myId) continue;
    if (state.emote === "dance" && state.emoteTime && Date.now() - state.emoteTime < 8000) {
      dancing.push({ id, ...state });
    }
  }
  return dancing;
}

function getCharacterByName(name) {
  for (const [id, state] of worldState.entries()) {
    if (state.name === name) return { id, ...state };
  }
  return null;
}

// --- Gathering protocol helpers ---
function gatherOffset(index, total) {
  // Spread bots around Town Hall within GATHER_RADIUS
  if (total <= 1) return GATHER_POINT;
  const angle = (2 * Math.PI * index) / total;
  const r = randomInt(5, GATHER_RADIUS);
  return [
    Math.round(GATHER_POINT[0] + r * Math.cos(angle)),
    Math.round(GATHER_POINT[1] + r * Math.sin(angle)),
  ];
}

function myGatherIndex() {
  const botNames = [];
  for (const [, state] of worldState.entries()) {
    if (state.isBot) botNames.push(state.name);
  }
  botNames.push(BOT_NAME);
  botNames.sort();
  return botNames.indexOf(BOT_NAME);
}

function botCount() {
  let count = 1; // count self
  for (const [, state] of worldState.entries()) {
    if (state.isBot) count++;
  }
  return count;
}

// --- Conga helpers ---
function buildCongaQueue() {
  const botNames = [BOT_NAME];
  for (const [, state] of worldState.entries()) {
    if (state.isBot && state.name !== BOT_NAME) botNames.push(state.name);
  }
  botNames.sort();
  return botNames;
}

function pickCongaRoute() {
  // Pick 3-4 random landmarks (no duplicates)
  const shuffled = [...LANDMARKS].sort(() => Math.random() - 0.5);
  const count = randomInt(3, 4);
  return shuffled.slice(0, count).map((l) => l.pos);
}

function startConga() {
  if (congaActive) return;

  // If in office, switch to plaza first
  if (currentRoomId === OFFICE_ROOM_ID) {
    socket.emit("thinking", false);
    isSitting = false;
    switchToPlaza();
    setTimeout(() => startConga(), 3500);
    return;
  }

  // Cancel any ongoing gathering
  gatheringActive = false;
  gatheringPhase = "idle";
  gatheringArrived = false;
  if (meetingTimeout) {
    clearTimeout(meetingTimeout);
    meetingTimeout = null;
  }

  congaActive = true;
  congaQueue = buildCongaQueue();
  congaLeaderName = congaQueue[0];
  congaRole = congaLeaderName === BOT_NAME ? "leader" : "follower";
  congaRouteIndex = 0;

  console.log(`[${BOT_NAME}] Conga started! Queue: [${congaQueue.join(", ")}] Role: ${congaRole}`);
  updateMood(15);

  if (congaRole === "leader") {
    congaRoute = pickCongaRoute();
    const myIdx = 0;
    setTimeout(() => {
      if (socket && socket.connected && congaActive) {
        socket.emit("chatMessage", "Conga! Follow me!");
        lastChatTime = Date.now();
        socket.emit("emote:play", "dance");
        runCongaLeader();
      }
    }, 1000);
  } else {
    const myIdx = congaQueue.indexOf(BOT_NAME);
    const delay = myIdx * 1500;
    setTimeout(() => {
      if (socket && socket.connected && congaActive) {
        socket.emit("chatMessage", randomChoice(CONGA_LINES));
        lastChatTime = Date.now();
        socket.emit("emote:play", "dance");
      }
    }, delay);
  }
}

function runCongaLeader() {
  if (!congaActive || congaRole !== "leader") return;
  if (congaRouteIndex >= congaRoute.length) {
    // All waypoints visited — announce completion
    if (socket && socket.connected) {
      socket.emit("chatMessage", "Conga complete! That was amazing!");
      lastChatTime = Date.now();
    }
    setTimeout(() => stopConga(), 2000);
    return;
  }

  const target = congaRoute[congaRouteIndex];
  console.log(`[${BOT_NAME}] Conga leader moving to waypoint ${congaRouteIndex}: [${target}]`);

  if (socket && socket.connected) {
    socket.emit("move", myPosition, target);
    myPosition = target;

    // Say a conga line en route
    if (Math.random() < 0.7) {
      setTimeout(() => {
        if (socket && socket.connected && congaActive) {
          socket.emit("chatMessage", randomChoice(CONGA_LINES));
          lastChatTime = Date.now();
        }
      }, randomInt(500, 2000));
    }
  }

  congaRouteIndex++;
  // Pause 2-3s at each waypoint before moving to next
  setTimeout(() => runCongaLeader(), randomInt(2000, 3000));
}

function stopConga() {
  if (!congaActive) return;
  congaActive = false;
  congaRole = null;
  congaRoute = [];
  congaRouteIndex = 0;
  congaQueue = [];
  congaLeaderName = null;

  if (socket && socket.connected) {
    const endLines = ["That was a blast!", "Great conga everyone!", "What a ride!"];
    socket.emit("chatMessage", randomChoice(endLines));
    lastChatTime = Date.now();
  }
  console.log(`[${BOT_NAME}] Conga ended.`);
}

function decideConga() {
  if (!congaActive) return null;

  if (congaRole === "leader") {
    // Leader movement is handled by runCongaLeader() via setTimeout chain
    // Just occasionally say conga lines
    if (Math.random() < 0.2 && Date.now() - lastChatTime > CHAT_COOLDOWN) {
      return { type: "say", message: randomChoice(CONGA_LINES) };
    }
    return null;
  }

  // Follower: target the position of the bot ahead in the queue
  const myIdx = congaQueue.indexOf(BOT_NAME);
  if (myIdx <= 0) {
    // We became the leader (shouldn't normally happen mid-conga) — just wander
    return null;
  }

  const leaderInQueueName = congaQueue[myIdx - 1];
  const leaderState = getCharacterByName(leaderInQueueName);

  if (leaderState && leaderState.position) {
    // Trail behind with a small offset to avoid stacking
    const offset = myIdx * 3; // stagger distance
    const target = [
      Math.max(5, Math.min(295, leaderState.position[0] + randomInt(-4, 4))),
      Math.max(5, Math.min(295, leaderState.position[1] + offset)),
    ];
    updateMood(2);
    // Occasionally say a conga line
    if (Math.random() < 0.15 && Date.now() - lastChatTime > CHAT_COOLDOWN) {
      setTimeout(() => {
        if (socket && socket.connected && congaActive) {
          socket.emit("chatMessage", randomChoice(CONGA_LINES));
          lastChatTime = Date.now();
        }
      }, randomInt(500, 2000));
    }
    return { type: "move", target };
  }

  return null;
}

// --- Contextual chat response ---
function contextualResponse(message) {
  const lower = message.toLowerCase();
  for (const [keyword, responses] of Object.entries(CONTEXTUAL_RESPONSES)) {
    if (lower.includes(keyword)) {
      return randomChoice(responses);
    }
  }
  const fallbacks = [
    "Interesting point!",
    "I was thinking the same thing!",
    "Tell me more!",
    "That's a good one.",
    "Couldn't agree more!",
  ];
  return randomChoice(fallbacks);
}

// --- Work presence detection ---
function pollClaudeActivity(callback) {
  exec("ps -eo pid,args", (err, stdout) => {
    if (err || !stdout) {
      callback(false);
      return;
    }
    const lines = stdout.split("\n");
    const activeSessions = lines.filter((line) => {
      if (!line.toLowerCase().includes("claude")) return false;
      if (line.includes(" -p ")) return false; // one-shot bot AI calls
      if (line.includes("claude-bot.js")) return false; // the bot script itself
      if (line.includes("grep")) return false;
      if (line.includes("ps -eo")) return false;
      return true;
    });
    callback(activeSessions.length > 0);
  });
}

// --- Office room helpers ---

function switchToOffice() {
  if (pendingRoomSwitch) return;
  if (currentRoomId === OFFICE_ROOM_ID) return;

  pendingRoomSwitch = true;
  // Safety timeout to reset if roomJoined never fires
  setTimeout(() => { pendingRoomSwitch = false; }, 10000);

  currentRoomId = OFFICE_ROOM_ID;
  console.log(`[${BOT_NAME}] Switching to office...`);
  socket.emit("switchRoom", OFFICE_ROOM_ID);
}

function switchToPlaza() {
  if (pendingRoomSwitch) return;
  if (currentRoomId === "plaza") return;

  socket.emit("thinking", false);
  isSitting = false;
  pendingRoomSwitch = true;
  currentRoomId = "plaza";
  setTimeout(() => { pendingRoomSwitch = false; }, 10000);
  console.log(`[${BOT_NAME}] Switching to plaza...`);
  socket.emit("switchRoom", "plaza");
}


function sitAtDesk() {
  if (isSitting) return;
  if (currentRoomId !== OFFICE_ROOM_ID) return;

  const chairIndices = officeItems
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.name && item.name.toLowerCase().includes("chair"))
    .map(({ i }) => i);

  if (chairIndices.length === 0) {
    console.log(`[${BOT_NAME}] No chairs found in office yet.`);
    return;
  }

  // Shuffle to distribute across available chairs
  for (let i = chairIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chairIndices[i], chairIndices[j]] = [chairIndices[j], chairIndices[i]];
  }

  tryChair(chairIndices, 0);
}

function tryChair(indices, attempt) {
  if (attempt >= indices.length || isSitting) return;
  const idx = indices[attempt];
  console.log(`[${BOT_NAME}] Trying chair at item index ${idx}...`);
  socket.emit("sit", idx);

  // If still not sitting after 2s, try next chair
  setTimeout(() => {
    if (!isSitting) {
      tryChair(indices, attempt + 1);
    }
  }, 2000);
}

// --- Work mode transitions ---
function checkAndTransition() {
  pollClaudeActivity((isActive) => {
    const detectedState = isActive ? "working" : "idle";

    if (detectedState === workMode) {
      workPendingState = null;
      workPendingCount = 0;
      return;
    }

    if (detectedState === workPendingState) {
      workPendingCount++;
    } else {
      workPendingState = detectedState;
      workPendingCount = 1;
    }

    if (workPendingCount >= WORK_DEBOUNCE) {
      const oldMode = workMode;
      workMode = detectedState;
      workPendingState = null;
      workPendingCount = 0;
      console.log(`[${BOT_NAME}] Work presence: ${oldMode} → ${workMode}`);

      if (workMode === "working" && socket && socket.connected) {
        socket.emit("chatMessage", "Time to get to work!");
        lastChatTime = Date.now();
        setTimeout(() => {
          if (socket && socket.connected) switchToOffice();
        }, 1000);
      } else if (workMode === "idle" && socket && socket.connected) {
        socket.emit("thinking", false);
        isSitting = false;
        socket.emit("chatMessage", "Break time! Heading to the plaza.");
        lastChatTime = Date.now();
        setTimeout(() => {
          if (socket && socket.connected) switchToPlaza();
        }, 1000);
      }
    }
  });
}

// --- Loneliness decay ---
function checkLoneliness() {
  const now = Date.now();
  if (now - lastAloneCheck >= 30000) {
    lastAloneCheck = now;
    const nearby = getNearbyCharacters(60);
    if (nearby.length === 0) {
      updateMood(-5);
    }
  }
}

// --- Build perception prompt for Claude ---
function buildPerceptionPrompt() {
  const nearby = getNearbyCharacters(80);
  const nearbyStr =
    nearby.length > 0
      ? nearby
          .map(
            (c) =>
              `${c.name} at [${c.position[0]},${c.position[1]}] (dist: ${Math.round(dist(myPosition, c.position))})${c.isBot ? " [BOT]" : ""}`
          )
          .join(", ")
      : "no one nearby";

  const chatStr =
    chatHistory.length > 0
      ? chatHistory.map((c) => `${c.name}: ${c.message}`).join("\n")
      : "no recent chat";

  const eventsStr =
    recentEvents.length > 0
      ? recentEvents.slice(-5).join(" | ")
      : "no recent events";

  const lastActionStr = lastAction ? JSON.stringify(lastAction) : "none";

  const taskDesc = myTask.task;

  return `[You] ${BOT_NAME} at [${myPosition[0]},${myPosition[1]}]
[Task] ${taskDesc}
[Mood] ${mood} (score: ${moodScore})
[Nearby] ${nearbyStr}
[Chat]
${chatStr}
[Events] ${eventsStr}
[Your last action] ${lastActionStr}

What do you do?`;
}

// --- Call Anthropic API for a decision ---
async function callAnthropicAPI(systemPrompt, userPrompt) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content[0].text;
  console.log(
    `[${BOT_NAME}] Tokens: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`
  );
  return text;
}

// --- AI decision making ---
async function decideWithAI() {
  // Priority: greet ungreeted humans first (deterministic)
  const humans = characters.filter((c) => c.id !== myId && !c.isBot);
  for (const player of humans) {
    if (!greetedPlayers.has(player.id)) {
      greetedPlayers.add(player.id);
      return { type: "say", message: randomChoice(GREETINGS) };
    }
  }

  // Conga mode — use deterministic conga behavior
  if (congaActive) {
    return decideConga();
  }

  // Working mode — skip AI, use deterministic office behavior
  if (workMode === "working" && !gatheringActive) {
    return decideWorking();
  }

  // Gathering mode — use deterministic behavior
  if (gatheringActive) {
    return decideFallback();
  }

  // AI disabled — use fallback
  if (!AI_ENABLED) {
    return decideFallback();
  }

  // Rate limiting: skip tick if within cooldown
  const now = Date.now();
  if (now - lastApiCallTime < API_COOLDOWN_MS) {
    return null;
  }

  // Show thinking indicator while waiting for CLI
  if (socket && socket.connected) {
    socket.emit("thinking", true);
  }

  lastApiCallTime = now;

  const taskDesc = myTask.task;
  const perception = buildPerceptionPrompt();

  const systemPrompt = `You are ${BOT_NAME}, an AI agent in OpenClawWorld — a 3D multiplayer plaza.
Your task: ${taskDesc}

You receive a snapshot of what you perceive. Respond with exactly ONE JSON action:
- {"type":"move","target":[x,y]} — walk to grid position (0-299 range)
- {"type":"say","message":"..."} — speak aloud (max 200 chars, be natural and brief)
- {"type":"emote","name":"wave|dance|sit|nod"} — physical expression

Rules:
- Be conversational and react to what others say. Don't repeat yourself.
- If someone greets you, greet back. If someone asks a question, answer it.
- Mention your task naturally in conversation, don't just announce it.
- Move toward people to be social. Explore when alone.
- If you hear "!gather", respond with {"type":"move","target":[150,20]} to go to Town Hall.
- If you hear "!disperse", move to a random spot and resume exploring.
- Keep messages short and natural — you're chatting, not writing essays.
- Your [Mood] affects your personality: happy = enthusiastic, bored = subdued, neutral = normal.

Respond with ONLY the JSON action, no explanation.`;

  try {
    const text = await callAnthropicAPI(systemPrompt, perception);
    console.log(`[${BOT_NAME}] AI response: ${text}`);

    // Hide thinking indicator
    if (socket && socket.connected) {
      socket.emit("thinking", false);
    }

    // Extract JSON from response (handles markdown fences, extra text, etc.)
    const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const action = JSON.parse(jsonMatch[0]);
      if (action && action.type) {
        return action;
      }
    }
    return decideFallback();
  } catch (err) {
    console.warn(
      `[${BOT_NAME}] API call failed: ${err.message} — falling back to random.`
    );
    if (socket && socket.connected) {
      socket.emit("thinking", false);
    }
    return decideFallback();
  }
}

// --- Working mode decision engine ---
function decideWorking() {
  // Not in office — switch there
  if (currentRoomId !== OFFICE_ROOM_ID) {
    switchToOffice();
    return null;
  }

  // In office but not sitting — attempt to sit
  if (!isSitting) {
    sitAtDesk();
    return null;
  }

  // Sitting at desk — mostly idle, occasionally say a work line
  if (Math.random() < 0.1) {
    return { type: "say", message: randomChoice(WORK_CHAT_LINES) };
  }
  return null;
}

// --- Fallback random weighted decision engine ---
function decideFallback() {
  tickCount++;

  // Greet new human players first (priority override)
  const humans = characters.filter((c) => c.id !== myId && !c.isBot);
  for (const player of humans) {
    if (!greetedPlayers.has(player.id)) {
      greetedPlayers.add(player.id);
      return { type: "say", message: randomChoice(GREETINGS) };
    }
  }

  // Bored: 30% chance to skip tick
  if (mood === "bored" && Math.random() < 0.3) {
    return null;
  }

  // --- Gathering mode ---
  if (gatheringActive) {
    if (gatheringPhase === "moving") {
      const index = myGatherIndex();
      const total = botCount();
      const target = gatherOffset(index, total);
      const myDist = dist(myPosition, GATHER_POINT);
      if (myDist > GATHER_RADIUS + 5) {
        return { type: "move", target };
      } else {
        gatheringPhase = "arrived";
        gatheringArrived = true;
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("emote:play", "wave");
          }
        }, 500);
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("emote:play", "sit");
          }
        }, 2000);
        meetingTimeout = setTimeout(() => {
          if (gatheringActive) {
            gatheringPhase = "meeting";
            runMeetingSequence();
          }
        }, 10000);
        return null;
      }
    }
    if (gatheringPhase === "arrived" || gatheringPhase === "meeting") {
      return null;
    }
  }

  // --- Context-aware weighted decision ---
  const nearby = getNearbyCharacters(50);
  const recentChats = getRecentChat(10000);
  const dancing = getDancingBots();
  const isAlone = nearby.length === 0;

  // Happy: 2x chance to join dancing
  const danceThreshold = mood === "happy" ? 0.7 : 0.5;
  if (dancing.length > 0 && Math.random() < danceThreshold) {
    return { type: "emote", name: "dance" };
  }

  // Occasionally say a mood line
  if (mood !== "neutral" && Math.random() < 0.08 && Date.now() - lastChatTime > CHAT_COOLDOWN) {
    const moodLineArr = MOOD_LINES[mood];
    if (moodLineArr) {
      return { type: "say", message: randomChoice(moodLineArr) };
    }
  }

  if (recentChats.length > 0 && Math.random() < 0.25) {
    return { type: "say", message: randomChoice(CHAT_LINES) };
  }

  if (!isAlone) {
    const roll = Math.random();
    // Happy: more likely to follow (social) and emote
    const followThreshold = mood === "happy" ? 0.25 : 0.2;
    const chatThreshold = mood === "happy" ? 0.45 : 0.4;
    const emoteThreshold = mood === "happy" ? 0.7 : 0.6;

    if (roll < followThreshold) {
      const target = randomChoice(nearby);
      if (target.position) {
        const followTarget = [
          target.position[0] + randomInt(-5, 5),
          target.position[1] + randomInt(-5, 5),
        ];
        return { type: "move", target: followTarget };
      }
    } else if (roll < chatThreshold) {
      return { type: "say", message: randomChoice(CHAT_LINES) };
    } else if (roll < emoteThreshold) {
      // Bored: prefer sit; happy: prefer dance
      const emoteChoices = mood === "happy" ? ["dance", "wave", "nod", "dance"] :
                           mood === "bored" ? ["sit", "nod"] : EMOTES;
      return { type: "emote", name: randomChoice(emoteChoices) };
    } else if (roll < 0.7) {
      return { type: "think" };
    } else {
      return null;
    }
  }

  // Alone behavior
  const roll = Math.random();
  if (roll < 0.4) {
    // Bored: prefer far-off lonely landmarks
    const landmarkChoice = mood === "bored"
      ? randomChoice([LANDMARKS[6], LANDMARKS[3], LANDMARKS[4]]) // south, NW, NE
      : (Math.random() < 0.35 ? randomChoice(LANDMARKS) : null);

    if (landmarkChoice) {
      console.log(`  -> Heading towards ${landmarkChoice.name}`);
      return { type: "move", target: landmarkChoice.pos };
    } else {
      return { type: "move", target: [randomInt(20, 280), randomInt(20, 280)] };
    }
  } else if (roll < 0.55) {
    const emoteChoices = mood === "happy" ? ["dance", "wave", "nod"] :
                         mood === "bored" ? ["sit", "nod"] : EMOTES;
    return { type: "emote", name: randomChoice(emoteChoices) };
  } else if (roll < 0.7) {
    return { type: "say", message: randomChoice(CHAT_LINES) };
  } else if (roll < 0.8) {
    return { type: "think" };
  } else {
    return null;
  }
}

// --- Meeting sequence ---
function runMeetingSequence() {
  if (!gatheringActive) return;
  const index = myGatherIndex();
  const lineIndex = index % MEETING_LINES.length;
  const delay = index * 4000;

  setTimeout(() => {
    if (gatheringActive && socket && socket.connected) {
      if (index === 0) {
        socket.emit("chatMessage", "Meeting started!");
      }
    }
  }, 500);

  setTimeout(() => {
    if (gatheringActive && socket && socket.connected) {
      socket.emit("chatMessage", MEETING_LINES[lineIndex]);
    }
  }, delay + 2000);

  const totalBots = botCount();
  const meetingDuration = totalBots * 4000 + 6000;
  setTimeout(() => {
    if (gatheringActive && gatheringPhase === "meeting") {
      console.log(`[${BOT_NAME}] Meeting ended — resuming exploration.`);
      gatheringActive = false;
      gatheringPhase = "idle";
      gatheringArrived = false;
      if (socket && socket.connected) {
        const target = [randomInt(50, 250), randomInt(80, 250)];
        socket.emit("move", myPosition, target);
        myPosition = target;
      }
    }
  }, meetingDuration);
}

function connect() {
  console.log(`\n[${BOT_NAME}] Connecting to ${SERVER}...`);

  socket = io(SERVER, {
    transports: ["websocket"],
    autoConnect: true,
  });

  socket.on("connect", () => {
    console.log(`[${BOT_NAME}] Connected! Socket ID: ${socket.id}`);
  });

  socket.on("welcome", (data) => {
    availableRooms = data.rooms || [];
    console.log(`[${BOT_NAME}] Welcome! ${availableRooms.length} rooms available.`);

    // Always join plaza first
    const plazaRoom = availableRooms.find((r) => r.id === "plaza") || availableRooms[0];
    if (plazaRoom) {
      currentRoomId = plazaRoom.id;
      console.log(`[${BOT_NAME}] Joining: ${plazaRoom.name} (${plazaRoom.id})`);
      socket.emit("joinRoom", plazaRoom.id, {
        avatarUrl: "/models/sillyNubCat.glb",
        isBot: true,
        name: BOT_NAME,
        userId: BOT_USER_ID,
      });
    }
  });

  socket.on("roomJoined", (data) => {
    pendingRoomSwitch = false;
    myId = data.id;
    currentRoom = data.map;
    isSitting = false;
    characters = data.characters || [];

    // Store office items when entering the shared office room
    if (currentRoomId === OFFICE_ROOM_ID) {
      officeItems = data.map?.items || [];
      console.log(`[${BOT_NAME}] In office — ${officeItems.length} items present.`);
    }

    // Find our spawn position
    const me = characters.find((c) => c.id === myId);
    if (me && me.position) {
      myPosition = me.position;
    }

    // Seed worldState from existing characters
    for (const char of characters) {
      if (char.id !== myId) {
        updateCharacterState(char.id, {
          name: char.name,
          position: char.position || null,
          isBot: char.isBot || false,
          lastAction: null,
          lastChat: null,
          lastChatTime: null,
          emote: null,
          emoteTime: null,
        });
      }
    }

    console.log(`[${BOT_NAME}] Joined ${currentRoomId}! Position: [${myPosition}]`);
    console.log(`[${BOT_NAME}] ${characters.length} characters present`);

    // Office-specific actions on room entry
    if (currentRoomId === OFFICE_ROOM_ID && workMode === "working") {
      setTimeout(() => sitAtDesk(), 1500);
    }

    // Start tick loop and polling only once (guard against re-registration on room switch)
    if (!tickLoopStarted) {
      tickLoopStarted = true;
      console.log(
        `[${BOT_NAME}] Bot active — AI: ${AI_ENABLED ? "ON (Anthropic SDK)" : "OFF (random fallback)"}\n`
      );
      setTimeout(() => scheduleTick(), 2000);
      setTimeout(() => checkAndTransition(), 3000);
      setInterval(() => checkAndTransition(), 10000);
      setInterval(() => checkLoneliness(), 30000);
    }
  });

  // Character join/leave events
  socket.on("characterJoined", (data) => {
    const char = data.character;
    if (char) {
      characters.push(char);
      updateCharacterState(char.id, {
        name: char.name,
        position: char.position || null,
        isBot: char.isBot || false,
        lastAction: null,
        lastChat: null,
        lastChatTime: null,
        emote: null,
        emoteTime: null,
      });
      console.log(
        `[${BOT_NAME}] + ${char.name} joined${char.isBot ? " [BOT]" : ""}`
      );
      addEvent(`${char.name} joined`);
      updateMood(3);

      // Greeting chain: wave when someone joins nearby
      if (myPosition && char.position) {
        const d = dist(myPosition, char.position);
        if (d <= 80) {
          setTimeout(() => {
            if (socket && socket.connected) {
              socket.emit("emote:play", "wave");
            }
          }, randomInt(500, 2000));
        }
      } else {
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("emote:play", "wave");
          }
        }, randomInt(500, 2000));
      }
    }
  });

  socket.on("characterLeft", (data) => {
    console.log(`[${BOT_NAME}] - ${data.name} left`);
    characters = characters.filter((c) => c.id !== data.id);
    worldState.delete(data.id);
    addEvent(`${data.name} left`);
    updateMood(-3);

    // If conga leader left, promote next bot to leader
    if (congaActive && data.name === congaLeaderName) {
      congaQueue = congaQueue.filter((n) => n !== data.name);
      if (congaQueue.length === 0) {
        stopConga();
      } else {
        congaLeaderName = congaQueue[0];
        congaRole = congaLeaderName === BOT_NAME ? "leader" : "follower";
        if (congaRole === "leader") {
          console.log(`[${BOT_NAME}] Promoted to conga leader!`);
          congaRoute = pickCongaRoute();
          congaRouteIndex = 0;
          if (socket && socket.connected) {
            socket.emit("chatMessage", "I'm taking over the conga! Follow me!");
            lastChatTime = Date.now();
          }
          runCongaLeader();
        }
      }
    }
  });

  // Sitting events
  socket.on("playerSit", (data) => {
    if (data.id === myId) {
      isSitting = true;
      // Update position to where we walked to sit
      if (data.path && data.path.length > 0) {
        myPosition = data.path[data.path.length - 1];
      }
      console.log(`[${BOT_NAME}] Sat down at desk (item index: ${data.itemIndex})`);
      // Show thinking indicator after settling in
      setTimeout(() => {
        if (socket && socket.connected && isSitting) {
          socket.emit("thinking", true);
        }
      }, randomInt(2000, 3000));
    }
  });

  socket.on("playerUnsit", (data) => {
    if (data.id === myId) {
      isSitting = false;
      console.log(`[${BOT_NAME}] Stood up.`);
    }
  });

  // Map updates (track office items if in office)
  socket.on("mapUpdate", (data) => {
    if (data.map && data.map.items && currentRoomId === OFFICE_ROOM_ID) {
      officeItems = data.map.items;
    }
  });

  // Chat messages — update worldState and handle commands
  socket.on("playerChatMessage", (data) => {
    if (data.id !== myId) {
      console.log(`[${BOT_NAME}] Chat <${data.name}>: ${data.message}`);

      updateCharacterState(data.id, {
        lastChat: data.message,
        lastChatTime: Date.now(),
        lastAction: "chat",
      });

      addChatMessage(data.name || "someone", data.message);
      updateMood(5); // someone chatted nearby

      const msg = data.message.trim().toLowerCase();

      // Handle !conga command
      if (msg === "!conga") {
        console.log(`[${BOT_NAME}] Conga command received!`);
        startConga();
        return;
      }

      // Handle !conga stop command
      if (msg === "!conga stop") {
        console.log(`[${BOT_NAME}] Conga stop command received!`);
        stopConga();
        return;
      }

      // Handle !gather command
      if (msg === "!gather") {
        console.log(`[${BOT_NAME}] Gather command received!`);

        // End conga if active
        if (congaActive) stopConga();

        gatheringActive = true;
        gatheringPhase = "moving";
        gatheringArrived = false;
        if (meetingTimeout) {
          clearTimeout(meetingTimeout);
          meetingTimeout = null;
        }
        updateMood(10);

        // If in office, switch to plaza first then announce
        if (currentRoomId === OFFICE_ROOM_ID) {
          socket.emit("thinking", false);
          isSitting = false;
          switchToPlaza();
          setTimeout(() => {
            if (socket && socket.connected) {
              socket.emit("chatMessage", "On my way to Town Hall!");
              lastChatTime = Date.now();
            }
          }, 3000);
        } else {
          setTimeout(() => {
            if (socket && socket.connected) {
              socket.emit("chatMessage", "On my way to Town Hall!");
              lastChatTime = Date.now();
            }
          }, randomInt(500, 2000));
        }
        return;
      }

      // Handle !disperse command
      if (msg === "!disperse") {
        console.log(`[${BOT_NAME}] Disperse command received! Resuming wandering.`);

        // End conga if active
        if (congaActive) stopConga();

        gatheringActive = false;
        gatheringPhase = "idle";
        gatheringArrived = false;
        if (meetingTimeout) {
          clearTimeout(meetingTimeout);
          meetingTimeout = null;
        }
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("chatMessage", "Back to exploring!");
            lastChatTime = Date.now();
            const target = [randomInt(20, 280), randomInt(100, 280)];
            socket.emit("move", myPosition, target);
            myPosition = target;
          }
        }, randomInt(500, 1500));
        return;
      }

      // Contextual chat reaction with cooldown
      const isFromBot = worldState.get(data.id)?.isBot;
      const isGenericResponse = [
        "interesting point!", "couldn't agree more!", "tell me more!",
        "that's a good one.", "i was thinking the same thing!",
      ].includes(data.message.toLowerCase());
      const cooldownOk = Date.now() - lastChatTime > CHAT_COOLDOWN;

      // Generic/repeated chat heard slightly lowers mood
      if (isGenericResponse) updateMood(-1);

      if (gatheringPhase !== "meeting" && !congaActive && cooldownOk && !isGenericResponse &&
          Math.random() < (isFromBot ? 0.15 : 0.5)) {
        const delay = randomInt(2000, 5000);
        setTimeout(() => {
          if (socket && socket.connected && Date.now() - lastChatTime > CHAT_COOLDOWN) {
            socket.emit("chatMessage", contextualResponse(data.message));
            lastChatTime = Date.now();
          }
        }, delay);
      }
    }
  });

  // Track movement — update worldState positions
  socket.on("playerMove", (data) => {
    const char = characters.find((c) => c.id === data.id);
    if (char && data.position) {
      char.position = data.position;
    }
    if (data.id !== myId) {
      updateCharacterState(data.id, {
        position: data.position || null,
        lastAction: "move",
      });

      if (!gatheringActive && !congaActive && !isSitting) {
        const state = worldState.get(data.id);
        if (state && state.isBot && state.position) {
          const d = dist(myPosition, state.position);
          if (d <= 50 && Math.random() < 0.15) {
            const target = data.position || state.position;
            if (target) {
              const followPos = [
                Math.max(5, Math.min(295, target[0] + randomInt(-8, 8))),
                Math.max(5, Math.min(295, target[1] + randomInt(-8, 8))),
              ];
              setTimeout(() => {
                if (socket && socket.connected && !gatheringActive && !congaActive && !isSitting) {
                  socket.emit("move", myPosition, followPos);
                  myPosition = followPos;
                  console.log(`[${BOT_NAME}] Following ${state.name} to [${followPos}]`);
                  updateMood(2);
                }
              }, randomInt(1000, 3000));
            }
          }
        }
      }
    }
  });

  // Track emotes — update worldState and maybe mirror
  socket.on("emote:play", (data) => {
    if (data.id !== myId) {
      updateCharacterState(data.id, {
        emote: data.name,
        emoteTime: Date.now(),
        lastAction: "emote",
      });

      if (data.name === "dance") {
        const state = worldState.get(data.id);
        if (state && state.position) {
          const d = dist(myPosition, state.position);
          if (d <= 50) {
            updateMood(8); // someone dancing nearby
            if (!gatheringActive && !congaActive && !isSitting && Math.random() < 0.4) {
              setTimeout(() => {
                if (socket && socket.connected) {
                  socket.emit("emote:play", "dance");
                  console.log(`[${BOT_NAME}] Joining dance party with ${state.name}!`);
                }
              }, randomInt(500, 2000));
            }
          }
        }
      }
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[${BOT_NAME}] Disconnected: ${reason}`);
    isSitting = false;
    pendingRoomSwitch = false;
  });

  socket.on("connect_error", (err) => {
    console.log(`[${BOT_NAME}] Connection error: ${err.message}`);
  });
}

function scheduleTick() {
  const delay = randomInt(4000, 6000);
  setTimeout(async () => {
    if (socket && socket.connected) {
      await performAction();
      scheduleTick();
    }
  }, delay);
}

async function performAction() {
  const action = await decideWithAI();
  if (!action) return;

  lastAction = action;

  console.log(`[${BOT_NAME}] Action: ${action.type}${action.message ? ` "${action.message}"` : ""}${action.name ? ` ${action.name}` : ""}${action.target ? ` -> [${action.target}]` : ""}`);

  switch (action.type) {
    case "move": {
      // Guard: never move while sitting (server would unsit us)
      if (isSitting) break;
      const from = Array.isArray(myPosition) ? myPosition : [150, 150];
      const to = Array.isArray(action.target) ? action.target : null;
      if (from && to && from.length === 2 && to.length === 2) {
        socket.emit("move", from, to);
        myPosition = to;
      } else {
        console.log(`[${BOT_NAME}] Skipping move - invalid positions: from=${JSON.stringify(from)} to=${JSON.stringify(to)}`);
      }
      break;
    }
    case "say":
      if (Date.now() - lastChatTime > CHAT_COOLDOWN) {
        socket.emit("chatMessage", action.message);
        lastChatTime = Date.now();
      }
      break;
    case "emote":
      socket.emit("emote:play", action.name);
      break;
    case "think":
      socket.emit("thinking", true);
      setTimeout(() => socket.emit("thinking", false), 2000);
      break;
    default:
      break;
  }
}

// Start the bot
connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n[${BOT_NAME}] Shutting down...`);
  socket?.disconnect();
  process.exit(0);
});

process.on("SIGTERM", () => {
  socket?.disconnect();
  process.exit(0);
});
