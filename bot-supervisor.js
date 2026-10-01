/**
 * Auto-manages presence bots for Claude and Codex CLIs.
 *
 * Behavior:
 * - Poll running processes for Claude/Codex activity.
 * - Spawn matching bot when activity is detected.
 * - Stop managed bot after consecutive idle polls.
 *
 * Usage:
 *   node bot-supervisor.js [serverUrl] [--once] [--dry-run]
 */

import { exec, spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliArgs = process.argv.slice(2);
const ONCE = cliArgs.includes("--once");
const DRY_RUN = cliArgs.includes("--dry-run");
const SERVER =
  cliArgs.find((arg) => !arg.startsWith("--")) ||
  process.env.BOT_SERVER_URL ||
  "http://localhost:3000";

const POLL_INTERVAL_MS = Number(process.env.BOT_SUPERVISOR_POLL_MS || 10000);
const ACTIVE_POLLS_REQUIRED = Number(process.env.BOT_SUPERVISOR_ACTIVE_POLLS || 1);
const IDLE_POLLS_REQUIRED = Number(process.env.BOT_SUPERVISOR_IDLE_POLLS || 3);
const DEBUG = process.env.BOT_SUPERVISOR_DEBUG === "1";

const BOT_CONFIGS = [
  {
    key: "claude",
    script: "claude-bot.js",
    defaultName: process.env.CLAUDE_BOT_NAME || "ClaudeAgent",
    activityTokens: (process.env.CLAUDE_ACTIVITY_TOKENS || "claude")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  },
  {
    key: "codex",
    script: "codex-bot.js",
    defaultName: process.env.CODEX_BOT_NAME || "CodexAgent",
    activityTokens: (process.env.CODEX_ACTIVITY_TOKENS || "codex,gpt-5-codex")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  },
];

const ALL_BOT_SCRIPT_NAMES = BOT_CONFIGS.map((c) => c.script.toLowerCase());
const SUPERVISOR_SCRIPT_NAME = path.basename(__filename).toLowerCase();

const state = new Map(
  BOT_CONFIGS.map((cfg) => [
    cfg.key,
    {
      activeStreak: 0,
      idleStreak: 0,
      child: null,
      warnedExternal: false,
    },
  ])
);

function shouldIgnoreProcessLine(normalizedLine) {
  if (!normalizedLine) return true;
  if (normalizedLine.includes("ps -eo pid,args")) return true;
  if (normalizedLine.includes("grep")) return true;
  if (normalizedLine.includes(" -p ")) return true;
  if (normalizedLine.includes(SUPERVISOR_SCRIPT_NAME)) return true;
  return false;
}

function listProcesses() {
  return new Promise((resolve) => {
    exec("ps -eo pid,args", (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      resolve(lines);
    });
  });
}

function analyzeProcesses(lines) {
  const normalizedLines = lines.map((line) => line.toLowerCase());
  const result = new Map();

  for (const cfg of BOT_CONFIGS) {
    const scriptLower = cfg.script.toLowerCase();
    let activityDetected = false;
    let externalBotProcessDetected = false;

    for (const line of normalizedLines) {
      if (line.includes(scriptLower) && !line.includes(SUPERVISOR_SCRIPT_NAME)) {
        externalBotProcessDetected = true;
      }
      if (shouldIgnoreProcessLine(line)) continue;

      const hasToken = cfg.activityTokens.some((token) => line.includes(token));
      if (!hasToken) continue;

      if (ALL_BOT_SCRIPT_NAMES.some((scriptName) => line.includes(scriptName))) continue;

      activityDetected = true;
      break;
    }

    result.set(cfg.key, { activityDetected, externalBotProcessDetected });
  }

  return result;
}

function spawnManagedBot(cfg) {
  const slot = state.get(cfg.key);
  if (!slot || slot.child) return;

  const scriptPath = path.join(__dirname, cfg.script);
  const args = [scriptPath, cfg.defaultName, SERVER];

  console.log(
    `[bot-supervisor] starting ${cfg.key} bot (${cfg.defaultName}) -> ${cfg.script} ${cfg.defaultName} ${SERVER}`
  );

  if (DRY_RUN) return;

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });

  slot.child = child;

  child.on("exit", (code, signal) => {
    if (slot.child === child) slot.child = null;
    console.log(
      `[bot-supervisor] ${cfg.key} bot exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
    );
  });
}

function stopManagedBot(cfg, reason) {
  const slot = state.get(cfg.key);
  if (!slot || !slot.child) return;

  const child = slot.child;
  console.log(`[bot-supervisor] stopping ${cfg.key} bot (${reason})`);

  if (DRY_RUN) return;

  child.kill("SIGTERM");
  setTimeout(() => {
    if (slot.child === child) {
      child.kill("SIGKILL");
    }
  }, 4000);
}

async function reconcile() {
  const lines = await listProcesses();
  const analysis = analyzeProcesses(lines);
  if (DEBUG) {
    console.log(`[bot-supervisor][debug] process lines sampled: ${lines.length}`);
  }

  for (const cfg of BOT_CONFIGS) {
    const slot = state.get(cfg.key);
    const details = analysis.get(cfg.key);
    if (!slot || !details) continue;

    const managedRunning = !!slot.child;
    const externalRunning = details.externalBotProcessDetected && !managedRunning;
    if (DEBUG) {
      console.log(
        `[bot-supervisor][debug] ${cfg.key}: activity=${details.activityDetected} managed=${managedRunning} external=${externalRunning} activeStreak=${slot.activeStreak} idleStreak=${slot.idleStreak}`
      );
    }

    if (externalRunning && !slot.warnedExternal) {
      console.log(
        `[bot-supervisor] ${cfg.key} bot already running outside supervisor; skipping managed spawn`
      );
      slot.warnedExternal = true;
    }
    if (!externalRunning) {
      slot.warnedExternal = false;
    }

    if (details.activityDetected) {
      slot.activeStreak += 1;
      slot.idleStreak = 0;

      if (!managedRunning && !externalRunning && slot.activeStreak >= ACTIVE_POLLS_REQUIRED) {
        spawnManagedBot(cfg);
      }
      continue;
    }

    slot.idleStreak += 1;
    slot.activeStreak = 0;

    if (managedRunning && slot.idleStreak >= IDLE_POLLS_REQUIRED) {
      stopManagedBot(cfg, `idle for ${slot.idleStreak} poll(s)`);
    }
  }
}

let pollTimer = null;

async function tick() {
  await reconcile();
  if (ONCE) return;
  pollTimer = setTimeout(() => {
    tick().catch((err) => {
      console.error("[bot-supervisor] tick error:", err?.message || err);
    });
  }, POLL_INTERVAL_MS);
}

function shutdown(signal) {
  if (pollTimer) clearTimeout(pollTimer);
  console.log(`[bot-supervisor] shutting down (${signal})`);

  for (const cfg of BOT_CONFIGS) {
    const slot = state.get(cfg.key);
    if (slot?.child) {
      stopManagedBot(cfg, "supervisor shutdown");
    }
  }

  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(
  `[bot-supervisor] monitoring ${BOT_CONFIGS.map((c) => c.key).join(", ")} CLI activity (server=${SERVER})`
);
if (DRY_RUN) {
  console.log("[bot-supervisor] dry-run mode: no bots will be started/stopped");
}
if (ONCE) {
  console.log("[bot-supervisor] once mode: one poll then exit");
}

tick().catch((err) => {
  console.error("[bot-supervisor] fatal:", err?.message || err);
  process.exit(1);
});
