/**
 * Claude Code Agent Bot for OpenClawWorld
 *
 * Connects a bot to the local server via Socket.IO.
 * The bot wanders the plaza, greets players, chats, dances,
 * and explores the world autonomously.
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

const EMOTES = ["wave", "dance", "sit", "nod"];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function decide() {
  tickCount++;
  const nearbyPlayers = characters.filter((c) => c.id !== myId && !c.isBot);

  // Greet new human players
  for (const player of nearbyPlayers) {
    if (!greetedPlayers.has(player.id)) {
      greetedPlayers.add(player.id);
      return { type: "say", message: randomChoice(GREETINGS) };
    }
  }

  const roll = Math.random();

  if (roll < 0.4) {
    // Move to a landmark or random spot
    if (Math.random() < 0.35) {
      const landmark = randomChoice(LANDMARKS);
      console.log(`  -> Heading towards ${landmark.name}`);
      return { type: "move", target: landmark.pos };
    } else {
      return { type: "move", target: [randomInt(20, 280), randomInt(20, 280)] };
    }
  } else if (roll < 0.55) {
    // Emote
    return { type: "emote", name: randomChoice(EMOTES) };
  } else if (roll < 0.7) {
    // Chat
    return { type: "say", message: randomChoice(CHAT_LINES) };
  } else if (roll < 0.8) {
    // Think (show thinking indicator)
    return { type: "think" };
  } else {
    // Just observe / idle
    return null;
  }
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
      console.log(
        `[${BOT_NAME}] + ${char.name} joined${char.isBot ? " [BOT]" : ""}`
      );
    }
  });

  socket.on("characterLeft", (data) => {
    console.log(`[${BOT_NAME}] - ${data.name} left`);
    characters = characters.filter((c) => c.id !== data.id);
  });

  // Chat messages
  socket.on("playerChatMessage", (data) => {
    if (data.id !== myId) {
      console.log(`[${BOT_NAME}] Chat <${data.name}>: ${data.message}`);
      // React to chat
      setTimeout(() => {
        const responses = [
          `Nice to hear from you, ${data.name}!`,
          "That's interesting!",
          "I agree!",
          `Hey ${data.name}!`,
          "Tell me more!",
        ];
        socket.emit("chatMessage", randomChoice(responses));
      }, 1500);
    }
  });

  // Track movement of others
  socket.on("playerMove", (data) => {
    const char = characters.find((c) => c.id === data.id);
    if (char && data.position) {
      char.position = data.position;
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
