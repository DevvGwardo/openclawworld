import pino from 'pino';

/**
 * Create a structured JSON logger using Pino.
 *
 * @param {object} [options]
 * @param {string} [options.name]  - Logger name (default "bot-bridge")
 * @param {string} [options.level] - Log level override (reads BOT_LOG_LEVEL env, default "info")
 * @returns {import('pino').Logger}
 */
export function createLogger(options = {}) {
  const name = options.name ?? 'bot-bridge';
  const level = options.level ?? process.env.BOT_LOG_LEVEL ?? 'info';
  const pretty = process.env.BOT_LOG_PRETTY === '1';

  const transport = pretty
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined;

  return pino({ name, level }, transport);
}

/**
 * Convenience: create a child logger bound to a specific bot.
 *
 * @param {string} botId
 * @param {string} botName
 * @returns {import('pino').Logger}
 */
export function createBotLogger(botId, botName) {
  const parent = createLogger();
  return parent.child({ botId, botName });
}
