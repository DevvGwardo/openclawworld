import { EventEmitter } from "node:events";
import { io } from "socket.io-client";

export class BotClient extends EventEmitter {
  constructor({
    serverUrl = "http://localhost:3000",
    avatarUrl = "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
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
