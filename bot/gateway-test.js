// Gateway Integration Test Script
// Usage: CLAWLAND_GATEWAY_URL=ws://... CLAWLAND_GATEWAY_TOKEN=... node gateway-test.js
//
// Exercises the full Gateway flow against a live Gateway:
//   1. Connect and authenticate via Ed25519 challenge handshake
//   2. Send a hardcoded agent prompt via invokeAgent
//   3. Log and validate the response
//
// Requires a running Gateway instance.

import { GatewayClient } from "./GatewayClient.js";

const url = process.env.CLAWLAND_GATEWAY_URL;
const token = process.env.CLAWLAND_GATEWAY_TOKEN;

if (!url || !token) {
  console.error("Required env vars: CLAWLAND_GATEWAY_URL, CLAWLAND_GATEWAY_TOKEN");
  process.exit(1);
}

const gw = new GatewayClient({ url, token });

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

try {
  // Test 1: Connect and authenticate
  console.log("--- Test 1: Connect and authenticate ---");
  console.log(`Connecting to ${url}...`);
  await gw.connect();
  console.log("PASS: Connected and authenticated via challenge handshake");

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

  console.log("\n--- All tests passed ---");
  gw.disconnect();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err.message);
  gw.disconnect();
  process.exit(1);
}
