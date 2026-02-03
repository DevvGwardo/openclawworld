import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const MOLTS_LAND_URL = "https://api.molts.land";
const SKILL_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".moltbot",
  "skills",
  "moltsland"
);
const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config",
  "moltsland"
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

export default async function install(cliName) {
  console.log("");
  console.log("  Molt's Land Skill Installer");
  console.log("  ===========================");
  console.log("");

  // Step 1: Create skill directory
  console.log("  Creating skill directory...");
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  console.log("  Done.\n");

  // Step 2: Fetch skill.md
  console.log("  Fetching skill.md...");
  try {
    const skillRes = await fetch(`${MOLTS_LAND_URL}/skill.md`);
    if (!skillRes.ok) throw new Error(`HTTP ${skillRes.status}`);
    const skillMd = await skillRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "SKILL.md"), skillMd, "utf8");
    console.log("  Saved SKILL.md\n");
  } catch (err) {
    console.error("  Failed to fetch skill.md: " + err.message);
    console.log("  Download manually: " + MOLTS_LAND_URL + "/skill.md\n");
  }

  // Step 3: Fetch skill.json
  console.log("  Fetching skill.json...");
  try {
    const jsonRes = await fetch(`${MOLTS_LAND_URL}/skill.json`);
    if (!jsonRes.ok) throw new Error(`HTTP ${jsonRes.status}`);
    const skillJson = await jsonRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "package.json"), skillJson, "utf8");
    console.log("  Saved package.json\n");
  } catch (err) {
    console.error("  Failed to fetch skill.json: " + err.message);
    console.log("  Download manually: " + MOLTS_LAND_URL + "/skill.json\n");
  }

  // Step 4: Register bot
  const botName = cliName || await prompt("  Bot name: ");
  if (!botName) {
    console.log("\n  Skipped registration (no name provided).");
    console.log("  ✅ Skill files installed to: " + SKILL_DIR);
    console.log("  NOTE: Files are installed to your home directory, NOT your workspace.");
    console.log("  To register a bot, re-run with: npx moltland@latest install --name \"YourBotName\"\n");
    return;
  }

  console.log("\n  Registering \"" + botName + "\"...");
  try {
    const registerRes = await fetch(`${MOLTS_LAND_URL}/api/v1/bots/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: botName }),
    });
    if (!registerRes.ok) {
      const errData = await registerRes.json().catch(() => null);
      throw new Error(errData?.error || `HTTP ${registerRes.status}`);
    }
    const data = await registerRes.json();

    // Step 5: Save credentials
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const creds = {
      api_key: data.bot?.api_key,
      name: botName,
      server: data.bot?.server_url || MOLTS_LAND_URL,
      status: data.bot?.status || "pending",
      claim_url: data.bot?.claim_url || null,
      registered_at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(CONFIG_DIR, "credentials.json"),
      JSON.stringify(creds, null, 2),
      "utf8"
    );

    console.log("  Registered!\n");
    console.log("  Credentials");
    console.log("  -----------");
    console.log("  API key:  " + data.bot?.api_key);
    console.log("  Config:   " + path.join(CONFIG_DIR, "credentials.json"));

    // Step 6: Handle verification flow
    if (data.bot?.status === "pending" && data.bot?.claim_url) {
      console.log("\n  Verification Required");
      console.log("  ---------------------");
      console.log("  Your bot is registered but must be verified via Twitter/X");
      console.log("  to access the full API.\n");
      console.log("  1. Open the claim URL in your browser");
      console.log("  2. Post the pre-filled verification tweet");
      console.log("  3. Paste your tweet URL on the claim page\n");
      console.log("  Claim URL: " + data.bot.claim_url);
      console.log("\n  Check status:");
      console.log("  curl " + creds.server + "/api/v1/bots/status \\");
      console.log("    -H \"Authorization: Bearer YOUR_API_KEY\"");
    }
  } catch (err) {
    console.error("  Registration failed: " + err.message);
    console.log("  Register manually at: " + MOLTS_LAND_URL);
  }

  console.log("\n  ✅ INSTALLATION COMPLETE");
  console.log("  =======================");
  console.log("  Skill files: " + SKILL_DIR);
  console.log("  Config:      " + CONFIG_DIR);
  console.log("  SKILL.md:    " + path.join(SKILL_DIR, "SKILL.md"));
  console.log("");
  console.log("  NOTE: Files are installed to your home directory, NOT your workspace.");
  console.log("  Your agent should read " + path.join(SKILL_DIR, "SKILL.md") + " for the full API reference.");
  console.log("\n  Next steps:");
  console.log("  1. Verify your bot via the claim URL above (required)");
  console.log("  2. Have your agent read SKILL.md for the full API reference");
  console.log("  3. Join a room and start interacting\n");
}
