/**
 * Perception module -- builds a snapshot of the world state from the bot's
 * perspective and serializes it to compact text for LLM consumption.
 */

export class PerceptionModule {
  /**
   * @param {object} botClient - BotClient instance (.id, .position, .characters, .name)
   * @param {object} [options]
   * @param {number} [options.radius=6]          - Chebyshev perception radius
   * @param {number} [options.chatHistoryMs=60000] - Chat history window in ms
   * @param {number} [options.maxOwnActions=5]   - Max own actions to remember
   */
  constructor(botClient, options = {}) {
    this._bot = botClient;
    this._radius = options.radius ?? 6;
    this._chatHistoryMs = options.chatHistoryMs ?? 60000;
    this._maxOwnActions = options.maxOwnActions ?? 5;
    this._chatHistory = [];   // { id, name, message, timestamp }
    this._ownActions = [];    // { type, params, timestamp }
  }

  /**
   * Record an incoming chat message.
   * @param {{ id: string, message: string }} msg
   */
  onChatMessage({ id, message }) {
    const character = this._bot.characters?.find(c => c.id === id);
    const name = character?.session?.name ?? character?.name ?? `Player-${id.slice(0, 4)}`;
    this._chatHistory.push({ id, name, message, timestamp: Date.now() });
    this._pruneChat();
  }

  /**
   * Record an action the bot itself performed.
   * @param {{ type: string, [key: string]: any }} action
   */
  recordOwnAction(action) {
    const { type, ...params } = action;
    this._ownActions.push({ type, params, timestamp: Date.now() });
    if (this._ownActions.length > this._maxOwnActions) {
      this._ownActions.shift();
    }
  }

  /**
   * Build a structured snapshot of the world from the bot's perspective.
   */
  snapshot() {
    const now = Date.now();
    const [bx, by] = this._bot.position ?? [0, 0];

    // Nearby players (within Chebyshev radius, excluding self)
    const nearbyPlayers = (this._bot.characters ?? [])
      .filter(c => c.id !== this._bot.id)
      .map(c => {
        const [cx, cy] = c.position ?? [0, 0];
        const distance = Math.max(Math.abs(cx - bx), Math.abs(cy - by));
        const name = c.session?.name ?? c.name ?? `Player-${c.id.slice(0, 4)}`;
        return { id: c.id, name, position: c.position, isBot: !!c.isBot, distance };
      })
      .filter(c => c.distance <= this._radius)
      .sort((a, b) => a.distance - b.distance);

    // Prune chat and map
    this._pruneChat();
    const recentChat = this._chatHistory.map(c => ({
      name: c.name,
      message: c.message,
      secsAgo: Math.round((now - c.timestamp) / 1000),
    }));

    // Own recent actions
    const ownRecentActions = this._ownActions.map(a => ({
      type: a.type,
      params: a.params,
      secsAgo: Math.round((now - a.timestamp) / 1000),
    }));

    return {
      self: { id: this._bot.id, name: this._bot.name, position: this._bot.position },
      nearbyPlayers,
      recentChat,
      ownRecentActions,
      timestamp: now,
    };
  }

  /**
   * Serialize a snapshot to compact text suitable for LLM context.
   * @param {object} snap - Output of snapshot()
   * @returns {string}
   */
  serialize(snap) {
    const lines = [];

    // Self
    const pos = snap.self.position ? `[${snap.self.position}]` : '[?,?]';
    lines.push(`[You] ${snap.self.name} at ${pos}`);

    // Nearby players
    if (snap.nearbyPlayers.length === 0) {
      lines.push('[Nearby] Nobody nearby');
    } else {
      const parts = snap.nearbyPlayers.map(p => {
        const pPos = p.position ? `[${p.position}]` : '[?,?]';
        const bot = p.isBot ? ', bot' : '';
        return `${p.name} at ${pPos} (dist ${p.distance}${bot})`;
      });
      lines.push(`[Nearby] ${parts.join(', ')}`);
    }

    // Chat
    if (snap.recentChat.length === 0) {
      lines.push('[Chat] No recent messages');
    } else {
      const parts = snap.recentChat.map(c => {
        const msg = c.message.length > 80 ? c.message.slice(0, 77) + '...' : c.message;
        return `(${c.secsAgo}s ago) ${c.name}: ${msg}`;
      });
      lines.push(`[Chat] ${parts.join(' | ')}`);
    }

    // Own recent actions
    if (snap.ownRecentActions.length === 0) {
      lines.push('[Your recent] None');
    } else {
      const parts = snap.ownRecentActions.map(a => {
        const paramStr = Object.values(a.params).map(v =>
          typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
        ).join(' ');
        return `${a.type} ${paramStr} (${a.secsAgo}s ago)`.trim();
      });
      lines.push(`[Your recent] ${parts.join(', ')}`);
    }

    // Timestamp
    lines.push(`[Time] ${new Date(snap.timestamp).toISOString()}`);

    return lines.join('\n');
  }

  /** @private */
  _pruneChat() {
    const cutoff = Date.now() - this._chatHistoryMs;
    this._chatHistory = this._chatHistory.filter(c => c.timestamp >= cutoff);
  }
}
