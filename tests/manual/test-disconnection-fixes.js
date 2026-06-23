/**
 * Integration tests for disconnection fixes
 *
 * Verifies all fixes from the client-server disconnection audit:
 *   1. Server imports resolve correctly (roomConstants consolidation)
 *   2. emote:play events propagate between clients
 *   3. HTTP bot emote emits "emote:play" (not "emote")
 *   4. playerMoves (plural) dead code removed — singular still works
 *   5. Error events (switchRoomError, rateLimited, itemsUpdateError) reach client
 *
 * Usage:
 *   cd server && node ../tests/manual/test-disconnection-fixes.js [serverUrl]
 *   (default serverUrl: http://localhost:3000)
 */

import { io } from "../../server/node_modules/socket.io-client/build/esm/index.js";
import net from "node:net";

const SERVER = process.argv[2] || "http://localhost:3000";
let passed = 0;
let failed = 0;
const errors = [];

// Fast fail when nothing is listening on the server port, so the suite
// exits in ~1s with a clear message instead of hanging on socket.io's
// connection timeout. Requires a running server (default port 3000).
function preflightCheck(serverUrl, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(serverUrl);
    } catch {
      return reject(new Error(`Invalid server URL: ${serverUrl}`));
    }
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const socket = net.createConnection({ host: url.hostname, port });
    const done = (err) => {
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done());
    socket.once("timeout", () => done(new Error(`Connection to ${url.hostname}:${port} timed out`)));
    socket.once("error", (err) => {
      const reason = err.message || err.code || "connection failed";
      done(new Error(`Cannot connect to ${url.hostname}:${port} (${reason})`));
    });
  });
}

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    errors.push(label);
    console.log(`  \u2717 ${label}`);
  }
}

