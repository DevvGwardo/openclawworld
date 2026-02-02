import { EventEmitter } from "node:events";
import { io } from "socket.io-client";

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
];

class MessageQueue {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.batchSize = options.batchSize || 10;
    this.flushInterval = options.flushInterval || 50; // ms
    this.queue = [];
    this.processing = false;
    this.listeners = new Map();
    this.metrics = {
      queued: 0,
      processed: 0,
      dropped: 0,
      batches: 0
    };
  }

  enqueue(message, priority = 0) {
    if (this.queue.length >= this.maxSize) {
      // Drop lowest priority messages first
      const dropIndex = this.queue.findIndex(m => m.priority <= priority);
      if (dropIndex !== -1) {
        this.queue.splice(dropIndex, 1);
        this.metrics.dropped++;
      } else {
        // Drop oldest message
        this.queue.shift();
        this.metrics.dropped++;
      }
    }

    const msg = {
      ...message,
      priority,
      timestamp: Date.now(),
      id: crypto.randomUUID?.() || Math.random().toString(36)
    };

    // Insert by priority (higher priority first)
    const insertIndex = this.queue.findIndex(m => m.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(msg);
    } else {
      this.queue.splice(insertIndex, 0, msg);
    }

    this.metrics.queued++;
    this._scheduleFlush();
  }

  async processBatch() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const batch = this.queue.splice(0, Math.min(this.batchSize, this.queue.length));
    
    try {
      const results = await Promise.allSettled(
        batch.map(msg => this._processMessage(msg))
      );
      
      this.metrics.processed += results.length;
      this.metrics.batches++;
      
      // Handle failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(`Failed to process message ${batch[index].id}:`, result.reason);
        }
      });
    } finally {
      this.processing = false;
    }
  }

  async _processMessage(message) {
    const handler = this.listeners.get(message.type);
    if (handler) {
      await handler(message.data, message);
    } else {
      if (message.callback) {
        message.callback(message.data);
      }
    }
  }

  on(type, handler) {
    this.listeners.set(type, handler);
  }

  off(type) {
    this.listeners.delete(type);
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.processBatch();
    }, this.flushInterval);
  }

  clear() {
    this.queue.length = 0;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  size() {
    return this.queue.length;
  }

  getMetrics() {
    return { ...this.metrics, currentSize: this.queue.length };
  }
}

export class BotClient extends EventEmitter {
  constructor({
    serverUrl = "http://localhost:3000",
    avatarUrl = AVATAR_URLS[Math.floor(Math.random() * AVATAR_URLS.length)],
    name = "ClawBot",
  } = {}) {
    super();
    this.serverUrl = serverUrl;
    this.avatarUrl = avatarUrl;
    this.name = name;
    this.socket = null;
    this.id = null;
    this.room = null;
    this.position = null;
    this.rooms = [];
    this.characters = [];
    
    // Message queuing system
    this.messageQueue = new MessageQueue({
      maxSize: 500,         // Max queued messages
      batchSize: 5,         // Batch size for processing
      flushInterval: 25     // Process every 25ms
    });
    
    // Rate limiting
    this.rateLimits = {
      move: { last: 0, minInterval: 100 },      // 100ms between moves
      chat: { last: 0, minInterval: 500 },      // 500ms between messages
      emote: { last: 0, minInterval: 1000 },    // 1s between emotes
      dance: { last: 0, minInterval: 2000 }     // 2s between dances
    };
    
    // Memory management
    this.messageHistory = [];
    this.maxHistorySize = 100;
    this._setupQueueHandlers();
  }

  get connected() {
    return this.socket?.connected ?? false;
  }

  _setupQueueHandlers() {
    // Set up message queue handlers for different message types
    this.messageQueue.on('move', (data) => {
      if (this._checkRateLimit('move')) {
        this.socket.emit('move', data.from, data.to);
      }
    });

    this.messageQueue.on('chat', (data) => {
      if (this._checkRateLimit('chat')) {
        this.socket.emit('chatMessage', data.message);
      }
    });

    this.messageQueue.on('emote', (data) => {
      if (this._checkRateLimit('emote')) {
        this.socket.emit('emote:play', data.emoteName);
      }
    });

    this.messageQueue.on('dance', () => {
      if (this._checkRateLimit('dance')) {
        this.socket.emit('dance');
      }
    });
  }

  _checkRateLimit(action) {
    const limit = this.rateLimits[action];
    if (!limit) return true;
    
    const now = Date.now();
    if (now - limit.last < limit.minInterval) {
      return false;
    }
    
    limit.last = now;
    return true;
  }

  _cleanupOldMessages() {
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize / 2);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        transports: ["websocket"],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this.socket.once("welcome", (data) => {
        this.rooms = data.rooms;
        this.emit("welcome", data);
        resolve(data);
      });

      this.socket.once("connect_error", (err) => {
        reject(err);
      });

      // Event throttling for high-frequency events
      const throttledEvents = new Map();
      
      const throttle = (event, delay, callback) => {
        if (throttledEvents.has(event)) {
          clearTimeout(throttledEvents.get(event));
        }
        throttledEvents.set(event, setTimeout(callback, delay));
      };

      // Forward socket events with throttling
      this.socket.on("characters", (chars) => {
        throttle('characters', 50, () => {
          this.characters = chars;
          this.emit("characters", chars);
        });
      });

      this.socket.on("playerMove", (character) => {
        throttle('playerMove', 16, () => { // ~60fps
          this.emit("playerMove", character);
        });
      });

      this.socket.on("playerChatMessage", (data) => {
        this.messageHistory.push({ type: 'chat', data, timestamp: Date.now() });
        this._cleanupOldMessages();
        this.emit("chatMessage", data);
      });

