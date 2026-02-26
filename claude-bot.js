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
 *
 * Usage: node claude-bot.js [botName] [serverUrl]
 */

import { io } from "socket.io-client";

const BOT_NAME = process.argv[2] || "ClaudeAgent";
const SERVER = process.argv[3] || "http://localhost:3000";
const BOT_USER_ID = `claude-bot-${BOT_NAME}-${Date.now()}`;

let socket = null;
let currentRoom = null;
let myId = null;
let myPosition = [150, 150]; // grid position [x, y]
let characters = [];
let tickCount = 0;
let greetedPlayers = new Set();

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

const CHAT_LINES = [
  "This plaza is really cool!",
  "Anyone want to explore together?",
  "I love wandering around this world.",
  "What a beautiful day in the virtual world!",
  "Claude Code agent, at your service!",
  "I should check out the apartments sometime.",
  "The town hall looks impressive from here!",
  "Just vibing in the metaverse.",
];

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
  // Generic fallback responses referencing the content
  const fallbacks = [
    "Interesting point!",
    "I was thinking the same thing!",
    "Tell me more!",
    "That's a good one.",
    "Couldn't agree more!",
  ];
  return randomChoice(fallbacks);
}

// --- Weighted decision engine ---
function decide() {
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
      // Keep moving toward our assigned gather spot
      const index = myGatherIndex();
      const total = botCount();
      const target = gatherOffset(index, total);
      const myDist = dist(myPosition, GATHER_POINT);
      if (myDist > GATHER_RADIUS + 5) {
        return { type: "move", target };
      } else {
        // Arrived — wave then sit
        gatheringPhase = "arrived";
        gatheringArrived = true;
        // Sequence: wave now, sit shortly after
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
        // After 10s, start meeting
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
      // Just idle — meeting sequence handles chat
      return null;
    }
  }

  // --- Context-aware weighted decision ---
  const nearby = getNearbyCharacters(50);
  const recentChats = getRecentChat(10000);
  const dancing = getDancingBots();
  const isAlone = nearby.length === 0;

  // If others are dancing nearby, join the dance party
  if (dancing.length > 0 && Math.random() < 0.5) {
    return { type: "emote", name: "dance" };
  }

  // If someone chatted recently, respond contextually
  if (recentChats.length > 0 && Math.random() < 0.45) {
    const talker = randomChoice(recentChats);
    if (talker.lastChat) {
      return { type: "say", message: contextualResponse(talker.lastChat) };
    }
  }

  // If nearby others, increase social actions
  if (!isAlone) {
    const roll = Math.random();
    if (roll < 0.2) {
      // Follow a nearby bot toward their last known position
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
      return null; // observe
    }
  }

  // Alone — wander toward landmarks or random
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
    return null; // idle
  }
}

// --- Meeting sequence ---
function runMeetingSequence() {
  if (!gatheringActive) return;
  // Stagger lines across bots based on index
  const index = myGatherIndex();
  const lineIndex = index % MEETING_LINES.length;
  const delay = index * 4000; // stagger by 4s per bot

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
    const rooms = data.rooms || [];
    console.log(`[${BOT_NAME}] Welcome! ${rooms.length} rooms available.`);

    if (rooms.length > 0) {
      const room = rooms[0];
      console.log(`[${BOT_NAME}] Joining: ${room.name} (${room.id})`);
      socket.emit("joinRoom", room.id, {
        avatarUrl:
          "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
        isBot: true,
        name: BOT_NAME,
        userId: BOT_USER_ID,
      });
    }
  });

  socket.on("roomJoined", (data) => {
    myId = data.id;
    currentRoom = data.map;
    characters = data.characters || [];

    // Find our own character to get spawn position
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

    console.log(`[${BOT_NAME}] Joined room! My position: [${myPosition}]`);
    console.log(`[${BOT_NAME}] ${characters.length} characters present`);
    console.log(
      `[${BOT_NAME}] Bot is now active and will act every 4-6 seconds\n`
    );

    // Wait a moment before starting the decision loop
    setTimeout(() => scheduleTick(), 2000);
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

      // Greeting chain: all nearby bots wave when someone joins
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
        // Wave anyway if we can't determine distance
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
  });

  // Chat messages — update worldState and handle commands
  socket.on("playerChatMessage", (data) => {
    if (data.id !== myId) {
      console.log(`[${BOT_NAME}] Chat <${data.name}>: ${data.message}`);

      // Update world state with last chat
      updateCharacterState(data.id, {
        lastChat: data.message,
        lastChatTime: Date.now(),
        lastAction: "chat",
      });

      const msg = data.message.trim().toLowerCase();

      // Handle !gather command
      if (msg === "!gather") {
        console.log(`[${BOT_NAME}] Gather command received! Heading to Town Hall.`);
        gatheringActive = true;
        gatheringPhase = "moving";
        gatheringArrived = false;
        if (meetingTimeout) {
          clearTimeout(meetingTimeout);
          meetingTimeout = null;
        }
        // Announce and move
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("chatMessage", "On my way to Town Hall!");
          }
        }, randomInt(500, 2000));
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
            // Move away from gather point to a random spot
            const target = [randomInt(20, 280), randomInt(100, 280)];
            socket.emit("move", myPosition, target);
            myPosition = target;
          }
        }, randomInt(500, 1500));
        return;
      }

      // Contextual chat reaction (not during gathering meeting)
      if (gatheringPhase !== "meeting") {
        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit("chatMessage", contextualResponse(data.message));
          }
        }, randomInt(1500, 4000));
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

      // Follow behavior: if a nearby bot moves and we're not gathering, maybe follow
      if (!gatheringActive) {
        const state = worldState.get(data.id);
        if (state && state.isBot && state.position) {
          const d = dist(myPosition, state.position);
          if (d <= 50 && Math.random() < 0.15) {
            // Follow toward their destination with slight offset
            const target = data.position || state.position;
            if (target) {
              const followPos = [
                Math.max(5, Math.min(295, target[0] + randomInt(-8, 8))),
                Math.max(5, Math.min(295, target[1] + randomInt(-8, 8))),
              ];
              setTimeout(() => {
                if (socket && socket.connected && !gatheringActive) {
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

      // Emote mirroring: if a nearby bot dances, join in
      if (data.name === "dance" && !gatheringActive) {
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
  });

  socket.on("connect_error", (err) => {
    console.log(`[${BOT_NAME}] Connection error: ${err.message}`);
  });
}

function scheduleTick() {
  const delay = randomInt(4000, 6000);
  setTimeout(() => {
    if (socket && socket.connected) {
      performAction();
      scheduleTick();
    }
  }, delay);
}

function performAction() {
  const action = decide();
  if (!action) return;

  console.log(`[${BOT_NAME}] Action: ${action.type}${action.message ? ` "${action.message}"` : ""}${action.name ? ` ${action.name}` : ""}${action.target ? ` -> [${action.target}]` : ""}`);

  switch (action.type) {
    case "move": {
      // move takes (from, to) - two array arguments
      const from = Array.isArray(myPosition) ? myPosition : [150, 150];
      const to = Array.isArray(action.target) ? action.target : null;
      if (from && to && from.length === 2 && to.length === 2) {
        socket.emit("move", from, to);
        myPosition = to; // optimistically update
      } else {
        console.log(`[${BOT_NAME}] Skipping move - invalid positions: from=${JSON.stringify(from)} to=${JSON.stringify(to)}`);
      }
      break;
    }
    case "say":
      // chatMessage takes a plain string
      socket.emit("chatMessage", action.message);
      break;
    case "emote":
      // emote event is "emote:play"
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
