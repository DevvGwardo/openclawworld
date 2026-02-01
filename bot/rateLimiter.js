/**
 * Token bucket rate limiter.
 *
 * Burst of N tokens, refilling at `sustained` tokens per second,
 * capped at `burst`. Simple custom implementation to avoid limiter API quirks.
 */

/**
 * @param {object} [options]
 * @param {number} [options.burst=3]     - Maximum tokens (initial capacity)
 * @param {number} [options.sustained=1] - Tokens added per second
 * @returns {{ tryConsume: () => boolean, waitForToken: () => Promise<void>, getTokensRemaining: () => number, destroy: () => void }}
 */
export function createRateLimiter(options = {}) {
  const burst = options.burst ?? 3;
  const sustained = options.sustained ?? 1;

  let tokens = burst;

  // Refill timer
  const refillInterval = setInterval(() => {
    tokens = Math.min(burst, tokens + sustained);
  }, 1000);

  // Prevent interval from keeping the process alive
  if (refillInterval.unref) {
    refillInterval.unref();
  }

  return {
    /**
     * Try to consume one token synchronously.
     * @returns {boolean} true if consumed, false if rate limited
     */
    tryConsume() {
      if (tokens > 0) {
        tokens--;
        return true;
      }
      return false;
    },

    /**
     * Wait until a token is available, then consume it.
     * @returns {Promise<void>}
     */
    waitForToken() {
      return new Promise((resolve) => {
        if (tokens > 0) {
          tokens--;
          resolve();
          return;
        }
        const poll = setInterval(() => {
          if (tokens > 0) {
            tokens--;
            clearInterval(poll);
            resolve();
          }
        }, 100);
        if (poll.unref) poll.unref();
      });
    },

    /**
     * Current token count.
     * @returns {number}
     */
    getTokensRemaining() {
      return tokens;
    },

    /**
     * Clean up the refill interval.
     */
    destroy() {
      clearInterval(refillInterval);
    },
  };
}
