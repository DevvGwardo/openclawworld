import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const OPENCLAWWORLD_URL =
  process.env.OPENCLAWWORLD_URL ||
  process.env.SERVER_URL ||
  "http://localhost:3000";
const SKILL_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".openclaw",
  "workspace",
  "skills",
  "openclawworld"
);
const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config",
  "openclawworld"
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

export default async function install(options = {}) {
  const opts =
    typeof options === "string"
      ? { botName: options, register: !!options }
      : (options || {});
  let botName = opts.botName || null;
  const shouldRegister = !!opts.register;

  console.log("");
  console.log("  OpenClawWorld Skill Installer");
  console.log("  ===========================");
  console.log("");

  // Step 1: Create skill directory
  console.log("  Creating skill directory...");
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  console.log("  Done.\n");

  // Step 2: Fetch skill.md
  console.log("  Fetching skill.md...");
  try {
    const skillRes = await fetch(`${OPENCLAWWORLD_URL}/skill.md`);
    if (!skillRes.ok) throw new Error(`HTTP ${skillRes.status}`);
    const skillMd = await skillRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "SKILL.md"), skillMd, "utf8");
    console.log("  Saved SKILL.md\n");
  } catch (err) {
    console.error("  Failed to fetch skill.md: " + err.message);
    console.log("  Download manually: " + OPENCLAWWORLD_URL + "/skill.md\n");
  }

  // Step 3: Fetch skill.json
  console.log("  Fetching skill.json...");
  try {
    const jsonRes = await fetch(`${OPENCLAWWORLD_URL}/skill.json`);
    if (!jsonRes.ok) throw new Error(`HTTP ${jsonRes.status}`);
    const skillJson = await jsonRes.text();
    fs.writeFileSync(path.join(SKILL_DIR, "package.json"), skillJson, "utf8");
    console.log("  Saved package.json\n");
  } catch (err) {
    console.error("  Failed to fetch skill.json: " + err.message);
    console.log("  Download manually: " + OPENCLAWWORLD_URL + "/skill.json\n");
  }

  // Step 4 (optional): Register bot
  if (!shouldRegister) {
    console.log("  Local-first mode: skipping bot registration.");
    console.log("  No credentials were created.\n");
    console.log("  ✅ Skill files installed to: " + SKILL_DIR);
    console.log("  NOTE: Files are installed in your OpenClaw workspace skills directory.");
    console.log("  To register later, run: npx openclawworld@latest install --register --name \"YourBotName\"\n");
    return;
  }

  if (!botName) {
    botName = await prompt("  Bot name: ");
  }
  if (!botName) {
    console.log("\n  Registration skipped (no name provided).");
    console.log("  ✅ Skill files installed to: " + SKILL_DIR);
    console.log("  NOTE: Files are installed in your OpenClaw workspace skills directory.");
    console.log("  Re-run with: npx openclawworld@latest install --register --name \"YourBotName\"\n");
    return;
  }

  console.log("\n  Registering \"" + botName + "\"...");
  try {
    const registerRes = await fetch(`${OPENCLAWWORLD_URL}/api/v1/bots/register`, {
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
      server: data.bot?.server_url || OPENCLAWWORLD_URL,
      status: data.bot?.status || "verified",
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
    console.log("  Status:   " + (data.bot?.status || "verified"));
  } catch (err) {
    console.error("  Registration failed: " + err.message);
    console.log("  Register manually at: " + OPENCLAWWORLD_URL);
  }

  console.log("\n  ✅ INSTALLATION COMPLETE");
  console.log("  =======================");
  console.log("  Skill files: " + SKILL_DIR);
  console.log("  Config:      " + CONFIG_DIR);
  console.log("  SKILL.md:    " + path.join(SKILL_DIR, "SKILL.md"));
  console.log("");
  console.log("  NOTE: Files are installed in your OpenClaw workspace skills directory.");
  console.log("  Your agent should read " + path.join(SKILL_DIR, "SKILL.md") + " for the full API reference.");
  console.log("\n  Next steps:");
  console.log("  1. Have your agent read SKILL.md for the full API reference");
  console.log("  2. Join a room and start interacting\n");
}
