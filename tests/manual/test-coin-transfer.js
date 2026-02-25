/**
 * Integration test: Coin transfer functionality
 *
 * Tests the complete coin transfer lifecycle including:
 * - Two users sending coins to each other
 * - Sending coins to offline users
 * - Bot sending coins to users
 *
 * Usage:
 *   node test-coin-transfer.js [serverUrl]
 *   (default serverUrl: http://localhost:3000)
 */

import { io } from "socket.io-client";

const SERVER = process.argv[2] || "http://localhost:3000";
let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    errors.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function createClient(name, isBot = false) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      transports: ["websocket"],
      autoConnect: true,
    });
    const userId = `test-user-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      client.serverUserId = data.userId; // Server may assign/confirm userId
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

function transferCoins(client, toUserId, amount) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: "Transfer timeout" }), 5000);

    const onSuccess = (data) => {
      clearTimeout(timeout);
      client.socket.off("coinsTransferError", onError);
      resolve({ success: true, ...data });
    };

    const onError = (data) => {
      clearTimeout(timeout);
      client.socket.off("coinsTransferSuccess", onSuccess);
      resolve({ success: false, ...data });
    };

    client.socket.once("coinsTransferSuccess", onSuccess);
    client.socket.once("coinsTransferError", onError);
    client.socket.emit("coins:transfer", { toUserId, amount });
  });
}

function waitForCoinsReceived(client, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    client.socket.once("coinsTransferReceived", (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

async function runTests() {
  console.log(`\nCoin Transfer Tests - Server: ${SERVER}\n`);

  // ─────────────────────────────────────────────────────────────
  // Test 1: Basic transfer between two online users
  // ─────────────────────────────────────────────────────────────
  console.log("Test 1: Basic transfer between two online users");
  try {
    const userA = await createClient("UserA");
    const userB = await createClient("UserB");

    const roomId = userA.rooms[0]?.id;
    assert(!!roomId, "Server has at least one room");

    await joinRoom(userA, roomId);
    await joinRoom(userB, roomId);

    // Set up listener for UserB before transfer
    const receivePromise = waitForCoinsReceived(userB);

    // UserA sends coins to UserB
    const result = await transferCoins(userA, userB.serverUserId || userB.userId, 10);
    assert(result.success, "Transfer succeeds");
    assert(result.amount === 10, "Transfer amount is correct");

    // Verify UserB received the event
    const received = await receivePromise;
    assert(received !== null, "UserB receives coinsTransferReceived event");
    assert(received?.amount === 10, "Received amount is correct");
    assert(received?.fromName === "UserA", "Sender name is correct");

    userA.socket.disconnect();
    userB.socket.disconnect();
  } catch (err) {
    console.log(`  ✗ Test 1 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Test 2: Cannot transfer to yourself
  // ─────────────────────────────────────────────────────────────
  console.log("\nTest 2: Cannot transfer to yourself");
  try {
    const user = await createClient("SelfSender");
    const roomId = user.rooms[0]?.id;
    await joinRoom(user, roomId);

    const result = await transferCoins(user, user.serverUserId || user.userId, 10);
    assert(!result.success, "Self-transfer is rejected");
    assert(result.error?.includes("yourself"), "Error mentions self-transfer");

    user.socket.disconnect();
  } catch (err) {
    console.log(`  ✗ Test 2 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Test 3: Cannot transfer invalid amount
  // ─────────────────────────────────────────────────────────────
  console.log("\nTest 3: Cannot transfer invalid amounts");
  try {
    const userA = await createClient("Sender");
    const userB = await createClient("Receiver");
    const roomId = userA.rooms[0]?.id;
    await joinRoom(userA, roomId);
    await joinRoom(userB, roomId);

    // Zero amount
    let result = await transferCoins(userA, userB.serverUserId || userB.userId, 0);
    assert(!result.success, "Zero amount is rejected");

    // Negative amount
    result = await transferCoins(userA, userB.serverUserId || userB.userId, -10);
    assert(!result.success, "Negative amount is rejected");

    // Exceeds max (10000)
    result = await transferCoins(userA, userB.serverUserId || userB.userId, 99999);
    assert(!result.success, "Amount exceeding max is rejected");

    userA.socket.disconnect();
    userB.socket.disconnect();
  } catch (err) {
    console.log(`  ✗ Test 3 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Test 4: Cannot transfer to non-existent user
  // ─────────────────────────────────────────────────────────────
  console.log("\nTest 4: Cannot transfer to non-existent user");
  try {
    const user = await createClient("Sender2");
    const roomId = user.rooms[0]?.id;
    await joinRoom(user, roomId);

    const result = await transferCoins(user, "fake-user-id-that-does-not-exist", 10);
    assert(!result.success, "Transfer to non-existent user is rejected");
    assert(result.error?.includes("not found"), "Error mentions user not found");

    user.socket.disconnect();
  } catch (err) {
    console.log(`  ✗ Test 4 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Test 5: Bot can send coins to user
  // ─────────────────────────────────────────────────────────────
  console.log("\nTest 5: Bot can send coins to user");
  try {
    const bot = await createClient("TestBot", true);
    const user = await createClient("HumanUser");
    const roomId = bot.rooms[0]?.id;

    await joinRoom(bot, roomId);
    await joinRoom(user, roomId);

    const receivePromise = waitForCoinsReceived(user);

    const result = await transferCoins(bot, user.serverUserId || user.userId, 25);
    assert(result.success, "Bot transfer succeeds");

    const received = await receivePromise;
    assert(received !== null, "User receives coins from bot");
    assert(received?.fromIsBot === true, "fromIsBot is true");
    assert(received?.amount === 25, "Amount is correct");

    bot.socket.disconnect();
    user.socket.disconnect();
  } catch (err) {
    console.log(`  ✗ Test 5 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Test 6: Transfer to offline user (stored in DB)
  // ─────────────────────────────────────────────────────────────
  console.log("\nTest 6: Transfer to offline user");
  try {
    // First, create a user and get their ID
    const offlineUser = await createClient("OfflineUser");
    const roomId = offlineUser.rooms[0]?.id;
    await joinRoom(offlineUser, roomId);
    const offlineUserId = offlineUser.serverUserId || offlineUser.userId;

    // Disconnect the offline user
    offlineUser.socket.disconnect();
    await new Promise(r => setTimeout(r, 500)); // Wait for disconnect to process

    // Now send coins from another user
    const sender = await createClient("OnlineSender");
    await joinRoom(sender, roomId);

    const result = await transferCoins(sender, offlineUserId, 15);
    assert(result.success, "Transfer to offline user succeeds");
    assert(result.amount === 15, "Transfer amount is correct");

    sender.socket.disconnect();

    // Note: To fully verify, the offline user would need to reconnect
    // and check their balance. This test confirms the transfer doesn't error.
    console.log("  (Note: Full offline verification requires reconnect check)");
  } catch (err) {
    console.log(`  ✗ Test 6 error: ${err.message}`);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────");
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
