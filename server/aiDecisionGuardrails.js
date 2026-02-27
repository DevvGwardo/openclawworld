/**
 * Server-authoritative AI decision guardrails.
 * Tracks per-bot API call budgets and enforces cooldowns centrally.
 */

export function createAIDecisionGuardrails(config = {}) {
  const maxCallsPerBot = config.maxCallsPerBot ?? (Number(process.env.AI_MAX_CALLS_PER_BOT) || 500);
  const maxInputTokensPerBot = config.maxInputTokensPerBot ?? (Number(process.env.AI_MAX_INPUT_TOKENS_PER_BOT) || 500000);
  const maxOutputTokensPerBot = config.maxOutputTokensPerBot ?? (Number(process.env.AI_MAX_OUTPUT_TOKENS_PER_BOT) || 100000);
  const cooldownMs = config.cooldownMs ?? (Number(process.env.AI_COOLDOWN_MS) || 5000);
  const backoffMultiplier = config.backoffMultiplier ?? 2;
  const maxBackoffMs = config.maxBackoffMs ?? 60000;

  // Per-bot state: Map<botId, state>
  const botStates = new Map();

  const getOrCreate = (botId) => {
    if (!botStates.has(botId)) {
      botStates.set(botId, {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        errors: 0,
        lastCallTime: 0,
        currentCooldownMs: cooldownMs,
        consecutiveErrors: 0,
      });
    }
    return botStates.get(botId);
  };

  /**
   * Check whether a bot is allowed to make an AI call.
   * @param {string} botId
   * @returns {{ allowed: boolean, reason?: string, cooldownRemaining?: number }}
   */
  const requestPermission = (botId) => {
    const state = getOrCreate(botId);
    const now = Date.now();

    if (state.totalCalls >= maxCallsPerBot) {
      return { allowed: false, reason: "call budget exceeded" };
    }
    if (state.totalInputTokens >= maxInputTokensPerBot) {
      return { allowed: false, reason: "input token budget exceeded" };
    }
    if (state.totalOutputTokens >= maxOutputTokensPerBot) {
      return { allowed: false, reason: "output token budget exceeded" };
    }

    const elapsed = now - state.lastCallTime;
    if (state.lastCallTime > 0 && elapsed < state.currentCooldownMs) {
      const cooldownRemaining = state.currentCooldownMs - elapsed;
      return { allowed: false, reason: "cooldown active", cooldownRemaining };
    }

    state.lastCallTime = now;
    return { allowed: true };
  };

  /**
   * Record token usage after a successful AI call.
   * @param {string} botId
   * @param {{ inputTokens?: number, outputTokens?: number }} usage
   */
  const reportUsage = (botId, { inputTokens = 0, outputTokens = 0 } = {}) => {
    const state = getOrCreate(botId);
    state.totalCalls += 1;
    state.totalInputTokens += inputTokens;
    state.totalOutputTokens += outputTokens;
    // Reset backoff on success
    state.consecutiveErrors = 0;
    state.currentCooldownMs = cooldownMs;
  };

  /**
   * Record an error and apply exponential backoff.
   * @param {string} botId
   */
  const reportError = (botId) => {
    const state = getOrCreate(botId);
    state.errors += 1;
    state.consecutiveErrors += 1;
    const backoffMs = Math.pow(backoffMultiplier, state.consecutiveErrors) * 1000;
    state.currentCooldownMs = Math.min(backoffMs, maxBackoffMs);
  };

  /**
   * Get status for a single bot or all bots with aggregates.
   * @param {string} [botId]
   */
  const getStatus = (botId) => {
    if (botId) {
      const state = botStates.get(botId);
      if (!state) {
        return { botId, exists: false };
      }
      return {
        botId,
        ...state,
        budgets: {
          maxCallsPerBot,
          maxInputTokensPerBot,
          maxOutputTokensPerBot,
          cooldownMs,
        },
      };
    }

    // Return all bots + aggregate
    const bots = {};
    let aggregateCalls = 0;
    let aggregateInputTokens = 0;
    let aggregateOutputTokens = 0;
    let aggregateErrors = 0;

    for (const [id, state] of botStates) {
      bots[id] = { ...state };
      aggregateCalls += state.totalCalls;
      aggregateInputTokens += state.totalInputTokens;
      aggregateOutputTokens += state.totalOutputTokens;
      aggregateErrors += state.errors;
    }

    return {
      bots,
      aggregate: {
        totalCalls: aggregateCalls,
        totalInputTokens: aggregateInputTokens,
        totalOutputTokens: aggregateOutputTokens,
        errors: aggregateErrors,
        botCount: botStates.size,
      },
      config: {
        maxCallsPerBot,
        maxInputTokensPerBot,
        maxOutputTokensPerBot,
        cooldownMs,
        backoffMultiplier,
        maxBackoffMs,
      },
    };
  };

  /**
   * Reset all counters for a bot.
   * @param {string} botId
   */
  const resetBot = (botId) => {
    botStates.delete(botId);
  };

  return { requestPermission, reportUsage, reportError, getStatus, resetBot };
}
