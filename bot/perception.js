/**
 * Perception module -- builds a snapshot of the world state from the bot's
 * perspective and serializes it to compact text for LLM consumption.
 *
 * Tracks chat, player movements, emotes, joins/leaves to give the bot
 * a rich understanding of what's happening around it.
 */

import { buildLayout, serializeLayout } from "./roomLayout.js";

export class PerceptionModule {
  /**
   * @param {object} botClient - BotClient instance (.id, .position, .characters, .name)
   * @param {object} [options]
   * @param {number} [options.radius=15]           - Chebyshev perception radius for "nearby"
   * @param {number} [options.chatHistoryMs=300000] - Chat history window (5 min)
   * @param {number} [options.activityHistoryMs=120000] - Activity feed window (2 min)
   * @param {number} [options.maxOwnActions=8]     - Max own actions to remember
   * @param {number} [options.maxActivityEvents=30] - Max activity events to keep
   * @param {string} [options.ownerName]           - Name of bot's owner for special tracking
   */
  constructor(botClient, options = {}) {
    this._bot = botClient;
    this._radius = options.radius ?? 15;
    this._chatHistoryMs = options.chatHistoryMs ?? 300_000;
    this._activityHistoryMs = options.activityHistoryMs ?? 120_000;
    this._maxOwnActions = options.maxOwnActions ?? 8;
    this._maxActivityEvents = options.maxActivityEvents ?? 30;
    this._ownerName = options.ownerName ?? null;

    this._chatHistory = [];    // { id, name, message, timestamp }
    this._ownActions = [];     // { type, params, timestamp }
    this._activityFeed = [];   // { event, detail, timestamp }
  }

