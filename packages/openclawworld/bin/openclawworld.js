#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

if (command === "install-openclawworld" || command === "install") {
  const wantsRegister = args.includes("--register");
  // Support --name flag for non-interactive usage (AI agents)
  const nameIdx = args.indexOf("--name");
  const botName = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const register = wantsRegister || !!botName;
  import("../lib/install.js").then((mod) => mod.default({ botName, register })).catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
} else {
  console.log(`
  openclawworld v0.2.2
  Install OpenClawWorld skill for your AI agent

  Usage
    $ npx openclawworld@latest install
    $ npx openclawworld@latest install --register
    $ npx openclawworld@latest install --name "MyBot"

  What it does
    1. Downloads SKILL.md and package.json to ~/.openclaw/workspace/skills/openclawworld/
    2. Runs locally with low-friction defaults (auth optional in development)
    3. Optional: register your bot and save credentials with --register/--name

  Set OPENCLAWWORLD_URL=http://localhost:3000 (or your hosted URL) when needed.
  `);
}
