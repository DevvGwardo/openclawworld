import { BotBridge } from "./BotBridge.js";
import { createLogger } from "./logger.js";

const log = createLogger({ name: "bot-main" });

const bridge = new BotBridge({
  botName: process.env.BOT_NAME || "ClawBot",
});

// Graceful shutdown
const shutdown = async (signal) => {
  log.info({ signal }, "Shutting down...");
  await bridge.stop();
  log.info("Shutdown complete");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  const info = await bridge.start();
  log.info(info, "Bot is live");
} catch (err) {
  log.error({ err }, "Failed to start bot");
  process.exit(1);
}