  /** Set or update the owner name at runtime. */
  setOwner(name) {
    this._ownerName = name;
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
   * Record a player movement event.
   * @param {{ id: string, position: number[], path?: number[][] }} data
   */
  onPlayerMove(data) {
    const character = this._bot.characters?.find(c => c.id === data.id);
    if (!character || data.id === this._bot.id) return;
    const name = character?.session?.name ?? character?.name ?? `Player-${data.id.slice(0, 4)}`;
    const pos = data.position ?? data.path?.[data.path.length - 1];
    if (pos) {
      this._pushActivity(`${name} moved to [${pos}]`);
    }
  }

  /**
   * Record an emote event from another player.
   * @param {{ id: string, emote: string }} data
   */
  onEmote(data) {
    if (data.id === this._bot.id) return;
    const character = this._bot.characters?.find(c => c.id === data.id);
    const name = character?.session?.name ?? character?.name ?? `Player-${data.id.slice(0, 4)}`;
    this._pushActivity(`${name} played emote: ${data.emote ?? data.name ?? 'unknown'}`);
  }

  /**
   * Record a player dance event.
   * @param {{ id: string }} data
   */
  onDance(data) {
    if (data.id === this._bot.id) return;
    const character = this._bot.characters?.find(c => c.id === data.id);
    const name = character?.session?.name ?? character?.name ?? `Player-${data.id.slice(0, 4)}`;
    this._pushActivity(`${name} started dancing`);
  }

  /**
   * Record a player joining the room.
   * @param {{ character: object, roomName: string }} data
   */
  onCharacterJoined(data) {
    const char = data.character ?? data;
    const name = char?.session?.name ?? char?.name ?? 'Someone';
    this._pushActivity(`${name} joined the room`);
  }

  /**
   * Record a player leaving the room.
   * @param {{ name: string, id: string }} data
   */
  onCharacterLeft(data) {
    const name = data.name ?? `Player-${(data.id ?? '').slice(0, 4)}`;
    this._pushActivity(`${name} left the room`);
  }

  /**
   * Record a wave event.
   * @param {{ from: string, senderId: string }} data
   */
  onWave(data) {
    this._pushActivity(`${data.from ?? 'Someone'} waved at you`);
  }

  /**
   * Record a player sitting event.
   * @param {{ id: string }} data
   */
  onPlayerSit(data) {
    if (data.id === this._bot.id) return;
    const character = this._bot.characters?.find(c => c.id === data.id);
    const name = character?.session?.name ?? character?.name ?? `Player-${data.id.slice(0, 4)}`;
    this._pushActivity(`${name} sat down`);
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

    // All players in room (with distance)
    const allPlayers = (this._bot.characters ?? [])
      .filter(c => c.id !== this._bot.id)
      .map(c => {
        const [cx, cy] = c.position ?? [0, 0];
        const distance = Math.max(Math.abs(cx - bx), Math.abs(cy - by));
        const name = c.session?.name ?? c.name ?? `Player-${c.id.slice(0, 4)}`;
        return { id: c.id, name, position: c.position, isBot: !!c.isBot, distance };
      });

    // Nearby players (within perception radius)
    const nearbyPlayers = allPlayers
      .filter(c => c.distance <= this._radius)
      .sort((a, b) => a.distance - b.distance);

    // Total player count in room
    const totalPlayersInRoom = allPlayers.length;

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

    // Activity feed (pruned)
    this._pruneActivity();
    const activityFeed = this._activityFeed.map(a => ({
      detail: a.detail,
      secsAgo: Math.round((now - a.timestamp) / 1000),
    }));

    // Room items (furniture already placed)
    const roomItems = (this._bot.room?.items ?? []).map(item => ({
      name: item.name,
      position: item.gridPosition,
      size: item.size,
      rotation: item.rotation ?? 0,
    }));

    // Owner tracking
    const owner = this._ownerName
      ? allPlayers.find(p => p.name.toLowerCase() === this._ownerName.toLowerCase()) ?? null
      : null;

    // Available rooms for apartment claiming
    const availableRooms = (this._bot.rooms ?? []).map(r => ({
      id: r.id,
      name: r.name,
      claimedBy: r.claimedBy || null,
      generated: r.generated || false,
      nbCharacters: r.nbCharacters ?? 0,
    }));

    return {
      self: { id: this._bot.id, name: this._bot.name, position: this._bot.position },
      nearbyPlayers,
      totalPlayersInRoom,
      recentChat,
      ownRecentActions,
      activityFeed,
      roomItems,
      roomSize: this._bot.room?.size ?? [50, 50],
      gridDivision: this._bot.room?.gridDivision ?? 2,
      roomLayout: buildLayout({
        size: this._bot.room?.size,
        items: this._bot.room?.items,
        gridDivision: this._bot.room?.gridDivision,
        id: this._bot.room?.id,
      }),
      availableRooms,
      owner,
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

    // Owner
    if (snap.owner) {
      const oPos = snap.owner.position ? `[${snap.owner.position}]` : '[?,?]';
      lines.push(`[Owner] ${snap.owner.name} at ${oPos} (dist ${snap.owner.distance}) -- your controller, pay special attention to them`);
    } else if (this._ownerName) {
      lines.push(`[Owner] ${this._ownerName} is not nearby or not in this room`);
    }

    // Room population
    lines.push(`[Room population] ${snap.totalPlayersInRoom} other characters in this room`);

    // Nearby players
    if (snap.nearbyPlayers.length === 0) {
      lines.push('[Nearby] Nobody nearby');
    } else {
      const parts = snap.nearbyPlayers.slice(0, 15).map(p => {
        const pPos = p.position ? `[${p.position}]` : '[?,?]';
        const bot = p.isBot ? ', bot' : '';
        return `${p.name} at ${pPos} (dist ${p.distance}${bot})`;
      });
      lines.push(`[Nearby] ${parts.join(', ')}`);
      if (snap.nearbyPlayers.length > 15) {
        lines.push(`  ...and ${snap.nearbyPlayers.length - 15} more`);
      }
    }

    // Chat
    if (snap.recentChat.length === 0) {
      lines.push('[Chat] No recent messages');
    } else {
      const parts = snap.recentChat.map(c => {
        const msg = c.message.length > 120 ? c.message.slice(0, 117) + '...' : c.message;
        return `(${c.secsAgo}s ago) ${c.name}: ${msg}`;
      });
      lines.push(`[Chat] ${parts.join(' | ')}`);
    }

    // Activity feed
    if (snap.activityFeed.length > 0) {
      const parts = snap.activityFeed.slice(-10).map(a => `(${a.secsAgo}s ago) ${a.detail}`);
      lines.push(`[Activity] ${parts.join(' | ')}`);
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

    // Room items (furniture)
    if (snap.roomItems && snap.roomItems.length > 0) {
      const itemSummary = snap.roomItems.map(i =>
        `${i.name}@[${i.position}]`
      ).join(', ');
      lines.push(`[Room items] ${snap.roomItems.length} items: ${itemSummary}`);
    } else {
      lines.push('[Room items] Empty room - no furniture placed yet');
    }
    const maxGrid = (snap.roomSize?.[0] ?? 50) * (snap.gridDivision ?? 2);
    lines.push(`[Room] Grid 0-${maxGrid - 1} on each axis`);

    // Room layout
    if (snap.roomLayout) {
      lines.push(serializeLayout(snap.roomLayout, snap.self.position));
    }

    // Available apartments
    if (snap.availableRooms && snap.availableRooms.length > 0) {
      const myApartment = snap.availableRooms.find(r => r.claimedBy === snap.self.name);
      if (myApartment) {
        lines.push(`[Your apartment] "${myApartment.name}" (id: ${myApartment.id})`);
      }
      const unclaimed = snap.availableRooms.filter(r => r.generated && !r.claimedBy).slice(0, 5);
      if (unclaimed.length > 0) {
        const parts = unclaimed.map(r => `${r.id}`);
        lines.push(`[Unclaimed apartments] ${parts.join(', ')} (${snap.availableRooms.filter(r => r.generated && !r.claimedBy).length} total available)`);
      }
    }

    // Timestamp
    lines.push(`[Time] ${new Date(snap.timestamp).toISOString()}`);

    return lines.join('\n');
  }

  /** @private */
  _pushActivity(detail) {
    this._activityFeed.push({ detail, timestamp: Date.now() });
    if (this._activityFeed.length > this._maxActivityEvents) {
      this._activityFeed.shift();
    }
  }

  /** @private */
  _pruneChat() {
    const cutoff = Date.now() - this._chatHistoryMs;
    this._chatHistory = this._chatHistory.filter(c => c.timestamp >= cutoff);
  }

  /** @private */
  _pruneActivity() {
    const cutoff = Date.now() - this._activityHistoryMs;
    this._activityFeed = this._activityFeed.filter(a => a.timestamp >= cutoff);
  }
}
