// Gateway Integration Test Script
// Usage: CLAWLAND_GATEWAY_URL=ws://... CLAWLAND_GATEWAY_TOKEN=... node gateway-test.js
//
// Exercises the full Gateway flow against a live Gateway:
//   1. Connect and authenticate via Ed25519 challenge handshake
//   2. Send a hardcoded agent prompt via invokeAgent
//   3. Log and validate the response
//   4. Test connection pooling and health monitoring features
//
// Requires a running Gateway instance.

import { GatewayClient } from "./GatewayClient.js";

const url = process.env.CLAWLAND_GATEWAY_URL;
const token = process.env.CLAWLAND_GATEWAY_TOKEN;

if (!url || !token) {
  console.error("Required env vars: CLAWLAND_GATEWAY_URL, CLAWLAND_GATEWAY_TOKEN");
  process.exit(1);
}

const gw = new GatewayClient({ 
  url, 
  token,
  maxPoolSize: 3,
  enableHealthCheck: true,
  healthCheckIntervalMs: 10000
});

// Log events for visibility
gw.on("connected", (hello) => {
  console.log("[Gateway] Connected! Payload:", JSON.stringify(hello ?? {}).slice(0, 200));
});
gw.on("reconnecting", ({ attempt, delay }) => {
  console.log(`[Gateway] Reconnecting (attempt ${attempt}, delay ${delay}ms)...`);
});
gw.on("disconnected", ({ code, reason }) => {
  console.log(`[Gateway] Disconnected (code ${code}, reason: ${reason || "none"})`);
});
gw.on("reconnectFailed", () => {
  console.error("[Gateway] Reconnect failed after max attempts");
});
gw.on("error", (err) => {
  console.error("[Gateway] Error:", err.message);
});

async function runTests() {
  try {
    // Test 1: Connect and authenticate
    console.log("--- Test 1: Connect and authenticate ---");
    console.log(`Connecting to ${url}...`);
    await gw.connect();
    console.log("PASS: Connected and authenticated via challenge handshake");

    // Display initial connection stats
    console.log("\n--- Connection Stats ---");
    console.log("Connection statistics:", gw.connectionStats);

    // Test 2: Send agent prompt and receive response
    console.log("\n--- Test 2: Agent RPC (hardcoded prompt) ---");
    const prompt =
      'You are a bot in a multiplayer game. You see a player nearby. ' +
      'Respond with a JSON object: {"action":"say","message":"Hello there!"}';
    console.log("Sending prompt...");
    const result = await gw.invokeAgent(prompt, { timeoutMs: 30000 });
    console.log("Agent response:", JSON.stringify(result, null, 2));
    console.log("PASS: Received agent response");

    // Test 3: Verify response is parseable (basic check)
    console.log("\n--- Test 3: Response validation ---");
    if (result && typeof result === "object") {
      console.log("PASS: Response is a valid object");
    } else {
      console.log("WARN: Response is not an object -- inspect manually");
    }

    // Test 4: Connection pooling test
    console.log("\n--- Test 4: Connection pooling ---");
    console.log("Running multiple concurrent requests...");
    const requests = Array.from({ length: 5 }, (_, i) => 
      gw.invokeAgent(`Test prompt ${i + 1}`, { timeoutMs: 10000 })
    );
    
    const results = await Promise.allSettled(requests);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Completed ${successful}/${requests.length} concurrent requests`);
    console.log("Connection stats after concurrent requests:", gw.connectionStats);

    // Test 5: Health metrics
    console.log("\n--- Test 5: Health metrics ---");
    const metrics = gw.getHealthMetrics();
    console.log("Health metrics:", {
      poolSize: metrics.poolSize,
      avgResponseTime: `${metrics.avgResponseTime}ms`,
      failureRate: `${metrics.failureRate}%`,
      totalConnections: metrics.totalConnections,
      reusedConnections: metrics.reusedConnections
    });

    console.log("\n--- All tests passed ---");
    gw.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err.message);
    console.error("Stack:", err.stack);
    gw.disconnect();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log("\nReceived SIGINT, cleaning up...");
  gw.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log("\nReceived SIGTERM, cleaning up...");
  gw.disconnect();
  process.exit(0);
});

runTests();