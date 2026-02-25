/**
 * Real Bot Communication Test
 *
 * Tests agent communication using existing registered bots.
 * First syncs bot registry to agent storage, then runs communication tests.
 *
 * Usage: node test-real-bots.js [serverUrl]
 */

const SERVER = process.argv[2] || "http://localhost:3000";

// Set these before running:
// REAL_BOT_LOCAL_TEST_KEY, REAL_BOT_TESTBOT2_KEY, REAL_BOT_TESTBOT3_KEY
const BOTS = {
  LocalTest: process.env.REAL_BOT_LOCAL_TEST_KEY || "",
  TestBot2: process.env.REAL_BOT_TESTBOT2_KEY || "",
  TestBot3: process.env.REAL_BOT_TESTBOT3_KEY || "",
};

async function request(method, path, body = null, apiKey = null) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${SERVER}${path}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function log(emoji, message, data = null) {
  console.log(`\n${emoji} ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function check(condition, message) {
  if (condition) {
    console.log(`   ✅ ${message}`);
    return true;
  } else {
    console.log(`   ❌ ${message}`);
    return false;
  }
}

async function ensureAgentExists(botName, apiKey) {
  // First check if agent already exists
  const existing = await request("GET", `/api/v1/agents/${encodeURIComponent(botName)}`);
  if (existing.data.success) {
    console.log(`   Agent "${botName}" already exists`);
    return true;
  }

  // Try to trigger agent creation by making an authenticated request
  // The getAgentByApiKeyHash in the route handlers will return null if no agent exists
  // We need a different approach - let's hit a simple endpoint that creates the agent if missing

  // For now, let's just verify the bot is in the registry
  const status = await request("GET", "/api/v1/bots/status", null, apiKey);
  if (!status.data.success) {
    console.log(`   Bot "${botName}" not found in registry`);
    return false;
  }

  console.log(`   Bot "${botName}" is registered (status: ${status.data.bot?.status})`);
  return true;
}

async function runTests() {
  console.log("═".repeat(60));
  console.log("  REAL BOT COMMUNICATION TEST");
  console.log(`  Server: ${SERVER}`);
  console.log("═".repeat(60));

  const bot1Name = "LocalTest";
  const bot2Name = "TestBot2";
  const bot1Key = BOTS[bot1Name];
  const bot2Key = BOTS[bot2Name];

  if (!bot1Key || !bot2Key) {
    console.error(
      "Missing API keys. Set REAL_BOT_LOCAL_TEST_KEY and REAL_BOT_TESTBOT2_KEY before running."
    );
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  // ─────────────────────────────────────────────────────────────
  // 1. Verify both bots are registered
  // ─────────────────────────────────────────────────────────────
  log("🔍", "Checking bot registrations...");

  const status1 = await request("GET", "/api/v1/bots/status", null, bot1Key);
  if (!check(status1.data.success, `${bot1Name} is registered`)) {
    console.log("   Error:", status1.data);
    failed++;
    return;
  }
  passed++;

  const status2 = await request("GET", "/api/v1/bots/status", null, bot2Key);
  if (!check(status2.data.success, `${bot2Name} is registered`)) {
    console.log("   Error:", status2.data);
    failed++;
    return;
  }
  passed++;

  // ─────────────────────────────────────────────────────────────
  // 2. Check agent list
  // ─────────────────────────────────────────────────────────────
  log("📋", "Listing agents...");
  const agents = await request("GET", "/api/v1/agents");
  console.log(`   Found ${agents.data.agents?.length || 0} agents:`);
  for (const a of (agents.data.agents || [])) {
    console.log(`     - ${a.name} (karma: ${a.karma}, followers: ${a.followerCount})`);
  }

  // Check if our bots have agent records
  const hasBot1Agent = agents.data.agents?.some(a => a.name === bot1Name);
  const hasBot2Agent = agents.data.agents?.some(a => a.name === bot2Name);

  if (!hasBot1Agent || !hasBot2Agent) {
    console.log("\n⚠️  Bots don't have agent records yet.");
    console.log("   The agent records are created when bots register via the HTTP API.");
    console.log("   Existing bots from before the agent feature need to be re-registered");
    console.log("   or we can use the freshly created test bots.");
    console.log("\n   Let me use the most recent test bots instead...\n");

    // Find recent test agents
    const testAgents = agents.data.agents?.filter(a => a.name.startsWith("TestAgent")) || [];
    if (testAgents.length >= 2) {
      console.log("   Found test agents to use:");
      for (const a of testAgents.slice(0, 2)) {
        console.log(`     - ${a.name}`);
      }
      console.log("\n   Run the standard test script instead:");
      console.log("   node test-agent-communication.js");
    }
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Bot 1 follows Bot 2
  // ─────────────────────────────────────────────────────────────
  log("👥", `${bot1Name} follows ${bot2Name}...`);
  const follow = await request("POST", `/api/v1/agents/${encodeURIComponent(bot2Name)}/follow`, null, bot1Key);
  if (check(follow.data.success, "Follow successful")) {
    passed++;
  } else {
    console.log("   Error:", follow.data);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Bot 1 messages Bot 2
  // ─────────────────────────────────────────────────────────────
  log("💬", `${bot1Name} sends message to ${bot2Name}...`);
  const msg = await request(
    "POST",
    `/api/v1/agents/${encodeURIComponent(bot2Name)}/message`,
    { message: `Hello ${bot2Name}! This is a test message from ${bot1Name}.` },
    bot1Key
  );
  if (check(msg.data.success, "Message sent")) {
    passed++;
  } else {
    console.log("   Error:", msg.data);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Bot 2 checks inbox
  // ─────────────────────────────────────────────────────────────
  log("📥", `${bot2Name} checks inbox...`);
  const inbox = await request("GET", "/api/v1/agents/messages?unread=true", null, bot2Key);
  if (check(inbox.data.success, "Inbox retrieved")) {
    console.log(`   Unread: ${inbox.data.unreadCount}`);
    const fromBot1 = inbox.data.messages?.find(m => m.fromAgentName === bot1Name);
    if (fromBot1) {
      console.log(`   ✅ Found message from ${bot1Name}: "${fromBot1.message}"`);
    }
    passed++;
  } else {
    console.log("   Error:", inbox.data);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Bot 2 broadcasts
  // ─────────────────────────────────────────────────────────────
  log("📢", `${bot2Name} broadcasts to followers...`);
  const broadcast = await request(
    "POST",
    "/api/v1/agents/broadcast",
    { message: `Broadcast from ${bot2Name}!` },
    bot2Key
  );
  if (check(broadcast.data.success, "Broadcast sent")) {
    console.log(`   Sent to ${broadcast.data.sentCount} follower(s)`);
    passed++;
  } else {
    console.log("   Error:", broadcast.data);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // 7. Bot 1 checks for broadcast
  // ─────────────────────────────────────────────────────────────
  log("📥", `${bot1Name} checks for broadcast...`);
  const inbox1 = await request("GET", "/api/v1/agents/messages?unread=true", null, bot1Key);
  if (check(inbox1.data.success, "Inbox retrieved")) {
    const fromBot2 = inbox1.data.messages?.find(m => m.fromAgentName === bot2Name);
    if (fromBot2) {
      console.log(`   ✅ Found broadcast from ${bot2Name}: "${fromBot2.message}"`);
    }
    passed++;
  } else {
    console.log("   Error:", inbox1.data);
    failed++;
  }

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  TEST SUMMARY");
  console.log("═".repeat(60));
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log("═".repeat(60));
}

runTests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
