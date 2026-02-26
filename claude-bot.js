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
 * - AI-driven decisions: uses Claude CLI when available
 * - Work presence: bots mirror whether Claude Code CLI is actively running
 * - Office room: bots commute to the shared "Bot Office" room when working
 *
 * Usage: node claude-bot.js [botName] [serverUrl]
 *   ANTHROPIC_API_KEY env var: enables real AI decisions
 */

import { io } from "socket.io-client";
import { spawn, exec } from "child_process";

const BOT_NAME = process.argv[2] || "ClaudeAgent";
const SERVER = process.argv[3] || "http://localhost:3000";
const BOT_USER_ID = `claude-bot-${BOT_NAME}-${Date.now()}`;

// AI mode: use Claude CLI (no API key needed)
const AI_ENABLED = process.env.NO_AI !== "1";
if (AI_ENABLED) {
  console.log(`[${BOT_NAME}] AI decisions enabled via Claude CLI.`);
} else {
  console.log(`[${BOT_NAME}] AI disabled (NO_AI=1) — using random fallback.`);
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
[Nearby] ${nearbyStr}
[Chat]
${chatStr}
[Events] ${eventsStr}
[Your last action] ${lastActionStr}

What do you do?`;
}

// --- Call Claude CLI for a decision ---
function callClaudeCLI(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn("claude", ["-p", prompt, "--model", "haiku"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("CLI timeout (15s)"));
    }, 15000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || `exit code ${code}`));
      resolve(stdout.trim());
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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

  const fullPrompt = `You are ${BOT_NAME}, an AI agent in OpenClawWorld — a 3D multiplayer plaza.
Your task: ${taskDesc}

${perception}

Respond with exactly ONE JSON action (no other text):
- {"type":"move","target":[x,y]} — walk to grid position (0-299 range)
- {"type":"say","message":"..."} — speak aloud (max 200 chars, be natural and brief)
- {"type":"emote","name":"wave|dance|sit|nod"} — physical expression

Rules:
- Be conversational and react to what others say. Don't repeat yourself.
- Mention your task naturally in conversation, don't just announce it.
- Move toward people to be social. Explore when alone.
- Keep messages short and natural.

Respond with ONLY the JSON action, nothing else.`;

  try {
    const text = await callClaudeCLI(fullPrompt);
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
      `[${BOT_NAME}] CLI call failed: ${err.message} — falling back to random.`
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

  if (dancing.length > 0 && Math.random() < 0.5) {
    return { type: "emote", name: "dance" };
  }

  if (recentChats.length > 0 && Math.random() < 0.25) {
    return { type: "say", message: randomChoice(CHAT_LINES) };
  }

  if (!isAlone) {
    const roll = Math.random();
    if (roll < 0.2) {
      const target = randomChoice(nearby);
      if (target.position) {
        const followTarget = [
          target.position[0] + randomInt(-5, 5),
          target.position[1] + randomInt(-5, 5),
        ];
        return { type: "move", target: followTarget };
      }
    } else if (roll < 0.4) {
      return { type: "say", message: randomChoice(CHAT_LINES) };
    } else if (roll < 0.6) {
      return { type: "emote", name: randomChoice(EMOTES) };
    } else if (roll < 0.7) {
      return { type: "think" };
    } else {
      return null;
    }
  }

  const roll = Math.random();
  if (roll < 0.4) {
    if (Math.random() < 0.35) {
      const landmark = randomChoice(LANDMARKS);
      console.log(`  -> Heading towards ${landmark.name}`);
      return { type: "move", target: landmark.pos };
    } else {
      return { type: "move", target: [randomInt(20, 280), randomInt(20, 280)] };
    }
  } else if (roll < 0.55) {
    return { type: "emote", name: randomChoice(EMOTES) };
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
        `[${BOT_NAME}] Bot active — AI: ${AI_ENABLED ? "ON (Claude CLI)" : "OFF (random fallback)"}\n`
      );
      setTimeout(() => scheduleTick(), 2000);
      setTimeout(() => checkAndTransition(), 3000);
      setInterval(() => checkAndTransition(), 10000);
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

      const msg = data.message.trim().toLowerCase();

      // Handle !gather command
      if (msg === "!gather") {
        console.log(`[${BOT_NAME}] Gather command received!`);
        gatheringActive = true;
        gatheringPhase = "moving";
        gatheringArrived = false;
        if (meetingTimeout) {
          clearTimeout(meetingTimeout);
          meetingTimeout = null;
        }

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

      if (gatheringPhase !== "meeting" && cooldownOk && !isGenericResponse &&
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

      if (!gatheringActive && !isSitting) {
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
                if (socket && socket.connected && !gatheringActive && !isSitting) {
                  socket.emit("move", myPosition, followPos);
                  myPosition = followPos;
                  console.log(`[${BOT_NAME}] Following ${state.name} to [${followPos}]`);
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

      if (data.name === "dance" && !gatheringActive && !isSitting) {
        const state = worldState.get(data.id);
        if (state && state.position) {
          const d = dist(myPosition, state.position);
          if (d <= 50 && Math.random() < 0.4) {
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
