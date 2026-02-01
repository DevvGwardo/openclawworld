import { EventEmitter } from "node:events";
import { io } from "socket.io-client";

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb",
  "https://models.readyplayer.me/65893b0514f9f5f28e61d783.glb",
  "https://models.readyplayer.me/62ea7bc28a6d28ec134bbcce.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
];

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
  }

  get connected() {
    return this.socket?.connected ?? false;
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

      // Forward socket events to BotClient EventEmitter
      this.socket.on("characters", (chars) => {
        this.characters = chars;
        this.emit("characters", chars);
      });

      this.socket.on("playerMove", (character) => {
        this.emit("playerMove", character);
      });

      this.socket.on("playerChatMessage", (data) => {
        this.emit("chatMessage", data);
      });

      this.socket.on("emote:play", (data) => {
        this.emit("emote", data);
      });

      this.socket.on("playerDance", (data) => {
        this.emit("dance", data);
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
        this.emit("disconnected");
      });
    });
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
    this.socket.emit("leaveRoom");
    this.room = null;
    this.position = null;
    this.id = null;
    this.characters = [];
  }

  move(toGridPos) {
    if (this.position === null) {
      throw new Error("Cannot move: not in a room");
    }
    if (!Array.isArray(toGridPos) || toGridPos.length !== 2) {
      throw new Error("Invalid target: must be [x, y] array");
    }
    this.socket.emit("move", this.position, toGridPos);
    this.position = toGridPos;
  }

  say(message) {
    if (!this.socket || !this.id) {
      throw new Error("Cannot say: not connected or not in a room");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("Message must be a non-empty string");
    }
    this.socket.emit("chatMessage", message);
  }

  emote(emoteName) {
    if (!this.socket || !this.room) {
      throw new Error("Cannot emote: not in a room");
    }
    this.socket.emit("emote:play", emoteName);
  }

  dance() {
    if (!this.socket || !this.room) {
      throw new Error("Cannot dance: not in a room");
    }
    this.socket.emit("dance");
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.room = null;
    this.position = null;
    this.id = null;
    this.rooms = [];
    this.characters = [];
  }
}
