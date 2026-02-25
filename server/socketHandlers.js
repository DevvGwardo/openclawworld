import bcrypt from "bcrypt";

/**
 * Registers all Socket.IO connection and event handlers.
 *
 * @param {object} deps - every dependency previously closed-over in index.js
 * @returns {object} - Helper functions including emitAgentMessage for real-time agent messaging
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
    bonds,
    bondKey,
    getBondLevel,
    BOND_LEVELS,
    saveBonds,
    applyBondProgress,
    botRegistry,
    botSockets,
    sendWebhook,
    saveBotRegistry,
    playerCoins,
    DEFAULT_COINS,
    updateCoins,
    getCoins,
    setCoins,
    transferCoins,
    tryPlaceItemInRoom,
    initObjectives,
    checkBondMilestones,
    objectivesPayload,
    cleanupObjectives,
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
    dbGetNextApartmentNumber,
    limitChat,
    limitTransfer,
    hashApiKey,
    pendingInvites,
    ensureUser,
    getUser,
    createUserId,
    touchUser,
    socketUserIds,
    userSockets,
    validateSessionToken,
    setSessionToken,
    createSessionToken,
    agentThoughts,
    addAgentThought,
    OPEN_ACCESS = false,
    TRUST_PROXY = false,
  } = deps;

  const getSocketIp = (socket) => {
    if (TRUST_PROXY) {
      const forwarded = socket.handshake.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.trim().length > 0) {
        return forwarded.split(",")[0].trim();
      }
    }
    return socket.handshake.address || socket.id;
  };

  // Agent ID to Socket ID mapping for real-time agent messaging
  const agentSocketMap = new Map(); // Maps agentId -> socketId

  io.on("connection", async (socket) => {
    try {
      let room = null;
      let character = null;
      const rawBotToken = socket.handshake?.auth?.token;
      const botAuthKey = rawBotToken ? hashApiKey(rawBotToken) : null;
      if (botAuthKey && botRegistry.has(botAuthKey)) {
        const botRecord = botRegistry.get(botAuthKey);
        if (botRecord.status === "pending") {
          botRecord.status = "verified";
          botRecord.verifiedAt = botRecord.verifiedAt || new Date().toISOString();
          saveBotRegistry();
        }
        socket.data.officialBotKey = botAuthKey;
      }

      const attachUserSocket = (userId) => {
        if (!userId) return;
        socketUserIds.set(socket.id, userId);
        let sockets = userSockets.get(userId);
        if (!sockets) {
          sockets = new Set();
          userSockets.set(userId, sockets);
        }
        sockets.add(socket.id);
        socket.data.userId = userId;
      };

      const detachUserSocket = () => {
        const userId = socketUserIds.get(socket.id);
        if (!userId) return;
        socketUserIds.delete(socket.id);
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) userSockets.delete(userId);
        }
      };

      const getUserId = () => socketUserIds.get(socket.id) || socket.data.userId || null;

      const gridDistance = (a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return Infinity;
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
      };

      const emitBondProgress = async ({
        targetCharacter,
        eventType,
        baseDelta,
        cooldownMs,
      }) => {
        if (!room || !character || !targetCharacter) return null;
        const senderName = character?.name;
        const targetName = targetCharacter?.name;
        if (!senderName || !targetName) return null;

        const result = applyBondProgress({
          bondsMap: bonds,
          senderName,
          targetName,
          eventType,
          baseDelta,
          cooldownMs,
        });
        if (!result) return null;

        saveBonds();

        const update = {
          score: result.bond.score,
          level: result.level,
          levelLabel: result.levelLabel,
          nextThreshold: result.nextThreshold,
          maxLevel: result.maxLevel,
        };

        socket.emit("bondUpdate", { peerName: targetName, ...update });
        io.to(targetCharacter.id).emit("bondUpdate", { peerName: senderName, ...update });

        if (result.reachedMaxThisEvent) {
          io.to(room.id).emit("bondFormed", { nameA: senderName, nameB: targetName });
        }

        await handleObjectiveCompletions(checkBondMilestones(socket.id, result.level));
        const targetCompletions = checkBondMilestones(targetCharacter.id, result.level);
        for (const obj of targetCompletions) {
          if (targetCharacter.userId) {
            await updateCoins(targetCharacter.userId, obj.reward, io, userSockets);
          }
          io.to(targetCharacter.id).emit("objectives:complete", obj);
        }
        if (targetCompletions.length > 0) {
          const payload = objectivesPayload(targetCharacter.id);
          if (payload) io.to(targetCharacter.id).emit("objectives:progress", payload);
        }

        return result;
      };

      // Helper: process completed objectives (award coins + emit events)
      const handleObjectiveCompletions = async (completions) => {
        const userId = getUserId();
        for (const obj of completions) {
          if (userId) await updateCoins(userId, obj.reward, io, userSockets);
          socket.emit("objectives:complete", obj);
        }
        if (completions.length > 0) {
          const payload = objectivesPayload(socket.id);
          if (payload) socket.emit("objectives:progress", payload);
        }
      };

      const MAX_ITEMS_UPDATE_COUNT = 500;
      const sanitizeRoomItemsUpdate = (nextItems) => {
        if (!Array.isArray(nextItems) || nextItems.length === 0) {
          return { ok: false, error: "items must be a non-empty array" };
        }
        if (nextItems.length > MAX_ITEMS_UPDATE_COUNT) {
          return { ok: false, error: `Too many items in update (max ${MAX_ITEMS_UPDATE_COUNT})` };
        }

        const maxX = room.size[0] * room.gridDivision;
        const maxY = room.size[1] * room.gridDivision;
        const occupiedCells = new Set();
        const sanitizedItems = [];

        for (const rawItem of nextItems) {
          if (!rawItem || typeof rawItem !== "object") {
            return { ok: false, error: "Invalid item payload" };
          }

          const itemName = typeof rawItem.name === "string" ? rawItem.name : null;
          const itemDef = itemName ? items[itemName] : null;
          if (!itemDef) {
            return { ok: false, error: `Unknown item: ${itemName || "unknown"}` };
          }

          if (!Array.isArray(rawItem.gridPosition) || rawItem.gridPosition.length !== 2) {
            return { ok: false, error: `Item ${itemDef.name} has invalid gridPosition` };
          }

          const gxRaw = Number(rawItem.gridPosition[0]);
          const gyRaw = Number(rawItem.gridPosition[1]);
          if (!Number.isFinite(gxRaw) || !Number.isFinite(gyRaw)) {
            return { ok: false, error: `Item ${itemDef.name} has non-numeric gridPosition` };
          }
          const gx = Math.floor(gxRaw);
          const gy = Math.floor(gyRaw);
          if (gx < 0 || gy < 0) {
            return { ok: false, error: `Item ${itemDef.name} is out of bounds` };
          }

          const rawRotation = Number.isFinite(rawItem.rotation)
            ? Math.floor(rawItem.rotation)
            : (itemDef.rotation ?? 0);
          const normalizedRotation = ((rawRotation % 4) + 4) % 4;
          const effectiveRotation = itemDef.rotation != null ? itemDef.rotation : normalizedRotation;
          const width = effectiveRotation === 1 || effectiveRotation === 3 ? itemDef.size[1] : itemDef.size[0];
          const height = effectiveRotation === 1 || effectiveRotation === 3 ? itemDef.size[0] : itemDef.size[1];

          if (gx + width > maxX || gy + height > maxY) {
            return { ok: false, error: `Item ${itemDef.name} is out of bounds` };
          }

          if (!itemDef.walkable && !itemDef.wall) {
            for (let x = 0; x < width; x++) {
              for (let y = 0; y < height; y++) {
                const key = `${gx + x},${gy + y}`;
                if (occupiedCells.has(key)) {
                  return { ok: false, error: `Item collision detected for ${itemDef.name}` };
                }
              }
            }
            for (let x = 0; x < width; x++) {
              for (let y = 0; y < height; y++) {
                occupiedCells.add(`${gx + x},${gy + y}`);
              }
            }
          }

          const next = {
            name: itemDef.name,
            size: itemDef.size,
            gridPosition: [gx, gy],
            rotation: effectiveRotation,
          };
          if (itemDef.walkable) next.walkable = true;
          if (itemDef.wall) next.wall = true;
          sanitizedItems.push(next);
        }

        return { ok: true, items: sanitizedItems };
      };

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
        : getAllCachedRooms()
            // Filter out empty generated rooms - only show plaza + claimed/created rooms
            .filter((room) => !room.generated || room.claimedBy)
            .map((room) => ({
              id: room.id,
              name: room.name,
              nbCharacters: room.characters.length,
              claimedBy: room.claimedBy || null,
              generated: room.generated || false,
              apartmentNumber: room.apartmentNumber || null,
            }));
      const totalRooms = isDbAvailable() ? await dbCountRooms() : welcomeRooms.length;

      socket.emit("welcome", {
        rooms: welcomeRooms,
        totalRooms,
        items,
        agentThoughts: agentThoughts || [],
      });

      socket.on("joinRoom", async (roomId, opts) => {
        room = getCachedRoom(roomId) || await getOrLoadRoom(roomId, hydrateRoom);
        if (!room) {
          return;
        }
        cancelEviction(room.id);
        socket.join(room.id);
        const requestedIsBot = opts?.isBot === true;
        const isOfficialBot = requestedIsBot && (OPEN_ACCESS || !!socket.data.officialBotKey);
        const requestedUserId = typeof opts?.userId === "string" ? opts.userId.trim() : null;
        let resolvedUserId = requestedUserId && requestedUserId.length >= 8 ? requestedUserId : null;
        if (isOfficialBot && socket.data.officialBotKey) {
          const reg = botRegistry.get(socket.data.officialBotKey);
          if (reg) {
            if (!reg.userId) {
              reg.userId = createUserId();
              saveBotRegistry();
            }
            resolvedUserId = reg.userId;
            // Track agent ID to socket mapping for real-time messaging
            if (reg.agentId) {
              agentSocketMap.set(reg.agentId, socket.id);
              socket.data.agentId = reg.agentId;
            }
          }
        }
        if (!resolvedUserId) resolvedUserId = createUserId();

        // Session token validation
        const requestedSessionToken = typeof opts?.sessionToken === "string" ? opts.sessionToken : null;
        let sessionValid = false;
        let newSessionToken = null;

        if (requestedUserId && requestedSessionToken) {
          // Client claims to have an existing identity - validate it
          sessionValid = await validateSessionToken(requestedUserId, requestedSessionToken);
        }

        if (!sessionValid) {
          // Either new user or invalid token - generate new identity
          resolvedUserId = createUserId();
          newSessionToken = createSessionToken();
        }

        attachUserSocket(resolvedUserId);
        const displayName = opts?.name || (socket.data.officialBotKey ? botRegistry.get(socket.data.officialBotKey)?.name : null) || null;
        const userRecord = await ensureUser({ userId: resolvedUserId, name: displayName, isBot: isOfficialBot });
        if (userRecord) {
          playerCoins.set(resolvedUserId, typeof userRecord.coins === "number" ? userRecord.coins : DEFAULT_COINS);
          await touchUser(resolvedUserId);
        }
        if (newSessionToken) {
          await setSessionToken(resolvedUserId, newSessionToken);
        }
        character = {
          id: socket.id,
          userId: resolvedUserId,
          session: parseInt(Math.random() * 1000),
          position: generateRandomPosition(room),
          avatarUrl: sanitizeAvatarUrl(opts.avatarUrl),
          isBot: isOfficialBot,
          isOfficialBot,
          name: displayName,
          coins: playerCoins.get(resolvedUserId) || DEFAULT_COINS,
        };
        if (!room.password) character.canUpdateRoom = true;
        // Check if this join was triggered by a room invite
        const invite = pendingInvites.get(socket.id);
        if (invite && invite.roomId === room.id) {
          character.invitedBy = { id: invite.fromId, name: invite.fromName, isBot: invite.fromIsBot };
          clearTimeout(invite.timer);
          pendingInvites.delete(socket.id);
        } else {
          character.invitedBy = null;
        }
        room.characters.push(character);

        socket.emit("roomJoined", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
          userId: resolvedUserId,
          coins: playerCoins.get(resolvedUserId) || DEFAULT_COINS,
          hasPassword: !!room.password,
          invitedBy: character.invitedBy || null,
          sessionToken: newSessionToken || null, // Only send if newly generated
        });
        // Notify other players in the room about the new character (excludes the joiner)
        socket.broadcast.to(room.id).emit("characterJoined", {
          character: stripCharacters([character])[0],
          roomName: room.name,
        });
        onRoomUpdate();

        // Initialize objectives for this session
        initObjectives(socket.id);
        socket.emit("objectives:init", objectivesPayload(socket.id));
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
              apartmentNumber: r.apartmentNumber || null,
            }));
          io.emit("roomsUpdate", activeRooms);
        }, 0); // next tick - coalesces synchronous calls within the same event
      };

      socket.on("leaveRoom", () => {
        if (!room) {
          return;
        }
        const leavingName = character?.name || "Player";
        const leavingIsBot = character?.isBot || false;
        const leavingId = socket.id;
        const roomName = room.name;
        socket.leave(room.id);
        room.characters.splice(
          room.characters.findIndex((character) => character.id === socket.id),
          1
        );
        if (room.danceTimestamps) room.danceTimestamps.delete(socket.id);
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
          if (room.danceTimestamps) room.danceTimestamps.delete(socket.id);
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

        // Note: Auto-creation of generated rooms (room-N) is disabled.
        // Only user-created rooms and Open Cloud bot-claimed rooms are allowed.

        if (!room) {
          socket.emit("switchRoomError", { error: "Room not found" });
          return;
        }
        cancelEviction(room.id);
        socket.join(room.id);
        character.position = generateRandomPosition(room);
        character.path = [];
        character.canUpdateRoom = !room.password;
        // Check if this room switch was triggered by a room invite
        const invite = pendingInvites.get(socket.id);
        if (invite && invite.roomId === room.id) {
          character.invitedBy = { id: invite.fromId, name: invite.fromName, isBot: invite.fromIsBot };
          clearTimeout(invite.timer);
          pendingInvites.delete(socket.id);
        } else {
          character.invitedBy = null;
        }
        room.characters.push(character);

        const currentUserId = getUserId() || character.userId || null;
        socket.emit("roomJoined", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
          userId: currentUserId,
          coins: currentUserId ? (playerCoins.get(currentUserId) || DEFAULT_COINS) : DEFAULT_COINS,
          hasPassword: !!room.password,
          invitedBy: character.invitedBy || null,
        });
        socket.broadcast.to(room.id).emit("characterJoined", {
          character: stripCharacters([character])[0],
          roomName: room.name,
        });
        onRoomUpdate();

        // Re-initialize objectives on room switch
        initObjectives(socket.id);
        socket.emit("objectives:init", objectivesPayload(socket.id));
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




      socket.on("dance", async () => {
        if (!room) return;
        unsitCharacter(room, socket.id, broadcastToRoom);
        io.to(room.id).emit("playerDance", {
          id: socket.id,
        });

        if (!room.danceTimestamps) room.danceTimestamps = new Map();
        const now = Date.now();
        room.danceTimestamps.set(socket.id, now);

        // Bond only when dancing together (both participants danced recently).
        const nearbyDancers = room.characters.filter((c) => {
          if (!c || c.id === socket.id || !c.name) return false;
          const dancedAt = room.danceTimestamps.get(c.id) || 0;
          if (now - dancedAt > 12000) return false;
          return gridDistance(character?.position, c.position) <= 12;
        });
        for (const peer of nearbyDancers) {
          await emitBondProgress({
            targetCharacter: peer,
            eventType: "dance",
            baseDelta: 1.1,
            cooldownMs: 20000,
          });
        }
      });

      // Bot thinking indicator — bots can signal they are "thinking" before responding
      socket.on("thinking", (isThinking) => {
        if (!room) return;
        const character = room.characters.find((c) => c.id === socket.id);
        // Only allow bots to use thinking indicator
        if (!character || !character.isBot) return;
        io.to(room.id).emit("playerThinking", {
          id: socket.id,
          thinking: !!isThinking,
        });
      });

      socket.on("emote:play", async (emoteName) => {
        if (!room) return;
        if (typeof emoteName !== "string") return;
        if (!ALLOWED_EMOTES.includes(emoteName)) return;
        io.to(room.id).emit("emote:play", {
          id: socket.id,
          emote: emoteName,
        });

        const nearby = room.characters.filter((c) => {
          if (!c || c.id === socket.id || !c.name) return false;
          return gridDistance(character?.position, c.position) <= 8;
        });
        for (const peer of nearby) {
          await emitBondProgress({
            targetCharacter: peer,
            eventType: "emote",
            baseDelta: 0.45,
            cooldownMs: 12000,
          });
        }
      });

      socket.on("wave:at", async (targetId) => {
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
          await emitBondProgress({
            targetCharacter: target,
            eventType: "wave",
            baseDelta: 1,
            cooldownMs: 10000,
          });
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

      socket.on("chatMessage", async (message) => {
        if (!room) return;
        const socketIp = getSocketIp(socket);
        if (limitChat(socketIp)) {
          socket.emit("rateLimited", { message: "You are sending messages too fast." });
          return;
        }
        if (typeof message !== "string") return;
        const safeMessage = message.slice(0, 500);
        if (safeMessage.length === 0) return;
        io.to(room.id).emit("playerChatMessage", {
          id: socket.id,
          message: safeMessage,
        });

        // Sims-like bonding: conversation raises relationships with nearby characters.
        const nearby = room.characters.filter((c) => {
          if (!c || c.id === socket.id || !c.name) return false;
          return gridDistance(character?.position, c.position) <= 10;
        });
        for (const peer of nearby) {
          await emitBondProgress({
            targetCharacter: peer,
            eventType: "chat",
            baseDelta: 0.7,
            cooldownMs: 15000,
          });
        }
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

      // Create a new room (bot-initiated via UI)
      let lastCreateRoom = 0;
      socket.on("createRoom", async (opts, callback) => {
        if (typeof callback !== "function") return;
        if (!character || !room) return callback({ success: false, error: "Not in a room" });

        // Only agents (bots) can create rooms
        if (!character.isBot) {
          return callback({ success: false, error: "Only agents can create rooms" });
        }

        // Rate limit: 1 room creation per 30 seconds per socket
        const now = Date.now();
        if (now - lastCreateRoom < 30000) {
          return callback({ success: false, error: "Please wait before creating another room" });
        }

        // Validate inputs
        const name = (typeof opts?.name === "string" ? opts.name.trim() : "").slice(0, 50);
        if (name.length === 0) return callback({ success: false, error: "Room name is required" });

        // Accept size as array [x, y] OR as separate sizeX/sizeY properties
        let rawSizeX, rawSizeY;
        if (Array.isArray(opts?.size) && opts.size.length >= 2) {
          rawSizeX = opts.size[0];
          rawSizeY = opts.size[1];
        } else {
          rawSizeX = opts?.sizeX;
          rawSizeY = opts?.sizeY;
        }
        const sizeX = Math.max(5, Math.min(30, Math.floor(Number(rawSizeX) || 15)));
        const sizeY = Math.max(5, Math.min(30, Math.floor(Number(rawSizeY) || 15)));
        const gridDivision = Math.max(1, Math.min(4, Math.floor(Number(opts?.gridDivision) || 2)));

        // Hash password if provided
        let password = null;
        if (typeof opts?.password === "string" && opts.password.trim().length > 0) {
          password = await bcrypt.hash(opts.password.trim(), 10);
        }

        // Generate unique room ID and get next apartment number
        const roomId = `user-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const apartmentNumber = await dbGetNextApartmentNumber();

        // Create room object
        const newRoom = hydrateRoom({
          id: roomId,
          name,
          size: [sizeX, sizeY],
          gridDivision,
          items: [],
          generated: false,
          claimedBy: character.name,
          password,
          apartmentNumber,
        });
        setCachedRoom(newRoom);
        persistRooms(newRoom);
        lastCreateRoom = now;

        // Leave current room (reuse switchRoom logic)
        unsitCharacter(room, socket.id, broadcastToRoom);
        if (room) {
          const leavingName = character?.name || "Player";
          const leavingIsBot = character?.isBot || false;
          const leavingId = socket.id;
          const oldRoomName = room.name;
          const oldRoomId = room.id;
          socket.leave(room.id);
          const idx = room.characters.findIndex((c) => c.id === socket.id);
          if (idx !== -1) room.characters.splice(idx, 1);
          if (room.danceTimestamps) room.danceTimestamps.delete(socket.id);
          io.to(oldRoomId).emit("characterLeft", {
            id: leavingId,
            name: leavingName,
            isBot: leavingIsBot,
            roomName: oldRoomName,
          });
          if (room.characters.length === 0) scheduleEviction(room.id);
        }

        // Join the new room
        room = newRoom;
        cancelEviction(room.id);
        socket.join(room.id);
        character.position = generateRandomPosition(room);
        character.path = [];
        character.canUpdateRoom = true; // Creator always has edit access
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
        onRoomUpdate();

        callback({ success: true, roomId });
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
        // Track pending invite so we can attach inviter info when target joins
        const prev = pendingInvites.get(targetId);
        if (prev?.timer) clearTimeout(prev.timer);
        const timer = setTimeout(() => pendingInvites.delete(targetId), 300_000);
        pendingInvites.set(targetId, {
          fromId: socket.id,
          fromName: character.name || "Player",
          fromIsBot: !!character.isBot,
          roomId: room.id,
          timer,
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
        const senderUserId = getUserId();
        const targetChar = room.characters.find((c) => c.id === targetId);
        // Send to target
        io.to(targetId).emit("directMessage", {
          senderId: socket.id,
          senderUserId,
          senderName,
          senderIsBot,
          message: trimmed,
          timestamp: Date.now(),
        });
        // Confirm to sender
        socket.emit("directMessageSent", {
          targetId,
          targetUserId: targetChar?.userId || null,
          message: trimmed,
          timestamp: Date.now(),
        });
      });

      // Coins transfer (global, userId-based)
      socket.on("coins:transfer", async ({ toUserId, amount }) => {
        if (!character) return;
        if (limitTransfer(socket.id)) {
          socket.emit("coinsTransferError", { error: "Too many transfers, slow down." });
          return;
        }
        const fromUserId = getUserId();
        if (!fromUserId) {
          socket.emit("coinsTransferError", { error: "Missing sender identity." });
          return;
        }
        const rawAmount = typeof amount === "number" ? amount : Number(amount);
        const transferAmount = Number.isInteger(rawAmount) ? rawAmount : Math.floor(rawAmount);
        if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
          socket.emit("coinsTransferError", { error: "Invalid amount." });
          return;
        }
        if (transferAmount > 10000) {
          socket.emit("coinsTransferError", { error: "Amount exceeds max transfer (10000)." });
          return;
        }
        if (typeof toUserId !== "string" || toUserId.length < 8) {
          socket.emit("coinsTransferError", { error: "Invalid recipient ID." });
          return;
        }
        if (toUserId === fromUserId) {
          socket.emit("coinsTransferError", { error: "Cannot transfer to yourself." });
          return;
        }
        const recipient = await getUser(toUserId);
        if (!recipient) {
          socket.emit("coinsTransferError", { error: "Recipient not found." });
          return;
        }
        const transferResult = await transferCoins(fromUserId, toUserId, transferAmount, io, userSockets);
        if (!transferResult || transferResult.ok !== true) {
          const code = transferResult?.error;
          if (code === "insufficient") {
            socket.emit("coinsTransferError", { error: "Insufficient coins." });
          } else if (code === "sender_not_found") {
            socket.emit("coinsTransferError", { error: "Missing sender identity." });
          } else if (code === "recipient_not_found") {
            socket.emit("coinsTransferError", { error: "Recipient not found." });
          } else if (code === "self_transfer") {
            socket.emit("coinsTransferError", { error: "Cannot transfer to yourself." });
          } else {
            socket.emit("coinsTransferError", { error: "Transfer failed." });
          }
          return;
        }
        const newSenderBalance = transferResult.fromBalance;
        const newRecipientBalance = transferResult.toBalance;
        socket.emit("coinsTransferSuccess", {
          toUserId,
          toName: recipient.name || "Player",
          amount: transferAmount,
          balance: newSenderBalance,
        });
        const recipientPayload = {
          fromUserId,
          fromName: character?.name || "Player",
          fromIsBot: !!character?.isBot,
          amount: transferAmount,
          balance: newRecipientBalance,
        };
        const sockets = userSockets.get(toUserId);
        if (sockets) {
          for (const sid of sockets) {
            io.to(sid).emit("coinsTransferReceived", recipientPayload);
          }
        }
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

      socket.on("buyFromBot", async ({ botId, itemName }) => {
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
        const userId = getUserId();
        const coins = userId ? await getCoins(userId) : 0;
        if (coins < shopItem.price) {
          socket.emit("purchaseError", { error: "Insufficient coins", required: shopItem.price, have: coins });
          return;
        }
        // Deduct coins
        const newBalance = await updateCoins(userId, -shopItem.price, io, userSockets);
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

      socket.on("itemsUpdate", async (nextItems) => {
        if (!room) return;
        if (!character.canUpdateRoom) {
          return;
        }
        const sanitized = sanitizeRoomItemsUpdate(nextItems);
        if (!sanitized.ok) {
          socket.emit("itemsUpdateError", { error: sanitized.error });
          return;
        }
        // Evict all seated characters since item layout changed
        ensureSeatMaps(room);
        for (const [charId] of room.characterSeats) {
          unsitCharacter(room, charId, broadcastToRoom);
        }
        room.items = sanitized.items;
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
      });

      // Bot-initiated single item placement (LLM bots)
      socket.on("placeItem", async (placement) => {
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
        const roomId = room.id;
        setTimeout(() => {
          if (roomId) io.to(roomId).emit("playerAction", { id: socket.id, action: null });
        }, 2500);

        // Persist
        persistRooms(room);
      });

      socket.on("disconnect", () => {
        console.log("User disconnected");
        unsitCharacter(room, socket.id, broadcastToRoom);
        detachUserSocket();
        cleanupObjectives(socket.id);
        // Clean up agent socket mapping
        if (socket.data.agentId) {
          agentSocketMap.delete(socket.data.agentId);
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
          if (room.danceTimestamps) room.danceTimestamps.delete(socket.id);
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

  // Return helper function to emit agent messages from HTTP routes
  return {
    emitAgentMessage: (toAgentId, messageData) => {
      const targetSocketId = agentSocketMap.get(toAgentId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("agentMessage", messageData);
        return true;
      }
      return false;
    }
  };
}
