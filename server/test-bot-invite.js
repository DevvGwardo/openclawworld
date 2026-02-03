/**
 * Integration test: Bot invitation & owner interaction flow
 *
 * Tests the complete lifecycle of how bots connect and interact
 * with their owner/inviter. Requires a running server instance.
 *
 * Usage:
 *   node test-bot-invite.js [serverUrl]
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
    socket.once("welcome", (data) => {
      resolve({ socket, rooms: data.rooms, name, isBot });
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
      resolve(data);
    });
    client.socket.emit("joinRoom", roomId, {
      avatarUrl: "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
      isBot: client.isBot,
      name: client.name,
    });
  });
}

function switchRoom(client, roomId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${client.name} switchRoom timeout`)), 5000);
    client.socket.once("roomJoined", (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
    client.socket.emit("switchRoom", roomId);
  });
}

function inviteToRoom(client, targetId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${client.name} invite timeout`)), 5000);
    client.socket.emit("inviteToRoom", targetId, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Waiting for '${event}' timed out`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function sendDirectMessage(client, targetId, message) {
  client.socket.emit("directMessage", { targetId, message });
}

function sendChatMessage(client, message) {
  client.socket.emit("chatMessage", message);
}

async function cleanup(...clients) {
  for (const c of clients) {
    if (c?.socket?.connected) c.socket.disconnect();
  }
}

// ============================================================
// TEST SUITES
// ============================================================

async function testBasicInviteFlow() {
  console.log("\n--- Test 1: Basic invite flow (owner invites bot to room) ---");

  let owner, bot;
  try {
    owner = await createClient("TestOwner", false);
    bot = await createClient("TestBot", true);

    // Both need at least 2 rooms to test with
    assert(owner.rooms.length >= 2, "Server has at least 2 rooms available");

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    // Owner joins Room A, Bot joins Room B
    const ownerJoinData = await joinRoom(owner, roomA);
    assert(ownerJoinData.id != null, "Owner joined Room A with valid id");
    assert(ownerJoinData.invitedBy === null || ownerJoinData.invitedBy === undefined || ownerJoinData.invitedBy === null, "Owner has no invitedBy (joined normally)");

    const botJoinData = await joinRoom(bot, roomB);
    assert(botJoinData.id != null, "Bot joined Room B with valid id");
    assert(!botJoinData.invitedBy, "Bot has no invitedBy (joined normally)");

    // Owner invites bot to Room A
    const inviteResult = await inviteToRoom(owner, bot.id);
    assert(inviteResult.success === true, "Invite sent successfully");

    // Bot should receive roomInvite event
    // (We need to set up listener before invite for real usage, but invite is already sent)
    // Let's re-test with proper ordering

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testBasicInviteFlow: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testInviteWithRoomInviteEvent() {
  console.log("\n--- Test 2: Bot receives roomInvite event and invitedBy on join ---");

  let owner, bot;
  try {
    owner = await createClient("InviteOwner", false);
    bot = await createClient("InviteBot", true);

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    // Owner joins Room A
    await joinRoom(owner, roomA);

    // Bot joins Room B
    await joinRoom(bot, roomB);

    // Set up listener for roomInvite on bot BEFORE owner sends invite
    const invitePromise = waitForEvent(bot.socket, "roomInvite", 5000);

    // Owner invites bot to Room A
    const inviteResult = await inviteToRoom(owner, bot.id);
    assert(inviteResult.success === true, "Invite callback success");

    // Bot receives the roomInvite event
    const inviteData = await invitePromise;
    assert(inviteData.fromId === owner.id, "roomInvite.fromId matches owner's socket id");
    assert(inviteData.fromName === "InviteOwner", "roomInvite.fromName matches owner's name");
    assert(inviteData.fromIsBot === false, "roomInvite.fromIsBot is false (owner is not a bot)");
    assert(inviteData.roomId === roomA, "roomInvite.roomId matches target room");
    assert(inviteData.roomName != null, "roomInvite.roomName is present");
    assert(typeof inviteData.inviteId === "string", "roomInvite has inviteId string");
    assert(typeof inviteData.timestamp === "number", "roomInvite has timestamp");

    // Bot accepts invite by switching to Room A
    const switchData = await switchRoom(bot, roomA);
    assert(switchData.invitedBy != null, "Bot receives invitedBy after switching to invited room");
    assert(switchData.invitedBy.id === owner.id, "invitedBy.id matches owner");
    assert(switchData.invitedBy.name === "InviteOwner", "invitedBy.name matches owner");
    assert(switchData.invitedBy.isBot === false, "invitedBy.isBot is false");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInviteWithRoomInviteEvent: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testNoInviteJoinHasNullInvitedBy() {
  console.log("\n--- Test 3: Joining without invite has null invitedBy ---");

  let client;
  try {
    client = await createClient("NoInvitePlayer", false);
    const roomA = client.rooms[0].id;

    const joinData = await joinRoom(client, roomA);
    assert(joinData.invitedBy === null, "invitedBy is null when joining without invite");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testNoInviteJoinHasNullInvitedBy: ${err.message}`);
  } finally {
    await cleanup(client);
  }
}

async function testInviteSameRoomFails() {
  console.log("\n--- Test 4: Inviting someone already in the same room fails ---");

  let owner, bot;
  try {
    owner = await createClient("SameRoomOwner", false);
    bot = await createClient("SameRoomBot", true);

    const roomA = owner.rooms[0].id;

    await joinRoom(owner, roomA);
    await joinRoom(bot, roomA);

    const result = await inviteToRoom(owner, bot.id);
    assert(result.success === false, "Invite to same room returns success=false");
    assert(result.error === "Already in the same room", "Error message is 'Already in the same room'");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInviteSameRoomFails: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testInviteNonexistentPlayerFails() {
  console.log("\n--- Test 5: Inviting a nonexistent player fails ---");

  let owner;
  try {
    owner = await createClient("LoneOwner", false);
    const roomA = owner.rooms[0].id;
    await joinRoom(owner, roomA);

    const result = await inviteToRoom(owner, "fake-socket-id-12345");
    assert(result.success === false, "Invite to nonexistent player returns success=false");
    assert(result.error === "User not found or offline", "Error message is 'User not found or offline'");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInviteNonexistentPlayerFails: ${err.message}`);
  } finally {
    await cleanup(owner);
  }
}

async function testInviteOverwritesPrevious() {
  console.log("\n--- Test 6: Second invite overwrites previous pending invite ---");

  let owner1, owner2, bot;
  try {
    owner1 = await createClient("Owner1", false);
    owner2 = await createClient("Owner2", false);
    bot = await createClient("OverwriteBot", true);

    const roomA = owner1.rooms[0].id;
    const roomB = owner1.rooms[1].id;
    const roomC = owner1.rooms.length >= 3 ? owner1.rooms[2].id : null;

    // Bot in Room A, Owner1 in Room B, Owner2 in Room C (or Room B)
    await joinRoom(bot, roomA);
    await joinRoom(owner1, roomB);

    if (roomC) {
      await joinRoom(owner2, roomC);
    } else {
      // If only 2 rooms, Owner2 joins Room B too
      await joinRoom(owner2, roomB);
    }

    // Owner1 invites bot to Room B
    const result1 = await inviteToRoom(owner1, bot.id);
    assert(result1.success === true, "First invite (Owner1) succeeds");

    // Owner2 invites bot to their room (overwrites)
    const targetRoom = roomC || roomB;
    const result2 = await inviteToRoom(owner2, bot.id);
    assert(result2.success === true, "Second invite (Owner2) succeeds");

    // Bot switches to Owner2's room — should get Owner2 as invitedBy
    const switchData = await switchRoom(bot, targetRoom);
    assert(switchData.invitedBy != null, "Bot has invitedBy after switching");
    assert(switchData.invitedBy.name === "Owner2", "invitedBy is Owner2 (second invite overwrites first)");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInviteOverwritesPrevious: ${err.message}`);
  } finally {
    await cleanup(owner1, owner2, bot);
  }
}

async function testInvitedByClearedOnDifferentRoom() {
  console.log("\n--- Test 7: invitedBy cleared when switching to a non-invited room ---");

  let owner, bot;
  try {
    owner = await createClient("ClearOwner", false);
    bot = await createClient("ClearBot", true);

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    await joinRoom(owner, roomA);
    await joinRoom(bot, roomB);

    // Owner invites bot to Room A
    const result = await inviteToRoom(owner, bot.id);
    assert(result.success === true, "Invite sent");

    // Bot accepts — switches to Room A, gets invitedBy
    const switchData1 = await switchRoom(bot, roomA);
    assert(switchData1.invitedBy != null, "Bot has invitedBy after accepting invite");

    // Bot now switches to Room B (no invite for this room)
    const switchData2 = await switchRoom(bot, roomB);
    assert(switchData2.invitedBy === null, "invitedBy is null when switching to non-invited room");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInvitedByClearedOnDifferentRoom: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testDirectMessageBetweenPlayers() {
  console.log("\n--- Test 8: Direct messages (whispers) work between players ---");

  let owner, bot;
  try {
    owner = await createClient("DMOwner", false);
    bot = await createClient("DMBot", true);

    const roomA = owner.rooms[0].id;
    await joinRoom(owner, roomA);
    await joinRoom(bot, roomA);

    // Owner (non-bot) whispers bot — non-official bots can't DM per server rule
    const dmPromise = waitForEvent(bot.socket, "directMessage", 5000);

    sendDirectMessage(owner, bot.id, "Hey bot, welcome to the room!");

    const dmData = await dmPromise;
    assert(dmData.senderId === owner.id, "DM senderId matches owner's id");
    assert(dmData.senderName === "DMOwner", "DM senderName matches owner's name");
    assert(dmData.message === "Hey bot, welcome to the room!", "DM message content is correct");

    // Verify non-official bots get DM error
    const errorPromise = waitForEvent(bot.socket, "directMessageError", 3000).catch(() => null);
    sendDirectMessage(bot, owner.id, "Trying to DM as non-official bot");
    const errorData = await errorPromise;
    assert(errorData != null, "Non-official bot receives directMessageError when trying to DM");
    assert(errorData.error === "Bot is not authorized to send DMs", "Error message correct for unauthorized bot DM");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testDirectMessageBetweenPlayers: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testChatMessageBroadcast() {
  console.log("\n--- Test 9: Chat messages broadcast to room players ---");

  let owner, bot;
  try {
    owner = await createClient("ChatOwner", false);
    bot = await createClient("ChatBot", true);

    const roomA = owner.rooms[0].id;
    await joinRoom(owner, roomA);
    await joinRoom(bot, roomA);

    // Set up listener on bot for chat from owner
    const chatPromise = waitForEvent(bot.socket, "playerChatMessage", 5000);

    // Owner sends a chat message
    sendChatMessage(owner, "Hey bot, welcome to the room!");

    const chatData = await chatPromise;
    assert(chatData.id === owner.id, "Chat message id matches owner's id");
    assert(chatData.message === "Hey bot, welcome to the room!", "Chat message content is correct");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testChatMessageBroadcast: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testBotInvitesPlayer() {
  console.log("\n--- Test 10: Bot can also invite a player (reverse direction) ---");

  let owner, bot;
  try {
    owner = await createClient("ReverseOwner", false);
    bot = await createClient("ReverseBot", true);

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    await joinRoom(owner, roomA);
    await joinRoom(bot, roomB);

    // Set up listener on owner for roomInvite
    const invitePromise = waitForEvent(owner.socket, "roomInvite", 5000);

    // Bot invites owner to Room B
    const result = await inviteToRoom(bot, owner.id);
    assert(result.success === true, "Bot invite to owner succeeds");

    const inviteData = await invitePromise;
    assert(inviteData.fromId === bot.id, "roomInvite.fromId matches bot's id");
    assert(inviteData.fromName === "ReverseBot", "roomInvite.fromName matches bot's name");
    assert(inviteData.fromIsBot === true, "roomInvite.fromIsBot is true");

    // Owner accepts by switching to Room B
    const switchData = await switchRoom(owner, roomB);
    assert(switchData.invitedBy != null, "Owner has invitedBy after accepting bot's invite");
    assert(switchData.invitedBy.name === "ReverseBot", "invitedBy.name is the bot");
    assert(switchData.invitedBy.isBot === true, "invitedBy.isBot is true");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testBotInvitesPlayer: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testBotClientInvitedByField() {
  console.log("\n--- Test 11: BotClient stores invitedBy correctly on join and switchRoom ---");

  let owner, bot;
  try {
    owner = await createClient("FieldOwner", false);
    bot = await createClient("FieldBot", true);

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    await joinRoom(owner, roomA);

    // Bot joins Room B (no invite) — invitedBy should be null
    const joinData = await joinRoom(bot, roomB);
    assert(joinData.invitedBy === null, "Initial join without invite: invitedBy is null");

    // Owner invites bot to Room A
    await waitForEvent(bot.socket, "roomInvite", 5000).catch(() => {});
    // (race: set up listener then invite)
    const inviteListenerPromise = waitForEvent(bot.socket, "roomInvite", 5000);
    await inviteToRoom(owner, bot.id);
    await inviteListenerPromise.catch(() => {}); // just ensure it was received

    // Bot switches to Room A
    const switchData = await switchRoom(bot, roomA);
    assert(switchData.invitedBy != null, "After invite+switch: invitedBy is set");
    assert(switchData.invitedBy.id === owner.id, "invitedBy.id matches owner");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testBotClientInvitedByField: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

async function testPerceptionModuleSnapshot() {
  console.log("\n--- Test 12: PerceptionModule includes invitedBy and owner in snapshot ---");

  // This is a unit-style test of the PerceptionModule directly
  try {
    const { PerceptionModule } = await import("../bot/perception.js");

    // Create a mock botClient
    const mockBot = {
      id: "bot-123",
      name: "TestBot",
      position: [5, 5],
      characters: [
        { id: "bot-123", name: "TestBot", position: [5, 5], isBot: true },
        { id: "owner-456", name: "MyOwner", position: [6, 6], isBot: false },
      ],
      room: { size: [50, 50], gridDivision: 2, items: [], id: "room-1" },
      rooms: [],
      invitedBy: { id: "owner-456", name: "MyOwner", isBot: false },
    };

    const perception = new PerceptionModule(mockBot, { ownerName: "MyOwner" });

    const snap = perception.snapshot();
    assert(snap.invitedBy != null, "Snapshot includes invitedBy");
    assert(snap.invitedBy.id === "owner-456", "Snapshot invitedBy.id correct");
    assert(snap.invitedBy.name === "MyOwner", "Snapshot invitedBy.name correct");
    assert(snap.owner != null, "Snapshot includes owner (matched by name)");
    assert(snap.owner.name === "MyOwner", "Snapshot owner.name correct");

    // Test serialization
    const text = perception.serialize(snap);
    assert(text.includes("[Invited by]"), "Serialized output includes [Invited by] tag");
    assert(text.includes("MyOwner"), "Serialized output includes inviter name");
    assert(text.includes("greet them with a whisper"), "Serialized output includes greeting instruction");
    assert(text.includes("[Owner]"), "Serialized output includes [Owner] tag");
    assert(text.includes("pay special attention"), "Serialized output includes owner attention instruction");

    // Test clearInviter
    perception.clearInviter();
    assert(mockBot.invitedBy === null, "clearInviter() sets bot.invitedBy to null");

    const snap2 = perception.snapshot();
    assert(snap2.invitedBy === null, "After clearInviter, snapshot invitedBy is null");

    const text2 = perception.serialize(snap2);
    assert(!text2.includes("[Invited by]"), "After clearInviter, serialized output has no [Invited by] tag");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testPerceptionModuleSnapshot: ${err.message}`);
  }
}

async function testInviterLeavesBeforeBotJoins() {
  console.log("\n--- Test 13: Inviter disconnects before bot joins invited room ---");

  let owner, bot;
  try {
    owner = await createClient("GhostOwner", false);
    bot = await createClient("GhostBot", true);

    const roomA = owner.rooms[0].id;
    const roomB = owner.rooms[1].id;

    await joinRoom(owner, roomA);
    await joinRoom(bot, roomB);

    // Owner invites bot
    const invitePromise = waitForEvent(bot.socket, "roomInvite", 5000);
    await inviteToRoom(owner, bot.id);
    await invitePromise;

    // Owner disconnects before bot switches
    owner.socket.disconnect();
    await new Promise(r => setTimeout(r, 200)); // small delay for server cleanup

    // Bot switches to Room A (invited room) — should still have invitedBy data
    const switchData = await switchRoom(bot, roomA);
    // The pendingInvites entry was created when owner was connected,
    // so invitedBy should still be populated (points to now-offline owner)
    assert(switchData.invitedBy != null, "Bot still gets invitedBy even after inviter disconnected");
    assert(switchData.invitedBy.name === "GhostOwner", "invitedBy.name is the disconnected owner");

  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    failed++;
    errors.push(`testInviterLeavesBeforeBotJoins: ${err.message}`);
  } finally {
    await cleanup(owner, bot);
  }
}

// ============================================================
// RUN ALL TESTS
// ============================================================

async function main() {
  console.log(`\nBot Invitation & Owner Interaction Test Suite`);
  console.log(`Server: ${SERVER}`);
  console.log("=".repeat(55));

  try {
    // Verify server is reachable
    const probe = await createClient("Probe", false);
    assert(probe.rooms.length > 0, `Server reachable, ${probe.rooms.length} rooms available`);
    await cleanup(probe);
  } catch (err) {
    console.log(`\n  ✗ FATAL: Cannot connect to server at ${SERVER}`);
    console.log(`  ${err.message}`);
    console.log(`  Make sure the server is running: cd server && npm run dev`);
    process.exit(1);
  }

  await testBasicInviteFlow();
  await testInviteWithRoomInviteEvent();
  await testNoInviteJoinHasNullInvitedBy();
  await testInviteSameRoomFails();
  await testInviteNonexistentPlayerFails();
  await testInviteOverwritesPrevious();
  await testInvitedByClearedOnDifferentRoom();
  await testDirectMessageBetweenPlayers();
  await testChatMessageBroadcast();
  await testBotInvitesPlayer();
  await testBotClientInvitedByField();
  await testPerceptionModuleSnapshot();
  await testInviterLeavesBeforeBotJoins();

  console.log("\n" + "=".repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log(`\nFailed assertions:`);
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
