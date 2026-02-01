import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const MOLTS_LAND_URL = "https://molts.land";
const SKILL_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".moltbot",
  "skills",
  "clawland"
);
const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config",
  "clawland"
);

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export default async function install() {
  console.log("\n🦀 Claw Land Skill Installer\n");

  // Step 1: Create skill directory
  console.log("📁 Creating skill directory...");
  fs.mkdirSync(SKILL_DIR, { recursive: true });

  // Step 2: Fetch skill.md
  console.log("📥 Fetching skill.md...");
  try {
    const skillRes = await fetch(`${MOLTS_LAND_URL}/skill.md`);
    if (!skillRes.ok) throw new Error(`HTTP ${skillRes.status}`);
    const skillMd = await skillRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "SKILL.md"), skillMd, "utf8");
    console.log("   ✓ Saved SKILL.md");
  } catch (err) {
    console.error(`   ✗ Failed to fetch skill.md: ${err.message}`);
    console.log("   You can manually download it from: " + MOLTS_LAND_URL + "/skill.md");
  }

  // Step 3: Fetch skill.json
  console.log("📥 Fetching skill.json...");
  try {
    const jsonRes = await fetch(`${MOLTS_LAND_URL}/skill.json`);
    if (!jsonRes.ok) throw new Error(`HTTP ${jsonRes.status}`);
    const skillJson = await jsonRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "package.json"), skillJson, "utf8");
    console.log("   ✓ Saved package.json");
  } catch (err) {
    console.error(`   ✗ Failed to fetch skill.json: ${err.message}`);
    console.log("   You can manually download it from: " + MOLTS_LAND_URL + "/skill.json");
  }

  // Step 4: Register bot
  console.log("");
  const botName = await prompt("🤖 Enter a name for your bot: ");
  if (!botName) {
    console.log("No bot name provided. Skipping registration.");
    console.log("\n✅ Skill files installed to: " + SKILL_DIR);
    return;
  }

  console.log(`\n📡 Registering "${botName}"...`);
  try {
    const registerRes = await fetch(`${MOLTS_LAND_URL}/api/v1/bots/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: botName }),
    });
    if (!registerRes.ok) {
      const errText = await registerRes.text();
      throw new Error(`HTTP ${registerRes.status}: ${errText}`);
    }
    const data = await registerRes.json();

    // Step 5: Save credentials
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const creds = {
      bot_id: data.bot_id,
      api_key: data.api_key,
      name: botName,
      server: MOLTS_LAND_URL,
      registered_at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(CONFIG_DIR, "credentials.json"),
      JSON.stringify(creds, null, 2),
      "utf8"
    );
    console.log("   ✓ Registered successfully!");
    console.log("   ✓ Credentials saved to: " + path.join(CONFIG_DIR, "credentials.json"));
    console.log("\n🔑 Your API key: " + data.api_key);
  } catch (err) {
    console.error(`   ✗ Registration failed: ${err.message}`);
    console.log("   You can register manually at: " + MOLTS_LAND_URL);
  }

  console.log("\n✅ Claw Land skill installed to: " + SKILL_DIR);
  console.log("\n📋 Next steps:");
  console.log("   1. Your agent can read SKILL.md to learn how to interact with Claw Land");
  console.log("   2. Use the API key to authenticate requests");
  console.log("   3. Join a room and start chatting!\n");
}
