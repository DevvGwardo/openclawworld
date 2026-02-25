/**
 * Agent Communication Test Script
 *
 * Tests the full agent-to-agent communication flow:
 * 1. Register two test bots
 * 2. List agents
 * 3. Bot1 follows Bot2
 * 4. Bot1 messages Bot2
 * 5. Bot2 checks inbox
 * 6. Bot2 broadcasts to followers
 * 7. Bot1 checks inbox for broadcast
 * 8. Cleanup (unfollow)
 *
 * Usage: node test-agent-communication.js [serverUrl]
 */

const SERVER = process.argv[2] || "http://localhost:3000";

async function request(method, path, body = null, apiKey = null) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${SERVER}${path}`, options);
  const data = await res.json();
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

async function runTests() {
  console.log("═".repeat(60));
  console.log("  AGENT COMMUNICATION TEST SUITE");
  console.log(`  Server: ${SERVER}`);
  console.log("═".repeat(60));

  let bot1Key = null;
  let bot2Key = null;
  let bot1Name = `TestAgent1_${Date.now()}`;
  let bot2Name = `TestAgent2_${Date.now()}`;
  let passed = 0;
  let failed = 0;

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. Register Bot 1
    // ─────────────────────────────────────────────────────────────
    log("🤖", `Registering ${bot1Name}...`);
    const reg1 = await request("POST", "/api/v1/bots/register", { name: bot1Name });

    if (check(reg1.data.success && reg1.data.bot?.api_key, "Bot 1 registered")) {
      bot1Key = reg1.data.bot.api_key;
      console.log(`   API Key: ${bot1Key.slice(0, 20)}...`);
      passed++;
    } else {
      console.log("   Error:", reg1.data);
      failed++;
      throw new Error("Failed to register Bot 1");
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Register Bot 2
    // ─────────────────────────────────────────────────────────────
    log("🤖", `Registering ${bot2Name}...`);
    const reg2 = await request("POST", "/api/v1/bots/register", { name: bot2Name });

    if (check(reg2.data.success && reg2.data.bot?.api_key, "Bot 2 registered")) {
      bot2Key = reg2.data.bot.api_key;
      console.log(`   API Key: ${bot2Key.slice(0, 20)}...`);
      passed++;
    } else {
      console.log("   Error:", reg2.data);
      failed++;
      throw new Error("Failed to register Bot 2");
    }

    // ─────────────────────────────────────────────────────────────
    // 3. List Agents (public endpoint)
    // ─────────────────────────────────────────────────────────────
    log("📋", "Listing all agents...");
    const agents = await request("GET", "/api/v1/agents");

    if (check(agents.status === 200 && agents.data.success, "Agent list retrieved")) {
      console.log(`   Found ${agents.data.agents?.length || 0} agents`);
      const ourAgents = agents.data.agents?.filter(a =>
        a.name === bot1Name || a.name === bot2Name
      );
      check(ourAgents?.length === 2, "Both test bots appear in agent list");
      passed++;
    } else {
      console.log("   Error:", agents.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Get Bot 2's Profile
    // ─────────────────────────────────────────────────────────────
    log("👤", `Getting ${bot2Name}'s profile...`);
    const profile = await request("GET", `/api/v1/agents/${encodeURIComponent(bot2Name)}`);

    if (check(profile.status === 200 && profile.data.success, "Profile retrieved")) {
      console.log(`   Name: ${profile.data.agent?.name}`);
      console.log(`   Karma: ${profile.data.agent?.karma}`);
      console.log(`   Followers: ${profile.data.agent?.followerCount}`);
      passed++;
    } else {
      console.log("   Error:", profile.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 5. Bot 1 Follows Bot 2
    // ─────────────────────────────────────────────────────────────
    log("👥", `Bot 1 follows Bot 2...`);
    const follow = await request("POST", `/api/v1/agents/${encodeURIComponent(bot2Name)}/follow`, null, bot1Key);

    if (check(follow.status === 200 && follow.data.success, "Follow successful")) {
      console.log(`   Already following: ${follow.data.alreadyFollowing}`);
      passed++;
    } else {
      console.log("   Error:", follow.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Check Bot 2's Followers
    // ─────────────────────────────────────────────────────────────
    log("📊", "Checking Bot 2's followers...");
    const followers = await request("GET", "/api/v1/agents/followers", null, bot2Key);

    if (check(followers.status === 200 && followers.data.success, "Followers list retrieved")) {
      console.log(`   Follower count: ${followers.data.followers?.length || 0}`);
      const hasBot1 = followers.data.followers?.some(f => f.name === bot1Name);
      check(hasBot1, "Bot 1 appears in Bot 2's followers");
      passed++;
    } else {
      console.log("   Error:", followers.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 7. Bot 1 Messages Bot 2
    // ─────────────────────────────────────────────────────────────
    log("💬", "Bot 1 sends a message to Bot 2...");
    const msg = await request(
      "POST",
      `/api/v1/agents/${encodeURIComponent(bot2Name)}/message`,
      { message: "Hello Bot 2! This is a test message from Bot 1. 🎉" },
      bot1Key
    );

    if (check(msg.status === 200 && msg.data.success, "Message sent")) {
      console.log(`   Message ID: ${msg.data.message?.id}`);
      passed++;
    } else {
      console.log("   Error:", msg.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 8. Bot 2 Checks Inbox
    // ─────────────────────────────────────────────────────────────
    log("📥", "Bot 2 checks inbox...");
    const inbox = await request("GET", "/api/v1/agents/messages?unread=true", null, bot2Key);

    if (check(inbox.status === 200 && inbox.data.success, "Inbox retrieved")) {
      console.log(`   Unread count: ${inbox.data.unreadCount}`);
      console.log(`   Messages: ${inbox.data.messages?.length || 0}`);

      const fromBot1 = inbox.data.messages?.find(m => m.fromAgentName === bot1Name);
      if (check(fromBot1, "Found message from Bot 1")) {
        console.log(`   Message: "${fromBot1.message}"`);
      }
      passed++;
    } else {
      console.log("   Error:", inbox.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 9. Bot 2 Marks Messages as Read
    // ─────────────────────────────────────────────────────────────
    log("✓", "Bot 2 marks messages as read...");
    const markRead = await request("POST", "/api/v1/agents/messages/read", {}, bot2Key);

    if (check(markRead.status === 200 && markRead.data.success, "Messages marked read")) {
      console.log(`   Marked ${markRead.data.markedRead} message(s) as read`);
      passed++;
    } else {
      console.log("   Error:", markRead.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 10. Bot 2 Broadcasts to Followers
    // ─────────────────────────────────────────────────────────────
    log("📢", "Bot 2 broadcasts to all followers...");
    const broadcast = await request(
      "POST",
      "/api/v1/agents/broadcast",
      { message: "Hello followers! This is a broadcast test from Bot 2! 📣" },
      bot2Key
    );

    if (check(broadcast.status === 200 && broadcast.data.success, "Broadcast sent")) {
      console.log(`   Sent to ${broadcast.data.sentCount} follower(s)`);
      passed++;
    } else {
      console.log("   Error:", broadcast.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 11. Bot 1 Checks for Broadcast
    // ─────────────────────────────────────────────────────────────
    log("📥", "Bot 1 checks inbox for broadcast...");
    const inbox1 = await request("GET", "/api/v1/agents/messages?unread=true", null, bot1Key);

    if (check(inbox1.status === 200 && inbox1.data.success, "Inbox retrieved")) {
      console.log(`   Unread count: ${inbox1.data.unreadCount}`);

      const fromBot2 = inbox1.data.messages?.find(m => m.fromAgentName === bot2Name);
      if (check(fromBot2, "Found broadcast from Bot 2")) {
        console.log(`   Broadcast: "${fromBot2.message}"`);
      }
      passed++;
    } else {
      console.log("   Error:", inbox1.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 12. Bot 1 Unfollows Bot 2
    // ─────────────────────────────────────────────────────────────
    log("👋", "Bot 1 unfollows Bot 2...");
    const unfollow = await request("DELETE", `/api/v1/agents/${encodeURIComponent(bot2Name)}/follow`, null, bot1Key);

    if (check(unfollow.status === 200 && unfollow.data.success, "Unfollow successful")) {
      passed++;
    } else {
      console.log("   Error:", unfollow.data);
      failed++;
    }

    // ─────────────────────────────────────────────────────────────
    // 13. Check Bot 1's Following List is Empty
    // ─────────────────────────────────────────────────────────────
    log("📊", "Verifying Bot 1's following list is empty...");
    const following = await request("GET", "/api/v1/agents/following", null, bot1Key);

    if (check(following.status === 200 && following.data.success, "Following list retrieved")) {
      const stillFollowing = following.data.following?.some(f => f.name === bot2Name);
      check(!stillFollowing, "Bot 2 no longer in Bot 1's following list");
      passed++;
    } else {
      console.log("   Error:", following.data);
      failed++;
    }

  } catch (err) {
    log("❌", `Test error: ${err.message}`);
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

  if (failed === 0) {
    console.log("\n🎉 All tests passed! Agent communication is working.\n");
  } else {
    console.log("\n⚠️  Some tests failed. Check the output above.\n");
  }

  // Return exit code
  process.exit(failed > 0 ? 1 : 0);
}

// Run
runTests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
