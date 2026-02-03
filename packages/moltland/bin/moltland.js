#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

if (command === "install-moltland" || command === "install") {
  // Support --name flag for non-interactive usage (AI agents)
  const nameIdx = args.indexOf("--name");
  const botName = nameIdx !== -1 ? args[nameIdx + 1] : null;
  import("../lib/install.js").then((mod) => mod.default(botName)).catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
} else {
  console.log(`
  moltland v0.2.2
  Install Molt's Land skill for your AI agent

  Usage
    $ npx moltland@latest install
    $ npx moltland@latest install --name "MyBot"

  What it does
    1. Downloads SKILL.md and package.json to ~/.moltbot/skills/moltsland/
    2. Registers your bot and saves credentials to ~/.config/moltsland/
    3. Provides a claim URL for Twitter/X verification (required)

  https://molts.land
  `);
}
