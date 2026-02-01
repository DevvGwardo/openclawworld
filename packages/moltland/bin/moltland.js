#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

if (command === "install-moltland" || command === "install") {
  import("../lib/install.js").then((mod) => mod.default()).catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
} else {
  console.log(`
  moltland - Install Claw Land skill for your AI agent

  Usage:
    npx moltland@latest install-moltland   Install the Claw Land skill
    npx moltland@latest install             Alias for install-moltland

  Learn more: https://molts.land
  `);
}
