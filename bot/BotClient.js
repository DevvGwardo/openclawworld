import { EventEmitter } from "node:events";
import { io } from "socket.io-client";

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
];

export class BotClient extends EventEmitter {
  constructor({
    serverUrl = "http://localhost:3000",
    avatarUrl = AVATAR_URLS[Math.floor(Math.random() * AVATAR_URLS.length)],
    name = "ClawBot",
    apiKey = null,
  } = {}) {
    super();
    this.serverUrl = serverUrl;
    this.avatarUrl = avatarUrl;
    this.name = name;
    this.apiKey = apiKey;
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
      const auth = this.apiKey ? { token: this.apiKey } : undefined;
      this.socket = io(this.serverUrl, {
        transports: ["websocket"],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth,
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

      this.socket.on("directMessage", (data) => {
        this.emit("directMessage", data);
      });

      this.socket.on("emote:play", (data) => {
        this.emit("emote", data);
      });

      this.socket.on("playerDance", (data) => {
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

      this.socket.on("rooms", (roomsList) => {
        this.rooms = roomsList;
        this.emit("roomsUpdate", roomsList);
      });

      this.socket.on("roomsUpdate", (activeRooms) => {
        // Merge active room data into existing rooms list
        const activeMap = new Map(activeRooms.map(r => [r.id, r]));
        for (let i = 0; i < this.rooms.length; i++) {
          if (activeMap.has(this.rooms[i].id)) {
            this.rooms[i] = { ...this.rooms[i], ...activeMap.get(this.rooms[i].id) };
          }
        }
        this.emit("roomsUpdate", this.rooms);
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

      this.socket.on("character:stateChange", (data) => {
        this.emit("stateChange", data);
      });

      this.socket.on("motives:update", (data) => {
        this.emit("motivesUpdate", data);
      });

      this.socket.on("moveError", (data) => {
        this.emit("moveError", data);
      });

      this.socket.on("interactError", (data) => {
        this.emit("interactError", data);
      });

      this.socket.on("objectives:init", (data) => {
        this.emit("objectivesInit", data);
      });

      this.socket.on("objectives:progress", (data) => {
        this.emit("objectivesProgress", data);
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
        this.invitedBy = data.invitedBy || null;
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

  switchRoom(roomId) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error("Not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Switch room timeout"));
      }, 5000);

      this.socket.once("roomJoined", (data) => {
        clearTimeout(timeout);
        this.id = data.id;
        this.room = data.map;
        this.characters = data.characters;
        this.invitedBy = data.invitedBy || null;
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
    const prevPosition = this.position;
    this.socket.emit("move", this.position, toGridPos);
    this.position = toGridPos;
    // Revert optimistic position if server rejects the move
    this.socket.once("moveError", () => {
      this.position = prevPosition;
    });
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

  whisper(targetId, message) {
    if (!this.socket || !this.id) {
      throw new Error("Cannot whisper: not connected or not in a room");
    }
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("Invalid targetId for whisper");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("Message must be a non-empty string");
    }
    this.socket.emit("directMessage", { targetId, message: message.slice(0, 500) });
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

  placeItem(itemName, gridPosition, rotation = 0) {
    if (!this.socket || !this.room) {
      throw new Error("Cannot place item: not in a room");
    }
    this.socket.emit("placeItem", { itemName, gridPosition, rotation });
  }

  claimApartment(roomId) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error("Not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Claim apartment timeout"));
      }, 5000);

      this.socket.emit("claimApartment", roomId, (result) => {
        clearTimeout(timeout);
        if (result && result.success) {
          // Update local room list with new name
          const localRoom = this.rooms.find((r) => r.id === roomId);
          if (localRoom) {
            localRoom.name = result.name;
            localRoom.claimedBy = this.name;
          }
          resolve(result);
        } else {
          reject(new Error(result?.error || "Failed to claim apartment"));
        }
      });
    });
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

  interact(itemName) {
    if (!this.socket || !this.room) {
      throw new Error("Cannot interact: not in a room");
    }
    this.socket.emit("interact:object", { itemName });
  }

  cancelInteraction() {
    if (!this.socket || !this.room) {
      throw new Error("Cannot cancel interaction: not in a room");
    }
    this.socket.emit("interaction:cancel");
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
