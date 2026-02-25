/**
 * Manual Bot Testing Script
 *
 * Creates a bot that can send coins and invites to users.
 * Run this alongside a browser session to test bot interactions.
 *
 * Usage:
 *   node test-bot-manual.js [serverUrl]
 *   (default serverUrl: http://localhost:3000)
 *
 * Commands (enter in terminal while running):
 *   transfer <userId> <amount>  - Send coins to a user
 *   invite <socketId>           - Invite a user to your room
 *   list                        - List all users in current room
 *   switch <roomId>             - Switch to a different room
 *   rooms                       - List available rooms
 *   status                      - Show bot status and balance
 *   help                        - Show this help
 *   quit                        - Disconnect and exit
 */

import { io } from "socket.io-client";
import * as readline from "readline";

const SERVER = process.argv[2] || "http://localhost:3000";
const BOT_NAME = "TestBot";
const BOT_USER_ID = `bot-manual-${Date.now()}`;

let socket = null;
let currentRoom = null;
let myId = null;
let myUserId = null;
let characters = [];
let availableRooms = [];
let coins = 0;

function connect() {
  console.log(`\nConnecting to ${SERVER}...`);

  socket = io(SERVER, {
    transports: ["websocket"],
    autoConnect: true,
  });

  socket.on("connect", () => {
    console.log(`Connected with socket ID: ${socket.id}`);
  });

  socket.on("welcome", (data) => {
    availableRooms = data.rooms || [];
    console.log(`Welcome received. ${availableRooms.length} rooms available.`);

    if (availableRooms.length > 0) {
      const roomId = availableRooms[0].id;
      console.log(`Joining room: ${availableRooms[0].name} (${roomId})`);
      socket.emit("joinRoom", roomId, {
        avatarUrl: "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
        isBot: true,
        name: BOT_NAME,
        userId: BOT_USER_ID,
      });
    }
  });

  socket.on("roomJoined", (data) => {
    myId = data.id;
    myUserId = data.userId || BOT_USER_ID;
    currentRoom = data.roomId;
    characters = data.characters || [];
    coins = data.coins ?? 100;
    console.log(`\nJoined room: ${currentRoom}`);
    console.log(`My socket ID: ${myId}`);
    console.log(`My user ID: ${myUserId}`);
    console.log(`My coins: ${coins}`);
    console.log(`${characters.length} characters in room`);
    console.log("\nType 'help' for commands, or 'list' to see users.\n");
  });

  socket.on("characters", (data) => {
    characters = data;
  });

  socket.on("playerJoin", (char) => {
    characters.push(char);
    console.log(`\n[+] ${char.name} joined (socket: ${char.id}, userId: ${char.userId || "N/A"})`);
  });

  socket.on("playerLeave", (id) => {
    const char = characters.find(c => c.id === id);
    if (char) {
      console.log(`\n[-] ${char.name} left`);
      characters = characters.filter(c => c.id !== id);
    }
  });

  socket.on("coinsTransferSuccess", (data) => {
    coins = data.balance;
    console.log(`\n[Coins] Transfer successful! Sent ${data.amount} to ${data.toName}. Balance: ${coins}`);
  });

  socket.on("coinsTransferError", (data) => {
    console.log(`\n[Coins] Transfer failed: ${data.error}`);
  });

  socket.on("coinsTransferReceived", (data) => {
    coins = data.balance;
    console.log(`\n[Coins] Received ${data.amount} from ${data.fromName}. Balance: ${coins}`);
  });

  socket.on("coinsUpdate", (data) => {
    coins = data.coins;
  });

  socket.on("roomInvite", (data) => {
    console.log(`\n[Invite] Received invite from ${data.fromName} to room ${data.roomName}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`\nDisconnected: ${reason}`);
  });

  socket.on("connect_error", (err) => {
    console.log(`\nConnection error: ${err.message}`);
  });
}

function listUsers() {
  console.log(`\nUsers in room (${characters.length}):`);
  console.log("─".repeat(70));
  for (const char of characters) {
    const isMe = char.id === myId ? " (YOU)" : "";
    const isBot = char.isBot ? " [BOT]" : "";
    console.log(`  ${char.name}${isBot}${isMe}`);
    console.log(`    Socket ID: ${char.id}`);
    console.log(`    User ID:   ${char.userId || "N/A"}`);
  }
  console.log("─".repeat(70));
}

function transferCoins(targetUserId, amount) {
  if (!socket || !socket.connected) {
    console.log("Not connected!");
    return;
  }
  console.log(`Transferring ${amount} coins to user ${targetUserId}...`);
  socket.emit("coins:transfer", { toUserId: targetUserId, amount: parseInt(amount, 10) });
}

function inviteUser(targetSocketId) {
  if (!socket || !socket.connected) {
    console.log("Not connected!");
    return;
  }
  console.log(`Sending room invite to ${targetSocketId}...`);
  socket.emit("inviteToRoom", targetSocketId, (result) => {
    if (result.success) {
      console.log("Invite sent successfully!");
    } else {
      console.log(`Invite failed: ${result.error}`);
    }
  });
}

function switchRoom(roomId) {
  if (!socket || !socket.connected) {
    console.log("Not connected!");
    return;
  }
  console.log(`Switching to room ${roomId}...`);
  socket.emit("switchRoom", roomId);
}

function listRooms() {
  console.log(`\nAvailable rooms (${availableRooms.length}):`);
  for (const room of availableRooms) {
    const isCurrent = room.id === currentRoom ? " (CURRENT)" : "";
    console.log(`  ${room.name}${isCurrent}`);
    console.log(`    ID: ${room.id}`);
  }
}

function showStatus() {
  console.log(`\nBot Status:`);
  console.log(`  Name: ${BOT_NAME}`);
  console.log(`  Socket ID: ${myId || "Not connected"}`);
  console.log(`  User ID: ${myUserId || "Not assigned"}`);
  console.log(`  Room: ${currentRoom || "None"}`);
  console.log(`  Coins: ${coins}`);
  console.log(`  Connected: ${socket?.connected || false}`);
}

function showHelp() {
  console.log(`
Commands:
  transfer <userId> <amount>  - Send coins to a user by their USER ID
  invite <socketId>           - Invite a user to your room by SOCKET ID
  list                        - List all users in current room (shows both IDs)
  switch <roomId>             - Switch to a different room
  rooms                       - List available rooms
  status                      - Show bot status and balance
  help                        - Show this help
  quit                        - Disconnect and exit

Notes:
  - Use 'list' to see socket IDs and user IDs of players
  - 'transfer' uses USER ID (persistent across sessions)
  - 'invite' uses SOCKET ID (changes each connection)
`);
}

// Start the bot and CLI
connect();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case "transfer":
      if (parts.length < 3) {
        console.log("Usage: transfer <userId> <amount>");
      } else {
        transferCoins(parts[1], parts[2]);
      }
      break;

    case "invite":
      if (parts.length < 2) {
        console.log("Usage: invite <socketId>");
      } else {
        inviteUser(parts[1]);
      }
      break;

    case "list":
      listUsers();
      break;

    case "switch":
      if (parts.length < 2) {
        console.log("Usage: switch <roomId>");
      } else {
        switchRoom(parts[1]);
      }
      break;

    case "rooms":
      listRooms();
      break;

    case "status":
      showStatus();
      break;

    case "help":
      showHelp();
      break;

    case "quit":
    case "exit":
      console.log("Disconnecting...");
      socket?.disconnect();
      rl.close();
      process.exit(0);
      break;

    default:
      if (cmd) {
        console.log(`Unknown command: ${cmd}. Type 'help' for commands.`);
      }
  }
});

rl.on("close", () => {
  socket?.disconnect();
  process.exit(0);
});
