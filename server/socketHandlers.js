import bcrypt from "bcrypt";

/**
 * Registers all Socket.IO connection and event handlers.
 *
 * @param {object} deps - every dependency previously closed-over in index.js
 */
export function registerSocketHandlers(deps) {
  const {
    io,
    rooms,
    items,
    itemsCatalog,
    findPath,
    updateGrid,
    addItemToGrid,
    persistRooms,
    broadcastToRoom,
    stripCharacters,
    generateRandomPosition,
    unsitCharacter,
    ensureSeatMaps,
    getSitSpots,
    normalizeAngle,
    DEFAULT_SIT_FACING_OFFSET,
    sanitizeAvatarUrl,
    ALLOWED_EMOTES,
    OBJECT_AFFORDANCES,
    MOTIVE_CLAMP,
    bonds,
    bondKey,
    getBondLevel,
    BOND_LEVELS,
    saveBonds,
    botRegistry,
    botSockets,
    sendWebhook,
    playerCoins,
    DEFAULT_COINS,
    updateCoins,
    activeQuests,
    checkQuestCompletion,
    moltbookSystem,
    tryPlaceItemInRoom,
    _prevMotiveBuckets,
    getCachedRoom,
    getAllCachedRooms,
    getOrLoadRoom,
    setCachedRoom,
    scheduleEviction,
    cancelEviction,
    hydrateRoom,
    isDbAvailable,
    dbListRooms,
    dbCountRooms,
    ROOM_ZONES,
    limitChat,
  } = deps;

  // Destructure moltbook system parts
  const {
    moltbookVirtualBots,
    pendingBuilds,
    THINKING_PHRASES,
  } = moltbookSystem;

  io.on("connection", async (socket) => {
    try {
      let room = null;
      let character = null;

      // Send welcome with room list
      const welcomeRooms = isDbAvailable()
        ? await (async () => {
            const dbRooms = await dbListRooms({ offset: 0, limit: 50 });
            // Merge character counts from cache
            for (const r of dbRooms) {
              const cached = getCachedRoom(r.id);
              if (cached) r.nbCharacters = cached.characters.length;
            }
            return dbRooms;
          })()
        : getAllCachedRooms().map((room) => ({
            id: room.id,
            name: room.name,
            nbCharacters: room.characters.length,
            claimedBy: room.claimedBy || null,
            generated: room.generated || false,
          }));
      const totalRooms = isDbAvailable() ? await dbCountRooms() : welcomeRooms.length;

      socket.emit("welcome", {
        rooms: welcomeRooms,
        totalRooms,
        items,
        moltbookPosts: moltbookSystem.moltbookPostPool.map((p) => ({
          id: p.id,
          title: p.title || "",
          content: (p.content || "").slice(0, 300),
          authorName: p.author?.name || p.author_name || "",
          submoltName: p.submolt?.display_name || p.submolt_display_name || "",
          upvotes: p.upvotes || 0,
          downvotes: p.downvotes || 0,
          commentCount: p.comment_count || 0,
          createdAt: p.created_at || "",
        })),
      });

      socket.on("joinRoom", async (roomId, opts) => {
        room = getCachedRoom(roomId) || await getOrLoadRoom(roomId, hydrateRoom);
        if (!room) {
          return;
        }
        cancelEviction(room.id);
        socket.join(room.id);
        character = {
          id: socket.id,
          session: parseInt(Math.random() * 1000),
          position: generateRandomPosition(room),
          avatarUrl: sanitizeAvatarUrl(opts.avatarUrl),
          isBot: opts.isBot === true,
          name: opts.name || null,
          coins: DEFAULT_COINS,
          motives: { energy: 100, social: 100, fun: 100, hunger: 100 },
          interactionState: null,
        };
        playerCoins.set(socket.id, DEFAULT_COINS);
        if (!room.password) character.canUpdateRoom = true;
        room.characters.push(character);

        socket.emit("roomJoined", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
          coins: DEFAULT_COINS,
          hasPassword: !!room.password,
        });
        // Notify other players in the room about the new character (excludes the joiner)
        socket.broadcast.to(room.id).emit("characterJoined", {
          character: stripCharacters([character])[0],
          roomName: room.name,
        });
        onRoomUpdate();
      });

      socket.on("observeRoom", () => {
        if (!room) return;
        socket.emit("roomObserved", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
        });
      });

      // Debounce room updates so rapid join/leave/disconnect events within the
      // same tick coalesce into a single broadcast instead of hammering clients.
      let roomUpdateTimer = null;
      const onRoomUpdate = () => {
        if (roomUpdateTimer) return; // already scheduled
        roomUpdateTimer = setTimeout(() => {
          roomUpdateTimer = null;
          // Only broadcast active rooms (those with characters) as a partial update
          const activeRooms = getAllCachedRooms()
            .filter(r => r.characters.length > 0)
            .map(r => ({
              id: r.id,
              name: r.name,
              nbCharacters: r.characters.length,
              claimedBy: r.claimedBy || null,
              generated: r.generated || false,
            }));
          io.emit("roomsUpdate", activeRooms);
        }, 0); // next tick - coalesces synchronous calls within the same event
      };

      socket.on("leaveRoom", () => {
        if (!room) {
          return;
        }
        // Clear interaction state and motive tracking on leave
        if (character && character.interactionState) {
          character.interactionState = null;
        }
        _prevMotiveBuckets.delete(socket.id);
        const leavingName = character?.name || "Player";
        const leavingIsBot = character?.isBot || false;
        const leavingId = socket.id;
        const roomName = room.name;
        socket.leave(room.id);
        room.characters.splice(
          room.characters.findIndex((character) => character.id === socket.id),
          1
        );
        io.to(room.id).emit("characterLeft", {
          id: leavingId,
          name: leavingName,
          isBot: leavingIsBot,
          roomName: roomName,
        });
        if (room.characters.length === 0) scheduleEviction(room.id);
        onRoomUpdate();
        room = null;
      });

      socket.on("claimApartment", (targetRoomId, callback) => {
        if (!character || !character.isBot) {
          if (typeof callback === "function") callback({ success: false, error: "Only bots can claim apartments" });
          return;
        }
        const targetRoom = rooms.find((r) => r.id === targetRoomId);
        if (!targetRoom) {
          if (typeof callback === "function") callback({ success: false, error: "Room not found" });
          return;
        }
        if (!targetRoom.generated) {
          if (typeof callback === "function") callback({ success: false, error: "Can only claim generated rooms" });
          return;
        }
        // Check if already claimed by another bot
        if (targetRoom.claimedBy && targetRoom.claimedBy !== character.name) {
          if (typeof callback === "function") callback({ success: false, error: "Already claimed by " + targetRoom.claimedBy });
          return;
        }
        // Claim the apartment
        targetRoom.claimedBy = character.name;
        targetRoom.name = character.name + "'s Apartment";
        persistRooms(targetRoom);
        onRoomUpdate();
        if (typeof callback === "function") callback({ success: true, roomId: targetRoom.id, name: targetRoom.name });
      });

      socket.on("switchRoom", async (targetRoomId) => {
        // Clear interaction state on room switch
        if (character && character.interactionState) {
          character.interactionState = null;
        }
        unsitCharacter(room, socket.id, broadcastToRoom);
        // Leave current room
        if (room) {
          const leavingName = character?.name || "Player";
          const leavingIsBot = character?.isBot || false;
          const leavingId = socket.id;
          const oldRoomName = room.name;
          const oldRoomId = room.id;
          socket.leave(room.id);
          const idx = room.characters.findIndex((c) => c.id === socket.id);
          if (idx !== -1) room.characters.splice(idx, 1);
          io.to(oldRoomId).emit("characterLeft", {
            id: leavingId,
            name: leavingName,
            isBot: leavingIsBot,
            roomName: oldRoomName,
          });
          // Schedule eviction if room is now empty
          if (room.characters.length === 0) scheduleEviction(room.id);
          onRoomUpdate();
        }

        // Join target room (lazy load from DB or auto-create)
        room = getCachedRoom(targetRoomId) || await getOrLoadRoom(targetRoomId, hydrateRoom);

        // Auto-create generated rooms on demand (room-N where N is 1-100000)
        if (!room) {
          const match = targetRoomId.match(/^room-(\d+)$/);
          if (match) {
            const n = parseInt(match[1]);
            if (n >= 1 && n <= 100000) {
              room = hydrateRoom({
                id: targetRoomId,
                name: "Room " + n,
                size: [15, 15],
                gridDivision: 2,
                items: [],
                generated: true,
                claimedBy: null,
                password: null,
              });
              setCachedRoom(room);
              persistRooms(room);
            }
          }
        }

        if (!room) {
          socket.emit("switchRoomError", { error: "Room not found" });
          return;
        }
        cancelEviction(room.id);
        socket.join(room.id);
        character.position = generateRandomPosition(room);
        character.path = [];
        character.canUpdateRoom = !room.password;
        room.characters.push(character);

        socket.emit("roomJoined", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
          hasPassword: !!room.password,
        });
        socket.broadcast.to(room.id).emit("characterJoined", {
          character: stripCharacters([character])[0],
          roomName: room.name,
        });
        onRoomUpdate();
      });

      socket.on("characterAvatarUpdate", (avatarUrl) => {
        if (!room) return;
        character.avatarUrl = sanitizeAvatarUrl(avatarUrl);
        io.to(room.id).emit("characterUpdated", {
          id: character.id,
          avatarUrl: character.avatarUrl,
        });
      });

      socket.on("sit", (itemIndex) => {
        if (!room) return;
        if (typeof itemIndex !== "number" || itemIndex < 0 || itemIndex >= room.items.length) return;
        const item = room.items[itemIndex];
        if (!item) return;
        const itemDef = itemsCatalog[item.name];
        if (!itemDef || !itemDef.sittable) return;
        // Use catalog sittable data
        const sittable = itemDef.sittable;
        const facingOffset = sittable.facingOffset ?? DEFAULT_SIT_FACING_OFFSET;
        ensureSeatMaps(room);

        // Already sitting? unsit first
        unsitCharacter(room, socket.id, broadcastToRoom);

        const allSpots = getSitSpots(room, item, sittable, facingOffset);
        // Filter to walkable & unoccupied spots
        let available = allSpots.filter((s) => {
          if (room.seatOccupancy.has(itemIndex + "-" + s.seatIdx)) return false;
          return room.grid.isWalkableAt(s.walkTo[0], s.walkTo[1]);
        });

        // Prefer the furniture-facing edge (prevents "sit backwards" when clicking
        // from the wrong side / while facing away from the chair).
        if (available.length > 0 && sittable.preferFacing !== false) {
          const desired = normalizeAngle(((item.rotation || 0) * Math.PI) / 2 + facingOffset);
          const angleDelta = (a, b) => {
            const d = Math.abs(a - b) % (Math.PI * 2);
            return d > Math.PI ? (Math.PI * 2) - d : d;
          };
          const preferred = available.filter((s) => angleDelta(s.seatRotation, desired) < 0.01);
          if (preferred.length > 0) available = preferred;
        }

        // Enforce seat limit
        let occupiedCount = 0;
        for (const [key] of room.seatOccupancy) {
          if (key.startsWith(itemIndex + "-")) occupiedCount++;
        }
        if (occupiedCount >= sittable.seats) return; // furniture full

        if (available.length === 0) return;

        // Pick spot.
        // For single-seat furniture (chairs/ottomans), prefer the side that matches the
        // furniture rotation so the avatar faces the same direction as the chair.
        const pos = character.position || [0, 0];

        const distSq = (s) => (s.walkTo[0] - pos[0]) ** 2 + (s.walkTo[1] - pos[1]) ** 2;
        const angleDelta = (a, b) => {
          // smallest absolute difference between two angles (wrap at 2PI)
          const d = Math.abs(a - b) % (Math.PI * 2);
          return d > Math.PI ? (Math.PI * 2) - d : d;
        };

        if (sittable.seats === 1) {
          const desired = normalizeAngle(((item.rotation || 0) * Math.PI) / 2 + facingOffset);
          available.sort((a, b) => {
            const da = angleDelta(a.seatRotation, desired);
            const db = angleDelta(b.seatRotation, desired);
            if (da !== db) return da - db;
            return distSq(a) - distSq(b);
          });
        } else {
          // Default: nearest spot to character
          available.sort((a, b) => distSq(a) - distSq(b));
        }

        const spot = available[0];

        // Pathfind to walkTo position
        const path = findPath(room, pos, spot.walkTo);
        if (!path) return;

        // Reserve seat
        room.seatOccupancy.set(itemIndex + "-" + spot.seatIdx, socket.id);
        room.characterSeats.set(socket.id, {
          itemIndex,
          seatIdx: spot.seatIdx,
          seatPos: spot.seatPos,
          seatHeight: spot.seatHeight,
          seatRotation: spot.seatRotation,
        });

        character.position = pos;
        character.path = path;
        if (path.length > 0) {
          character.position = path[path.length - 1];
        }

        // Broadcast sit event
        io.to(room.id).emit("playerSit", {
          id: socket.id,
          path,
          seatPos: spot.seatPos,
          seatHeight: spot.seatHeight,
          seatRotation: spot.seatRotation,
          itemIndex,
        });
      });

      socket.on("move", (from, to) => {
        if (!room) return;
        // Auto-cancel interruptible interaction on move; block if non-interruptible
        if (character && character.interactionState) {
          if (!character.interactionState.interruptible) {
            socket.emit("moveError", { error: "Cannot move during non-interruptible interaction" });
            return;
          }
          // Partial gain on cancel
          const st = character.interactionState;
          const aff = st.affordance;
          if (aff) {
            const elapsed = Date.now() - (st.endsAt - aff.duration);
            const ratio = Math.max(0, Math.min(1, elapsed / aff.duration));
            for (const [key, amount] of Object.entries(aff.satisfies)) {
              character.motives[key] = Math.min(MOTIVE_CLAMP.max, character.motives[key] + amount * ratio);
            }
          }
          character.interactionState = null;
          io.to(room.id).emit("character:stateChange", {
            id: socket.id,
            state: null,
            motives: character.motives,
          });
        }
        unsitCharacter(room, socket.id, broadcastToRoom);
        const path = findPath(room, from, to);
        if (!path) {
          return;
        }
        character.position = from;
        character.path = path;
        io.to(room.id).emit("playerMove", character);
        // Update position to path endpoint so subsequent characters/mapUpdate
        // broadcasts reflect where the player is headed, not where they started.
        // (Bots already do this; players need it too to prevent rubber-banding.)
        if (path.length > 0) {
          character.position = path[path.length - 1];
        }
      });

      // --- Object Interaction System ---
      socket.on("interact:object", ({ itemName }) => {
        if (!room || !character) return;
        if (character.interactionState) {
          socket.emit("interactError", { error: "Already interacting" });
          return;
        }
        // Validate affordance exists
        const affordance = OBJECT_AFFORDANCES[itemName];
        if (!affordance) {
          socket.emit("interactError", { error: "No affordance for item" });
          return;
        }
        // Check the item exists in the room (eatSpot is a virtual affordance — always allowed)
        if (itemName !== "eatSpot") {
          const roomItem = room.items.find(i => i.name === itemName);
          if (!roomItem) {
            socket.emit("interactError", { error: "Item not in room" });
            return;
          }
        }
        character.interactionState = {
          target: itemName,
          interactionType: itemName,
          endsAt: Date.now() + affordance.duration,
          interruptible: affordance.interruptible,
          affordance,
        };
        const { affordance: _aff, ...cleanState } = character.interactionState;
        io.to(room.id).emit("character:stateChange", {
          id: socket.id,
          state: cleanState,
          motives: character.motives,
        });
      });

      socket.on("interaction:cancel", () => {
        if (!room || !character || !character.interactionState) return;
        if (!character.interactionState.interruptible) {
          socket.emit("interactError", { error: "Interaction is not interruptible" });
          return;
        }
        const st = character.interactionState;
        const aff = st.affordance;
        if (aff) {
          const elapsed = Date.now() - (st.endsAt - aff.duration);
          const ratio = Math.max(0, Math.min(1, elapsed / aff.duration));
          for (const [key, amount] of Object.entries(aff.satisfies)) {
            character.motives[key] = Math.min(MOTIVE_CLAMP.max, character.motives[key] + amount * ratio);
          }
        }
        character.interactionState = null;
        io.to(room.id).emit("character:stateChange", {
          id: socket.id,
          state: null,
          motives: character.motives,
        });
      });

      socket.on("dance", () => {
        if (!room) return;
        unsitCharacter(room, socket.id, broadcastToRoom);
        io.to(room.id).emit("playerDance", {
          id: socket.id,
        });
      });

      socket.on("emote:play", (emoteName) => {
        if (!room) return;
        if (typeof emoteName !== "string") return;
        if (!ALLOWED_EMOTES.includes(emoteName)) return;
        io.to(room.id).emit("emote:play", {
          id: socket.id,
          emote: emoteName,
        });
      });

      socket.on("wave:at", (targetId) => {
        if (!room) return;
        if (typeof targetId !== "string") return;
        unsitCharacter(room, socket.id, broadcastToRoom);
        // Find target character in room
        const target = room.characters.find((c) => c.id === targetId);
        if (!target) return;
        // Broadcast the directed wave
        io.to(room.id).emit("playerWaveAt", {
          id: socket.id,
          targetId: targetId,
        });
        // Also play the wave emote animation
        io.to(room.id).emit("emote:play", {
          id: socket.id,
          emote: "wave",
        });
        // Bond system - increment bond score on wave
        const senderName = character?.name;
        const targetName = target?.name;
        if (senderName && targetName && senderName.toLowerCase() !== targetName.toLowerCase()) {
          const key = bondKey(senderName, targetName);
          const bond = bonds.get(key) || { score: 0, lastWave: 0 };
          const now = Date.now();
          if (now - bond.lastWave >= 10000) { // 10s cooldown
            bond.score += 1;
            bond.lastWave = now;
            bonds.set(key, bond);
            saveBonds();
            const level = getBondLevel(bond.score);
            const levelLabel = BOND_LEVELS[level].label;
            const maxLevel = level === BOND_LEVELS.length - 1;
            const nextThreshold = maxLevel ? null : BOND_LEVELS[level + 1].threshold;
            const update = { score: bond.score, level, levelLabel, nextThreshold, maxLevel };
            // Send bondUpdate to both sender and target
            socket.emit("bondUpdate", { peerName: targetName, ...update });
            const targetSocket = room.characters.find(c => c.id === targetId);
            if (targetSocket) {
              io.to(targetId).emit("bondUpdate", { peerName: senderName, ...update });
            }
            // Broadcast bondFormed if just reached max level
            if (maxLevel && bond.score === BOND_LEVELS[BOND_LEVELS.length - 1].threshold) {
              io.to(room.id).emit("bondFormed", { nameA: senderName, nameB: targetName });
            }
          }
        }
      });

      // Bond system - query bond info
      socket.on("bond:query", (targetName) => {
        if (!room || !character) return;
        if (typeof targetName !== "string") return;
        const senderName = character.name;
        if (!senderName) return;
        const key = bondKey(senderName, targetName);
        const bond = bonds.get(key) || { score: 0, lastWave: 0 };
        const level = getBondLevel(bond.score);
        const maxLevel = level === BOND_LEVELS.length - 1;
        socket.emit("bondInfo", {
          peerName: targetName,
          score: bond.score,
          level,
          levelLabel: BOND_LEVELS[level].label,
          nextThreshold: maxLevel ? null : BOND_LEVELS[level + 1].threshold,
          maxLevel,
        });
      });

      // Bond system - bond-locked emotes (require max bond level)
      socket.on("bond:emote", ({ emote, targetId: bTargetId }) => {
        if (!room || !character) return;
        if (typeof emote !== "string" || typeof bTargetId !== "string") return;
        if (!["highfive", "hug"].includes(emote)) return;
        const target = room.characters.find(c => c.id === bTargetId);
        if (!target) return;
        const senderName = character.name;
        const targetName = target.name;
        if (!senderName || !targetName) return;
        const key = bondKey(senderName, targetName);
        const bond = bonds.get(key) || { score: 0, lastWave: 0 };
        const level = getBondLevel(bond.score);
        if (level < BOND_LEVELS.length - 1) return; // must be max bond
        io.to(room.id).emit("bondEmote:play", {
          id: socket.id,
          targetId: bTargetId,
          emote,
        });
      });

      socket.on("chatMessage", (message) => {
        if (!room) return;
        const socketIp = socket.handshake.headers["x-forwarded-for"]?.split(",")[0]?.trim() || socket.handshake.address;
        if (limitChat(socketIp)) {
          socket.emit("rateLimited", { message: "You are sending messages too fast." });
          return;
        }
        io.to(room.id).emit("playerChatMessage", {
          id: socket.id,
          message,
        });
      });

      // Search users across all rooms (for invite feature)
      socket.on("searchUsers", (query, callback) => {
        if (typeof callback !== "function") return;
        if (!character || !room) return callback({ success: false, error: "Not in a room" });
        if (typeof query !== "string" || query.trim().length === 0) return callback({ success: true, results: [] });
        const q = query.trim().toLowerCase();
        const results = [];
        for (const r of rooms) {
          for (const c of r.characters) {
            if (c.id === socket.id) continue; // skip self
            if (r.id === room.id) continue; // skip users already in requester's room
            if (!c.name || c.name.length === 0) continue;
            if (c.name.toLowerCase().includes(q)) {
              results.push({ id: c.id, name: c.name, isBot: !!c.isBot, roomId: r.id, roomName: r.name });
              if (results.length >= 20) break;
            }
          }
          if (results.length >= 20) break;
        }
        callback({ success: true, results });
      });

      // Browse all online users in OTHER rooms (for invite modal)
      socket.on("getOnlineUsers", (callback) => {
        if (typeof callback !== "function") return;
        if (!character || !room) return callback({ success: false, error: "Not in a room" });
        const grouped = [];
        let total = 0;
        for (const r of rooms) {
          if (r.id === room.id) continue; // skip requester's room
          const users = [];
          for (const c of r.characters) {
            if (c.id === socket.id) continue;
            if (!c.name || c.name.length === 0) continue;
            users.push({ id: c.id, name: c.name, isBot: !!c.isBot });
            total++;
            if (total >= 100) break;
          }
          if (users.length > 0) {
            grouped.push({ roomId: r.id, roomName: r.name, users });
          }
          if (total >= 100) break;
        }
        callback({ success: true, rooms: grouped });
      });

      // Invite a user to join your room
      socket.on("inviteToRoom", (targetId, callback) => {
        if (typeof callback !== "function") return;
        if (!character || !room) return callback({ success: false, error: "Not in a room" });
        if (typeof targetId !== "string") return callback({ success: false, error: "Invalid target" });
        // Find the target across all rooms
        let targetChar = null;
        let targetRoom = null;
        for (const r of rooms) {
          const found = r.characters.find(c => c.id === targetId);
          if (found) { targetChar = found; targetRoom = r; break; }
        }
        if (!targetChar) return callback({ success: false, error: "User not found or offline" });
        if (targetRoom.id === room.id) return callback({ success: false, error: "Already in the same room" });
        io.to(targetId).emit("roomInvite", {
          inviteId: "inv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
          fromId: socket.id,
          fromName: character.name || "Player",
          fromIsBot: !!character.isBot,
          roomId: room.id,
          roomName: room.name,
          timestamp: Date.now(),
        });
        callback({ success: true });
      });

      // Paginated room list for room browser
      socket.on("requestRooms", async ({ offset = 0, limit = 30, search = "" } = {}, callback) => {
        if (typeof callback !== "function") return;
        try {
          if (isDbAvailable()) {
            const rooms = await dbListRooms({ offset, limit, search });
            // Merge character counts from cache
            for (const r of rooms) {
              const cached = getCachedRoom(r.id);
              if (cached) r.nbCharacters = cached.characters.length;
            }
            const total = await dbCountRooms(search);
            callback({ success: true, rooms, total });
          } else {
            const allRooms = getAllCachedRooms();
            const filtered = search
              ? allRooms.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
              : allRooms;
            const total = filtered.length;
            const page = filtered.slice(offset, offset + limit).map(r => ({
              id: r.id,
              name: r.name,
              nbCharacters: r.characters.length,
              claimedBy: r.claimedBy || null,
              generated: r.generated || false,
            }));
            callback({ success: true, rooms: page, total });
          }
        } catch (err) {
          console.error("[requestRooms] Error:", err);
          callback({ success: false, error: "Server error" });
        }
      });

      // Direct/Whisper messages
      socket.on("directMessage", ({ targetId, message }) => {
        if (!room) return;
        if (typeof targetId !== "string" || typeof message !== "string") return;
        const trimmed = message.slice(0, 500);
        const senderName = character?.name || "Player";
        const senderIsBot = character?.isBot || false;
        // Send to target
        io.to(targetId).emit("directMessage", {
          senderId: socket.id,
          senderName,
          senderIsBot,
          message: trimmed,
          timestamp: Date.now(),
        });
        // Confirm to sender
        socket.emit("directMessageSent", {
          targetId,
          message: trimmed,
          timestamp: Date.now(),
        });
      });

      // Quest-related socket events
      socket.on("getQuests", (botId) => {
        if (!room) return;
        // Find which bot registry entry owns this character
        let quests = [];
        for (const [, reg] of botRegistry) {
          if (reg.quests && reg.quests.length > 0) {
            // Match by checking if the bot's virtual socket character id matches
            const conn = [...botSockets.values()].find(c => c.botId === botId);
            if (conn) {
              for (const [key, val] of botSockets) {
                if (val.botId === botId) {
                  const regEntry = botRegistry.get(key);
                  if (regEntry && regEntry.quests) quests = regEntry.quests;
                  break;
                }
              }
            }
          }
        }
        // Also check moltbook bots (they don't have quests)
        socket.emit("questsAvailable", { botId, quests });
      });

      socket.on("acceptQuest", ({ botId, questId }) => {
        if (!room || !character) return;
        const questKey = socket.id + "-" + questId;
        if (activeQuests.has(questKey)) {
          socket.emit("questError", { error: "Quest already active" });
          return;
        }
        // Find quest
        let quest = null;
        for (const [, reg] of botRegistry) {
          if (reg.quests) {
            quest = reg.quests.find(q => q.id === questId);
            if (quest) break;
          }
        }
        if (!quest) {
          socket.emit("questError", { error: "Quest not found" });
          return;
        }
        activeQuests.set(questKey, {
          socketId: socket.id,
          questId,
          botId,
          quest,
          progress: {},
          acceptedAt: Date.now(),
        });
        socket.emit("questAccepted", { questId, quest });
      });

      // Bot shop events
      socket.on("getBotShop", (botId) => {
        if (!room) return;
        let shop = [];
        for (const [key, val] of botSockets) {
          if (val.botId === botId) {
            const reg = botRegistry.get(key);
            if (reg && reg.shop) shop = reg.shop;
            break;
          }
        }
        socket.emit("botShopInventory", { botId, items: shop });
      });

      socket.on("buyFromBot", ({ botId, itemName }) => {
        if (!room || !character) return;
        // Find shop item
        let shopItem = null;
        for (const [key, val] of botSockets) {
          if (val.botId === botId) {
            const reg = botRegistry.get(key);
            if (reg && reg.shop) {
              shopItem = reg.shop.find(s => s.item === itemName);
            }
            break;
          }
        }
        if (!shopItem) {
          socket.emit("purchaseError", { error: "Item not found in shop" });
          return;
        }
        const coins = playerCoins.get(socket.id) || 0;
        if (coins < shopItem.price) {
          socket.emit("purchaseError", { error: "Insufficient coins", required: shopItem.price, have: coins });
          return;
        }
        // Deduct coins
        const newBalance = updateCoins(socket.id, -shopItem.price, io);
        // Place item near the player
        const itemDef = items[itemName];
        if (itemDef) {
          const pos = character.position || [0, 0];
          const placed = tryPlaceItemInRoom(room, itemName, {
            x: [Math.max(0, pos[0] - 5), Math.min(room.size[0] * room.gridDivision - 1, pos[0] + 5)],
            y: [Math.max(0, pos[1] - 5), Math.min(room.size[1] * room.gridDivision - 1, pos[1] + 5)],
          });
          if (placed) {
            io.to(room.id).emit("mapUpdate", {
              map: { gridDivision: room.gridDivision, size: room.size, items: room.items },
            });
          }
        }
        socket.emit("purchaseComplete", { item: itemName, price: shopItem.price, coins: newBalance });
      });

      // Collaborative building request
      socket.on("requestBuild", (botId) => {
        if (!room) return;
        // Check if it's a moltbook bot
        const moltBot = moltbookVirtualBots.get(botId);
        if (moltBot) {
          // Direct build for moltbook bots
          const zone = ROOM_ZONES[Math.floor(Math.random() * ROOM_ZONES.length)];
          const needed = zone.items.filter(name => {
            const count = room.items.filter(i => i.name === name).length;
            return count < 1;
          });
          if (needed.length > 0) {
            const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
            broadcastToRoom(room.id, "playerAction", { id: botId, action: "thinking", detail: phrase });
            pendingBuilds.set(botId, { stage: "thinking", zone, startedAt: Date.now() });
            io.to(room.id).emit("buildStarted", { botId, requestedBy: socket.id });
          }
          return;
        }
        // REST bot - push to event buffer
        for (const [, conn] of botSockets) {
          if (conn.botId === botId) {
            conn.eventBuffer.push({ type: "build_request", from: character?.name || "Player", fromId: socket.id, timestamp: Date.now() });
            io.to(room.id).emit("buildStarted", { botId, requestedBy: socket.id });
            break;
          }
        }
      });

      socket.on("passwordCheck", async (password) => {
        if (!room || !room.password) return;
        try {
          const match = room.password.startsWith("$2b$")
            ? await bcrypt.compare(password, room.password)
            : password === room.password; // fallback for not-yet-migrated
          if (match) {
            socket.emit("passwordCheckSuccess");
            character.canUpdateRoom = true;
          } else {
            socket.emit("passwordCheckFail");
          }
        } catch {
          socket.emit("passwordCheckFail");
        }
      });

      socket.on("itemsUpdate", async (items) => {
        if (!room) return;
        if (!character.canUpdateRoom) {
          return;
        }
        if (!items || items.length === 0) {
          return; // security
        }
        // Evict all seated characters since item layout changed
        ensureSeatMaps(room);
        for (const [charId] of room.characterSeats) {
          unsitCharacter(room, charId, broadcastToRoom);
        }
        room.items = items;
        updateGrid(room);
        room.characters.forEach((character) => {
          const [cx, cy] = character.position;
          if (!room.grid.isWalkableAt(cx, cy)) {
            // Only reposition if current position is now blocked
            character.path = [];
            character.position = generateRandomPosition(room);
          } else if (character.path && character.path.length > 0) {
            // Check if any waypoint in the current path is now blocked
            const blocked = character.path.some(([px, py]) => !room.grid.isWalkableAt(px, py));
            if (blocked) {
              character.path = [];
            }
          }
        });
        io.to(room.id).emit("mapUpdate", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
        });

        persistRooms(room);
        // Check quest completion
        checkQuestCompletion(socket.id, room, io);
      });

      // Bot-initiated single item placement (LLM bots)
      socket.on("placeItem", (placement) => {
        if (!room) return;
        if (!character.isBot) return; // only bots can use this endpoint
        if (!placement || typeof placement !== "object") return;

        const { itemName, gridPosition, rotation } = placement;

        // Validate item exists in the shop catalogue
        const itemDef = items[itemName];
        if (!itemDef) return;

        // Validate grid position
        if (!Array.isArray(gridPosition) || gridPosition.length !== 2) return;
        const [gx, gy] = gridPosition.map(Math.floor);
        if (gx < 0 || gy < 0) return;

        const rot = typeof rotation === "number" ? Math.floor(rotation) % 4 : 0;

        // Calculate effective width/height with rotation
        const width = rot === 1 || rot === 3 ? (itemDef.size[1]) : (itemDef.size[0]);
        const height = rot === 1 || rot === 3 ? (itemDef.size[0]) : (itemDef.size[1]);

        // Bounds check
        const maxX = room.size[0] * room.gridDivision;
        const maxY = room.size[1] * room.gridDivision;
        if (gx + width > maxX || gy + height > maxY) return;

        // Collision check - skip for walkable/wall items
        if (!itemDef.walkable && !itemDef.wall) {
          for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
              if (!room.grid.isWalkableAt(gx + x, gy + y)) return;
            }
          }
        }

        // Show building action status
        const pretty = itemName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
        io.to(room.id).emit("playerAction", {
          id: socket.id,
          action: "building",
          detail: "Placing a " + pretty + "...",
        });

        // Build the new item entry
        const newItem = {
          name: itemDef.name,
          size: itemDef.size,
          gridPosition: [gx, gy],
          rotation: itemDef.rotation != null ? itemDef.rotation : rot,
        };
        if (itemDef.walkable) newItem.walkable = true;
        if (itemDef.wall) newItem.wall = true;

        // Add to room and update grid incrementally
        room.items.push(newItem);
        addItemToGrid(room, newItem);

        // Broadcast update
        io.to(room.id).emit("mapUpdate", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
        });

        // Show completion and clear after delay
        io.to(room.id).emit("playerAction", {
          id: socket.id,
          action: "done",
          detail: "Finished placing the " + pretty + "!",
        });
        setTimeout(() => {
          io.to(room.id).emit("playerAction", { id: socket.id, action: null });
        }, 2500);

        // Persist
        persistRooms(room);
        // Check quest completion for all players in the room
        room.characters.forEach(c => {
          if (!c.isBot) checkQuestCompletion(c.id, room, io);
        });
      });

      socket.on("disconnect", () => {
        console.log("User disconnected");
        unsitCharacter(room, socket.id, broadcastToRoom);
        playerCoins.delete(socket.id);
        _prevMotiveBuckets.delete(socket.id);
        // Clean up active quests for this player
        for (const [key, val] of activeQuests) {
          if (val.socketId === socket.id) activeQuests.delete(key);
        }
        if (room) {
          const leavingName = character?.name || "Player";
          const leavingIsBot = character?.isBot || false;
          const leavingId = socket.id;
          const roomName = room.name;
          room.characters.splice(
            room.characters.findIndex((character) => character.id === socket.id),
            1
          );
          io.to(room.id).emit("characterLeft", {
            id: leavingId,
            name: leavingName,
            isBot: leavingIsBot,
            roomName: roomName,
          });
          if (room.characters.length === 0) scheduleEviction(room.id);
          onRoomUpdate();
          room = null;
        }
      });
    } catch (ex) {
      console.log(ex); // Big try catch to avoid crashing the server (best would be to handle all errors properly...)
    }
  });
}
