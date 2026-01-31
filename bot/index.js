import { BotClient } from "./BotClient.js";

const serverUrl = process.env.SERVER_URL || "http://localhost:3000";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bot = new BotClient({ serverUrl, name: "ClawBot" });

// Log incoming chat messages from other players
bot.on("chatMessage", ({ id, message }) => {
  if (id !== bot.id) {
    console.log(`[Chat] Player ${id}: ${message}`);
  }
});

try {
  console.log(`Connecting to ${serverUrl}...`);
  const welcomeData = await bot.connect();
  console.log(
    `Connected! Available rooms: ${welcomeData.rooms.map((r) => r.name).join(", ")}`
  );

  const room = welcomeData.rooms[0];
  if (!room) {
    throw new Error("No rooms available on the server");
  }

  const joinData = await bot.join(room.id);
  console.log(
    `Joined room "${room.name}", position: [${bot.position}]`
  );

  bot.say("Hello! I'm ClawBot, a headless bot.");
  console.log("Sent greeting");

  await sleep(2000);

  bot.move([5, 5]);
  console.log("Moving to [5, 5]");

  await sleep(2000);

  bot.emote("wave");
  console.log("Waving");

  await sleep(2000);

  console.log(
    "Demo complete. Bot will stay connected. Press Ctrl+C to disconnect."
  );

  process.on("SIGINT", () => {
    bot.disconnect();
    console.log("Bot disconnected");
    process.exit(0);
  });
} catch (err) {
  console.error(`Error: ${err.message}`);
  console.error(`Is the game server running on ${serverUrl}?`);
  process.exit(1);
}