      this.socket.on("emote:play", (data) => {
        this.messageHistory.push({ type: 'emote', data, timestamp: Date.now() });
        this._cleanupOldMessages();
        this.emit("emote", data);
      });

      this.socket.on("playerDance", (data) => {
        this.messageHistory.push({ type: 'dance', data, timestamp: Date.now() });
        this._cleanupOldMessages();
        this.emit("dance", data);
      });

      this.socket.on("characterJoined", (data) => {
        this.emit("characterJoined", data);
      });

      this.socket.on("characterLeft", (data) => {
        this.emit("characterLeft", data);
      });

      this.socket.on("playerSit", (data) => {
        this.emit("playerSit", data);
      });

      this.socket.on("waveAt", (data) => {
        this.emit("waveAt", data);
      });

      this.socket.on("mapUpdate", (data) => {
        this.room = data.map;
        this.characters = data.characters;
        if (this.id) {
          const own = data.characters.find((c) => c.id === this.id);
          if (own) {
            this.position = own.position;
          }
        }
        this.emit("mapUpdate", data);
      });

      this.socket.on("disconnect", () => {
        // Clear queues on disconnect
        this.messageQueue.clear();
        this.emit("disconnected");
      });
    });
  }

  getMetrics() {
    return {
      connected: this.connected,
      queueSize: this.messageQueue.size(),
      queueMetrics: this.messageQueue.getMetrics(),
      messageHistory: this.messageHistory.length,
      position: this.position,
      room: this.room ? { id: this.room.id, size: this.room.size } : null
    };
  }

  join(roomId) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error("Not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Join timeout"));
      }, 5000);

      this.socket.once("roomJoined", (data) => {
        clearTimeout(timeout);
        this.id = data.id;
        this.room = data.map;
        this.characters = data.characters;
        const own = data.characters.find((c) => c.id === this.id);
        if (own) {
          this.position = own.position;
        }
        this.emit("joined", data);
        resolve(data);
      });

      this.socket.emit("joinRoom", roomId, {
        avatarUrl: this.avatarUrl,
        isBot: true,
        name: this.name,
      });
    });
  }

  leave() {
    if (!this.socket || !this.room) {
      return;
    }
    
    // Clear queued messages when leaving room
    this.messageQueue.clear();
    this.socket.emit("leaveRoom");
    this.room = null;
    this.position = null;
    this.id = null;
    this.characters = [];
  }

  switchRoom(roomId) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error("Not connected"));
        return;
      }

      // Clear queued messages when switching rooms
      this.messageQueue.clear();

      const timeout = setTimeout(() => {
        reject(new Error("Switch room timeout"));
      }, 5000);

      this.socket.once("roomJoined", (data) => {
        clearTimeout(timeout);
        this.id = data.id;
        this.room = data.map;
        this.characters = data.characters;
        const own = data.characters.find((c) => c.id === this.id);
        if (own) {
          this.position = own.position;
        }
        this.emit("joined", data);
        resolve(data);
      });

      this.socket.emit("switchRoom", roomId);
    });
  }

  move(toGridPos) {
    if (this.position === null) {
      throw new Error("Cannot move: not in a room");
    }
    if (!Array.isArray(toGridPos) || toGridPos.length !== 2) {
      throw new Error("Invalid target: must be [x, y] array");
    }
    
    // Queue the move instead of sending immediately
    this.messageQueue.enqueue({
      type: 'move',
      data: { from: this.position, to: toGridPos }
    }, 2); // Medium priority
    
    // Optimistically update position
    this.position = toGridPos;
  }

  say(message) {
    if (!this.socket || !this.id) {
      throw new Error("Cannot say: not connected or not in a room");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("Message must be a non-empty string");
    }
    
    // Queue chat messages with high priority
    this.messageQueue.enqueue({
      type: 'chat',
      data: { message }
    }, 3); // High priority
  }

  emote(emoteName) {
    if (!this.socket || !this.room) {
      throw new Error("Cannot emote: not in a room");
    }
    
    // Queue emotes with low priority
    this.messageQueue.enqueue({
      type: 'emote',
      data: { emoteName }
    }, 1); // Low priority
  }

  dance() {
    if (!this.socket || !this.room) {
      throw new Error("Cannot dance: not in a room");
    }
    
    // Queue dance with low priority
    this.messageQueue.enqueue({
      type: 'dance',
      data: {}
    }, 1); // Low priority
  }

  placeItem(itemName, gridPosition, rotation = 0) {
    if (!this.socket || !this.room) {
      throw new Error("Cannot place item: not in a room");
    }
    
    // Queue item placement with medium priority
    this.messageQueue.enqueue({
      type: 'placeItem',
      data: { itemName, gridPosition, rotation }
    }, 2); // Medium priority
  }

  observe() {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.room) {
        reject(new Error("Cannot observe: not in a room"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Observe timeout"));
      }, 5000);

      this.socket.once("roomObserved", (data) => {
        clearTimeout(timeout);
        this.room = data.map;
        this.characters = data.characters;
        if (this.id) {
          const own = data.characters.find((c) => c.id === this.id);
          if (own) {
            this.position = own.position;
          }
        }
        resolve(data);
      });

      this.socket.emit("observeRoom");
    });
  }

  disconnect() {
    if (this.socket) {
      // Clear all queued messages
      this.messageQueue.clear();
      this.socket.disconnect();
    }
    
    this.room = null;
    this.position = null;
    this.id = null;
    this.rooms = [];
    this.characters = [];
    this.messageHistory = [];
  }
}