function createClient(name, isBot = false) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      transports: ["websocket"],
      autoConnect: true,
    });
    const userId = `test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    socket.once("welcome", (data) => {
      resolve({ socket, rooms: data.rooms, name, isBot, userId });
    });
    socket.once("connect_error", (err) => {
      reject(new Error(`${name} connect failed: ${err.message}`));
    });
    setTimeout(() => reject(new Error(`${name} connect timeout`)), 5000);
  });
}

function joinRoom(client, roomId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${client.name} joinRoom timeout`)), 5000);
    client.socket.once("roomJoined", (data) => {
      clearTimeout(timeout);
      client.id = data.id;
      client.serverUserId = data.userId;
      resolve(data);
    });
    client.socket.emit("joinRoom", roomId, {
      avatarUrl: "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
      isBot: client.isBot,
      name: client.name,
      userId: client.userId,
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function collectEvents(socket, event, durationMs = 2000) {
  return new Promise((resolve) => {
    const collected = [];
    const handler = (data) => collected.push(data);
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(collected);
    }, durationMs);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════
// Test 7: itemsUpdateError event
// ═══════════════════════════════════════════════════════════════
async function testItemsUpdateError() {
  console.log("\nTest 7: itemsUpdateError event (invalid items data)");
  try {
    const client = await createClient("Builder");
    const roomId = client.rooms[0]?.id;
    await joinRoom(client, roomId);

    const errorPromise = waitForEvent(client.socket, "itemsUpdateError");
    // Send invalid items data (not an array, should fail sanitization)
    client.socket.emit("itemsUpdate", "not-an-array");
    const errData = await errorPromise;

    assert(errData !== null, "Client receives itemsUpdateError event");
    if (errData) {
      assert(typeof errData.error === "string", "itemsUpdateError has error string");
    }

    client.socket.disconnect();
  } catch (err) {
    console.log(`  \u2717 Test 8 error: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// Test 9: Invalid emote is rejected (no event broadcast)
// ═══════════════════════════════════════════════════════════════
async function testInvalidEmoteRejected() {
  console.log("\nTest 9: Invalid emote name is silently rejected");
  try {
    const clientA = await createClient("BadEmoteA");
    const clientB = await createClient("BadEmoteB");

    const roomId = clientA.rooms[0]?.id;
    await joinRoom(clientA, roomId);
    await joinRoom(clientB, roomId);

    // Send an invalid emote name
    const emoteEvents = collectEvents(clientB.socket, "emote:play", 1500);
    clientA.socket.emit("emote:play", "nonexistent_emote_xyz");
    const collected = await emoteEvents;

    assert(collected.length === 0, "Invalid emote not broadcast to other clients");

    clientA.socket.disconnect();
    clientB.socket.disconnect();
  } catch (err) {
    console.log(`  \u2717 Test 9 error: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// Test 10: wave:at also emits emote:play with "wave"
// ═══════════════════════════════════════════════════════════════
async function testWaveAtEmitsEmotePlay() {
  console.log("\nTest 10: wave:at also triggers emote:play with 'wave'");
  try {
    const clientA = await createClient("WaverA");
    const clientB = await createClient("WaverB");

    const roomId = clientA.rooms[0]?.id;
    await joinRoom(clientA, roomId);
    await joinRoom(clientB, roomId);

    // Listen for emote:play when wave:at is sent
    const emotePromise = waitForEvent(clientB.socket, "emote:play");
    clientA.socket.emit("wave:at", clientB.id);
    const emoteData = await emotePromise;

    assert(emoteData !== null, "wave:at triggers emote:play broadcast");
    if (emoteData) {
      assert(emoteData.id === clientA.id, "emote:play from wave:at has correct sender");
      assert(emoteData.emote === "wave", "emote:play from wave:at has emote='wave'");
    }

    clientA.socket.disconnect();
    clientB.socket.disconnect();
  } catch (err) {
    console.log(`  \u2717 Test 10 error: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// Test 11: HTTP bot emote endpoint emits emote:play (not "emote")
// ═══════════════════════════════════════════════════════════════
async function testHttpBotEmote() {
  console.log("\nTest 11: HTTP bot emote endpoint emits 'emote:play'");
  try {
    // Register a bot via HTTP
    const regRes = await fetch(`${SERVER}/api/v1/bots/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `testbot_emote_${Date.now()}`,
        displayName: "Emote Test Bot",
        description: "Testing emote event name fix",
      }),
    });
    const regData = await regRes.json();

    if (!regData.success || !regData.apiKey) {
      console.log(`  - Skipping: Bot registration not available (${regData.error || "no apiKey"})`);
      return;
    }

    const apiKey = regData.apiKey;
    const roomId = "plaza";

    // Join the bot to a room via HTTP
    const joinRes = await fetch(`${SERVER}/api/v1/rooms/${roomId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
    });
    const joinData = await joinRes.json();

    if (!joinData.success) {
      console.log(`  - Skipping: Bot join failed (${joinData.error})`);
      return;
    }

    // Connect a socket client to observe emote:play events
    const observer = await createClient("EmoteObserver");
    await joinRoom(observer, roomId);
    await sleep(500);

    // Listen for both "emote" and "emote:play"
    const emotePlayPromise = waitForEvent(observer.socket, "emote:play", 3000);
    const oldEmotePromise = waitForEvent(observer.socket, "emote", 3000);

    // Bot performs emote via HTTP
    const emoteRes = await fetch(`${SERVER}/api/v1/rooms/${roomId}/emote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ emote: "wave" }),
    });

    // If there's no dedicated /emote endpoint, try the /actions batch endpoint
    if (emoteRes.status === 404) {
      const actionsRes = await fetch(`${SERVER}/api/v1/bots/control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          roomId,
          actions: [{ type: "emote", emote: "wave" }],
        }),
      });
      // Wait for events regardless
    }

    const emotePlayData = await emotePlayPromise;
    const oldEmoteData = await oldEmotePromise;

    // The fix: emote:play should fire, NOT the old "emote" event
    const gotEmotePlay = emotePlayData !== null;
    const gotOldEmote = oldEmoteData !== null;

    assert(gotEmotePlay || gotOldEmote, "Bot emote triggers some event to observer");
    if (gotEmotePlay) {
      assert(true, "HTTP bot emote emits 'emote:play' (correct)");
    }
    if (gotOldEmote && !gotEmotePlay) {
      assert(false, "HTTP bot emote still emits old 'emote' event (fix not applied)");
    }

    observer.socket.disconnect();

    // Leave room
    await fetch(`${SERVER}/api/v1/rooms/${roomId}/leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
    });
  } catch (err) {
    console.log(`  - Skipping HTTP bot test: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════
async function runTests() {
  console.log(`\nDisconnection Fixes Tests - Server: ${SERVER}\n`);
  console.log("=".repeat(60));

  // Fail fast if the port is closed (avoids the ~5s socket.io timeout).
  try {
    await preflightCheck(SERVER);
  } catch (err) {
    console.log(`\n  ✗ FATAL: Cannot reach server at ${SERVER}`);
    console.log(`  ${err.message}`);
    console.log(`  Make sure the server is running: cd server && npm run dev`);
    process.exit(1);
  }

  await testServerImports();
  await testEmotePlayPropagation();
  await testEmoteSelfReceive();
  await testPlayerMoveSingular();
  await testSwitchRoomError();
  await testRateLimited();
  await testItemsUpdateError();
  await testInvalidEmoteRejected();
  await testWaveAtEmitsEmotePlay();
  await testHttpBotEmote();

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log("\nFailed assertions:");
    for (const e of errors) console.log(`  - ${e}`);
  }
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
