/**
 * Codex bot wrapper.
 * Reuses claude-bot.js core behavior with Codex-specific branding and
 * work-presence detection tokens.
 */

process.env.BOT_BRAND = process.env.BOT_BRAND || "codex";
process.env.BOT_BRAND_DISPLAY = process.env.BOT_BRAND_DISPLAY || "Codex";
process.env.BOT_DEFAULT_NAME = process.env.BOT_DEFAULT_NAME || "CodexAgent";
process.env.WORK_PRESENCE_TOKENS = process.env.WORK_PRESENCE_TOKENS || "codex,gpt-5-codex";
process.env.BOT_SCRIPT_NAMES =
  process.env.BOT_SCRIPT_NAMES || "claude-bot.js,codex-bot.js";

await import("./claude-bot.js");
