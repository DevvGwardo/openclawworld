import bcrypt from "bcrypt";
import {
  scheduleAutoWave,
  cancelAutoWavesForCharacter,
  checkProximityGreetings,
  cancelProximityGreetingsForCharacter,
  trackBotActivity,
  startRoomChatterInterval,
  stopRoomChatterInterval,
  cleanupBotActivityTracking,
} from "./autoInteraction.js";
import { getNeeds } from "./needsEngine.js";
import { isValidWallPlacement, wallEdgeCapacity } from "./itemCatalog.js";
import { enqueuePlacements, cancelQueue } from "./walkThenPlace.js";
import { spawnPet, despawnPet, despawnAllAgentPets, getAgentPets } from "./petSystem.js";
import { solveIssue } from "./agentTaskRunner.js";
import { appendGuidelineSectionToIssueBody, normalizeGuidelineFiles } from "./issueGuidelines.js";

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
    tryPlaceItemInRoom,
    initObjectives,
    checkBondMilestones,
    objectivesPayload,
    cleanupObjectives,
    initNeeds,
    applySocialBoost,
    cleanupNeeds,
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
    githubService,
    githubStore,
    llmBridge,
    OPEN_ACCESS = false,
    TRUST_PROXY = false,
    ensureCellOccupancy,
    cellKey,
    occupyCell,
    vacateCell,
    isCellOccupied,
    trimPathToFreeCell,
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
          io.to(targetCharacter.id).emit("objectives:complete", obj);
        }
        if (targetCompletions.length > 0) {
          const payload = objectivesPayload(targetCharacter.id);
          if (payload) io.to(targetCharacter.id).emit("objectives:progress", payload);
        }

        return result;
      };

      // Helper: process completed objectives (emit events)
      const handleObjectiveCompletions = async (completions) => {
        for (const obj of completions) {
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
        const occupiedWallCells = new Set();
        const wallEdgeCells = { front: 0, back: 0, left: 0, right: 0 };
        const edgeCap = (room.size[0] <= 30 && room.size[1] <= 30) ? wallEdgeCapacity(room.size, room.gridDivision) : null;
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
          const effectiveRotation = normalizedRotation;
          const width = effectiveRotation === 1 || effectiveRotation === 3 ? itemDef.size[1] : itemDef.size[0];
          const height = effectiveRotation === 1 || effectiveRotation === 3 ? itemDef.size[0] : itemDef.size[1];

          if (gx + width > maxX || gy + height > maxY) {
            return { ok: false, error: `Item ${itemDef.name} is out of bounds` };
          }

          // Legacy tolerance: if the catalog now marks an item as wall-mounted but
          // the submitted item was stored before that change (no wall flag), skip
          // strict wall-placement validation so existing rooms remain editable.
          const submittedAsWall = !!rawItem.wall;
          const effectiveWall = itemDef.wall && (submittedAsWall || isValidWallPlacement(itemDef, [gx, gy], effectiveRotation, room.size, room.gridDivision));

          if (submittedAsWall && !isValidWallPlacement(itemDef, [gx, gy], effectiveRotation, room.size, room.gridDivision)) {
            return { ok: false, error: `Wall item ${itemDef.name} must be placed on a wall` };
          }

          if (effectiveWall) {
            for (let x = 0; x < width; x++) {
              for (let y = 0; y < height; y++) {
                const key = `${gx + x},${gy + y}`;
                if (occupiedWallCells.has(key)) {
                  return { ok: false, error: `Wall item collision detected for ${itemDef.name}` };
                }
              }
            }
            for (let x = 0; x < width; x++) {
              for (let y = 0; y < height; y++) {
                occupiedWallCells.add(`${gx + x},${gy + y}`);
              }
            }
            // Wall edge capacity check
            if (edgeCap) {
              const cellCount = width * height;
              if (gy === 0) wallEdgeCells.front += cellCount;
              if (gx === 0) wallEdgeCells.left += cellCount;
              if (gy + height === maxY) wallEdgeCells.back += cellCount;
              if (gx + width === maxX) wallEdgeCells.right += cellCount;
              if (wallEdgeCells.front > edgeCap.front || wallEdgeCells.back > edgeCap.back ||
                  wallEdgeCells.left > edgeCap.left || wallEdgeCells.right > edgeCap.right) {
                return { ok: false, error: `Wall edge capacity exceeded for ${itemDef.name}` };
              }
            }
          }

          if (!itemDef.walkable && !effectiveWall) {
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
          if (effectiveWall) next.wall = true;
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
          socket.emit("joinRoomError", { error: "Room not found", roomId });
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
        ensureCellOccupancy(room);
        if (character.position) occupyCell(room, character.position[0], character.position[1], socket.id);

        // Start idle chatter interval when a bot joins
        if (character.isBot) {
          const roomId = room.id;
          startRoomChatterInterval({ roomId, getRoom: () => getCachedRoom(roomId), io, bonds, applyBondProgress, saveBonds, getNeeds, botSockets });
        }

        socket.emit("roomJoined", {
          map: {
            gridDivision: room.gridDivision,
            size: room.size,
            items: room.items,
          },
          characters: stripCharacters(room.characters),
          id: socket.id,
          userId: resolvedUserId,
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

        // Hydrate bonds — emit bondInfo for every peer this player has a bond with
        if (character.name) {
          for (const peer of room.characters) {
            if (!peer.name || peer.id === socket.id) continue;
            const key = bondKey(character.name, peer.name);
            const bond = bonds.get(key);
            if (!bond || bond.score <= 0) continue;
            const level = getBondLevel(bond.score);
            const maxLevel = level === BOND_LEVELS.length - 1;
            socket.emit("bondInfo", {
              peerName: peer.name,
              score: bond.score,
              level,
              levelLabel: BOND_LEVELS[level].label,
              nextThreshold: maxLevel ? null : BOND_LEVELS[level + 1].threshold,
              maxLevel,
            });
          }
        }

        // Initialize objectives for this session
        initObjectives(socket.id);
        socket.emit("objectives:init", objectivesPayload(socket.id));

        // Initialize needs tracking for bots
        if (character.isBot) {
          initNeeds(socket.id);
        }
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
        cancelAutoWavesForCharacter(room.id, socket.id);
        cancelProximityGreetingsForCharacter(room.id, socket.id);
        cleanupBotActivityTracking(socket.id);
        if (character?.isBot) {
          if (!room.characters.some((c) => c.id !== socket.id && c.isBot))
            stopRoomChatterInterval(room.id);
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
          cancelAutoWavesForCharacter(room.id, socket.id);
          cancelProximityGreetingsForCharacter(room.id, socket.id);
          cleanupBotActivityTracking(socket.id);
          if (character?.isBot) {
            if (!room.characters.some((c) => c.id !== socket.id && c.isBot))
              stopRoomChatterInterval(room.id);
          }
          const leavingName = character?.name || "Player";
          const leavingIsBot = character?.isBot || false;
          const leavingId = socket.id;
          const oldRoomName = room.name;
          const oldRoomId = room.id;
          socket.leave(room.id);
          const idx = room.characters.findIndex((c) => c.id === socket.id);
          if (idx !== -1) room.characters.splice(idx, 1);
          ensureCellOccupancy(room);
          if (character?.position) vacateCell(room, character.position[0], character.position[1], socket.id);
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
        ensureCellOccupancy(room);
        if (character.position) occupyCell(room, character.position[0], character.position[1], socket.id);

        // Start idle chatter interval when a bot joins
        if (character.isBot) {
          const roomId = room.id;
          startRoomChatterInterval({ roomId, getRoom: () => getCachedRoom(roomId), io, bonds, applyBondProgress, saveBonds, getNeeds, botSockets });
        }

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

        // Release floor cell — character is logically on furniture after sitting
        ensureCellOccupancy(room);
        if (character.position) vacateCell(room, character.position[0], character.position[1], socket.id);

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

        // Validate coordinates are numeric arrays within grid bounds
        if (!Array.isArray(from) || from.length < 2 || !Number.isFinite(from[0]) || !Number.isFinite(from[1])) return;
        if (!Array.isArray(to) || to.length < 2 || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) return;
        const maxX = room.size[0] * room.gridDivision;
        const maxY = room.size[1] * room.gridDivision;
        if (from[0] < 0 || from[1] < 0 || from[0] >= maxX || from[1] >= maxY) return;
        if (to[0] < 0 || to[1] < 0 || to[0] >= maxX || to[1] >= maxY) return;

        unsitCharacter(room, socket.id, broadcastToRoom);
        ensureCellOccupancy(room);

        const path = findPath(room, from, to);
        if (!path || path.length === 0) return;

        // Trim path so it ends at the last unoccupied cell (stop next to people, not on them)
        const trimmed = trimPathToFreeCell(room, path, socket.id);
        if (!trimmed || trimmed.length === 0) return; // every cell along path is taken — stay put

        const endpoint = trimmed[trimmed.length - 1];

        // Release old cell, reserve new
        if (character.position) vacateCell(room, character.position[0], character.position[1], socket.id);
        occupyCell(room, endpoint[0], endpoint[1], socket.id);

        character.position = from;
        character.path = trimmed;
        io.to(room.id).emit("playerMove", character);
        character.position = endpoint;

        // Proximity greetings: bots wave at characters who walk near them
        checkProximityGreetings({ room, moverId: socket.id, io, bonds, applyBondProgress, saveBonds });

        // Track bot movement for idle chatter detection
        if (character.isBot) trackBotActivity(socket.id, "move");
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
        // Boost social need for bot wavers
        if (character.isBot) applySocialBoost(socket.id, 5);

        // Schedule auto-wave-back from target after a natural delay.
        // The callback emits directly to the room (bypasses wave:at handler)
        // so it never triggers another auto-wave.
        scheduleAutoWave({
          roomId: room.id,
          responderId: targetId,
          targetId: socket.id,
          callback: () => {
            // Re-verify both characters are still in the room
            const responder = room?.characters?.find((c) => c.id === targetId);
            const initiator = room?.characters?.find((c) => c.id === socket.id);
            if (!room || !responder || !initiator) return;

            // Emit wave-back events directly to the room
            io.to(room.id).emit("playerWaveAt", {
              id: targetId,
              targetId: socket.id,
            });
            io.to(room.id).emit("emote:play", {
              id: targetId,
              emote: "wave",
            });

            // Apply bond progress for the return wave
            const responderName = responder.name;
            const initiatorName = initiator.name;
            if (responderName && initiatorName && responderName.toLowerCase() !== initiatorName.toLowerCase()) {
              const result = applyBondProgress({
                bondsMap: bonds,
                senderName: responderName,
                targetName: initiatorName,
                eventType: "wave",
                baseDelta: 1,
                cooldownMs: 10000,
              });
              if (result) {
                saveBonds();
                const update = {
                  score: result.bond.score,
                  level: result.level,
                  levelLabel: result.levelLabel,
                  nextThreshold: result.nextThreshold,
                  maxLevel: result.maxLevel,
                };
                io.to(targetId).emit("bondUpdate", { peerName: initiatorName, ...update });
                io.to(socket.id).emit("bondUpdate", { peerName: responderName, ...update });
                if (result.reachedMaxThisEvent) {
                  io.to(room.id).emit("bondFormed", { nameA: responderName, nameB: initiatorName });
                }
              }
            }
          },
        });

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

        // Track bot chat activity for idle chatter detection
        if (character.isBot) trackBotActivity(socket.id, "chat");

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

        // Boost social need for bot chatters
        if (character.isBot) applySocialBoost(socket.id, 3);
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
          if (character?.position) {
            ensureCellOccupancy(room);
            vacateCell(room, character.position[0], character.position[1], socket.id);
          }
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
        ensureCellOccupancy(room);
        if (character.position) occupyCell(room, character.position[0], character.position[1], socket.id);

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
        // Rebuild cell occupancy after repositioning
        ensureCellOccupancy(room);
        room.cellOccupancy.clear();
        ensureSeatMaps(room);
        room.characters.forEach((c) => {
          if (!room.characterSeats.has(c.id) && c.position) {
            occupyCell(room, c.position[0], c.position[1], c.id);
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

        const rot = typeof rotation === "number" ? Math.floor(rotation) % 4 : (itemDef.rotation ?? 0);

        // Calculate effective width/height with rotation
        const width = rot === 1 || rot === 3 ? (itemDef.size[1]) : (itemDef.size[0]);
        const height = rot === 1 || rot === 3 ? (itemDef.size[0]) : (itemDef.size[1]);

        // Bounds check
        const maxX = room.size[0] * room.gridDivision;
        const maxY = room.size[1] * room.gridDivision;
        if (gx + width > maxX || gy + height > maxY) return;

        // Wall placement check
        if (!isValidWallPlacement(itemDef, [gx, gy], rot, room.size, room.gridDivision)) return;

        // Wall-vs-wall collision check + capacity check
        if (itemDef.wall) {
          const edgeCells = { front: 0, back: 0, left: 0, right: 0 };
          for (const existing of room.items) {
            if (!existing.wall) continue;
            const ew = existing.rotation === 1 || existing.rotation === 3 ? existing.size[1] : existing.size[0];
            const eh = existing.rotation === 1 || existing.rotation === 3 ? existing.size[0] : existing.size[1];
            if (gx < existing.gridPosition[0] + ew && gx + width > existing.gridPosition[0] &&
                gy < existing.gridPosition[1] + eh && gy + height > existing.gridPosition[1]) {
              return;
            }
            const ec = ew * eh;
            if (existing.gridPosition[1] === 0) edgeCells.front += ec;
            if (existing.gridPosition[0] === 0) edgeCells.left += ec;
            if (existing.gridPosition[1] + eh === maxY) edgeCells.back += ec;
            if (existing.gridPosition[0] + ew === maxX) edgeCells.right += ec;
          }
          // Add the new item's cells
          const newCells = width * height;
          if (gy === 0) edgeCells.front += newCells;
          if (gx === 0) edgeCells.left += newCells;
          if (gy + height === maxY) edgeCells.back += newCells;
          if (gx + width === maxX) edgeCells.right += newCells;
          if (room.size[0] <= 30 && room.size[1] <= 30) {
            const cap = wallEdgeCapacity(room.size, room.gridDivision);
            if (edgeCells.front > cap.front || edgeCells.back > cap.back ||
                edgeCells.left > cap.left || edgeCells.right > cap.right) {
              return;
            }
          }
        }

        // Collision check - skip for walkable/wall items
        if (!itemDef.walkable && !itemDef.wall) {
          for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
              if (!room.grid.isWalkableAt(gx + x, gy + y)) return;
            }
          }
        }

        // Build the new item entry (not yet added to room — queue handles that)
        const newItem = {
          name: itemDef.name,
          size: itemDef.size,
          gridPosition: [gx, gy],
          rotation: rot,
        };
        if (itemDef.walkable) newItem.walkable = true;
        if (itemDef.wall) newItem.wall = true;

        // Enqueue: bot walks to position, then places
        enqueuePlacements({
          botId: socket.id,
          room,
          items: [{ newItem, itemDef }],
          character,
          io,
          findPathFn: findPath,
          addItemToGridFn: addItemToGrid,
          persistRoomsFn: persistRooms,
          onPositionChange: (botId, oldPos, newPos) => {
            ensureCellOccupancy(room);
            if (oldPos) vacateCell(room, oldPos[0], oldPos[1], botId);
            if (newPos) occupyCell(room, newPos[0], newPos[1], botId);
          },
        });
      });

    // ─── Subagent Pet System ─────────────────────────────────────────

    socket.on("subagent:spawn", ({ runId, taskType, taskLabel }) => {
      if (!socket.data.isBot || !room) return;
      if (typeof runId !== "string" || !runId) return;

      const pet = spawnPet({
        io, room,
        agentId: socket.data.agentId || socket.id,
        runId,
        taskType,
        taskLabel,
        findPath,
        generateRandomPosition,
      });

      if (pet) {
        socket.emit("subagent:petSpawned", { runId, petId: pet.id });
      }
    });

    socket.on("subagent:complete", ({ runId }) => {
      if (typeof runId !== "string" || !runId) return;
      const success = despawnPet({ io, runId, rooms });
      if (success) {
        socket.emit("subagent:petDespawned", { runId });
      }
    });

    socket.on("subagent:status", (_, callback) => {
      if (typeof callback !== "function") return;
      const agentId = socket.data.agentId || socket.id;
      callback(getAgentPets(agentId));
    });

    // ─── GitHub Code Assistant ───────────────────────────────────────

    socket.on("github:auth", async ({ token: ghToken }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "auth", error: "Not authenticated" });
        const ghUser = await githubService.validateToken(ghToken);
        githubStore.setConnection(userId, { token: ghToken, githubUsername: ghUser.login });
        socket.emit("github:authSuccess", { username: ghUser.login });
      } catch (err) {
        socket.emit("github:error", { action: "auth", error: err.message });
      }
    });

    socket.on("github:connectRepo", async ({ owner, repo }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "connectRepo", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "connectRepo", error: "GitHub not connected. Use /repo auth <token> first." });
        const treeData = await githubService.fetchRepoTree(conn.token, owner, repo);
        githubStore.addRepo(userId, owner, repo, { fileCount: treeData.tree.length, defaultBranch: "main" });
        githubStore.setRepoTreeCache(userId, owner, repo, treeData.tree);
        socket.emit("github:repoConnected", { owner, repo, defaultBranch: "main", fileCount: treeData.tree.length });
      } catch (err) {
        socket.emit("github:error", { action: "connectRepo", error: err.message });
      }
    });

    socket.on("github:askQuestion", async ({ question, repoKey, files }) => {
      const petRunId = `gh_ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let petSpawned = false;
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "askQuestion", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "askQuestion", error: "GitHub not connected" });

        // Spawn a pet for this task
        if (room) {
          const pet = spawnPet({
            io, room,
            agentId: socket.data.agentId || socket.id,
            runId: petRunId,
            taskType: "askQuestion",
            taskLabel: "answering...",
            findPath,
            generateRandomPosition,
          });
          petSpawned = !!pet;
        }

        // Determine which repo to use
        const repos = githubStore.getRepos(userId);
        let targetRepo = repos[0]; // default to first
        if (repoKey) {
          const [o, r] = repoKey.split("/");
          targetRepo = repos.find(rp => rp.owner === o && rp.repo === r) || targetRepo;
        }
        if (!targetRepo) return socket.emit("github:error", { action: "askQuestion", error: "No repo connected" });

        const { owner, repo } = targetRepo;
        const rk = `${owner}/${repo}`;

        // Get repo context
        const cached = githubStore.getRepoTreeCache(userId, owner, repo);
        let repoContext = "";
        if (cached) {
          repoContext = cached.filter(f => f.type === "blob").map(f => f.path).join("\n");
        } else {
          const treeData = await githubService.fetchRepoTree(conn.token, owner, repo);
          githubStore.setRepoTreeCache(userId, owner, repo, treeData.tree);
          repoContext = treeData.tree.filter(f => f.type === "blob").map(f => f.path).join("\n");
        }

        // Optionally fetch file contents
        const fileContents = {};
        if (files && Array.isArray(files)) {
          for (const fp of files.slice(0, 5)) {
            try {
              const fd = await githubService.fetchFileContent(conn.token, owner, repo, fp);
              fileContents[fp] = fd.content;
            } catch { /* skip */ }
          }
        }

        // Stream the response
        const fullAnswer = await llmBridge.streamCodeQuestion({
          question, repoContext, fileContents,
          onChunk: (chunk) => {
            if (chunk === null) {
              socket.emit("github:answerChunk", { chunk: "", repoKey: rk, done: true });
            } else {
              socket.emit("github:answerChunk", { chunk, repoKey: rk, done: false });
            }
          },
        });

        socket.emit("github:answer", { question, answer: fullAnswer, model: "claude-sonnet-4-20250514", repoKey: rk, id: `ans_${Date.now()}` });
      } catch (err) {
        socket.emit("github:error", { action: "askQuestion", error: err.message });
      } finally {
        if (petSpawned) despawnPet({ io, runId: petRunId, rooms });
      }
    });

    socket.on("github:getFiles", async ({ repoKey, path: dirPath }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "getFiles", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "getFiles", error: "GitHub not connected" });

        const repos = githubStore.getRepos(userId);
        let targetRepo = repos[0];
        if (repoKey) {
          const [o, r] = repoKey.split("/");
          targetRepo = repos.find(rp => rp.owner === o && rp.repo === r) || targetRepo;
        }
        if (!targetRepo) return socket.emit("github:error", { action: "getFiles", error: "No repo connected" });

        const { owner, repo } = targetRepo;
        const rk = `${owner}/${repo}`;
        const treeData = await githubService.fetchRepoTree(conn.token, owner, repo);
        githubStore.setRepoTreeCache(userId, owner, repo, treeData.tree);

        let tree = treeData.tree;
        if (dirPath) {
          tree = tree.filter(f => f.path.startsWith(dirPath));
        }

        socket.emit("github:fileTree", { repoKey: rk, tree, truncated: treeData.truncated });
      } catch (err) {
        socket.emit("github:error", { action: "getFiles", error: err.message });
      }
    });

    socket.on("github:getFile", async ({ repoKey, path: filePath }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "getFile", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "getFile", error: "GitHub not connected" });

        const [owner, repo] = (repoKey || "").split("/");
        if (!owner || !repo) return socket.emit("github:error", { action: "getFile", error: "Invalid repoKey" });

        const fileData = await githubService.fetchFileContent(conn.token, owner, repo, filePath);
        socket.emit("github:fileContent", { repoKey, path: filePath, content: fileData.content, sha: fileData.sha });
      } catch (err) {
        socket.emit("github:error", { action: "getFile", error: err.message });
      }
    });

    socket.on("github:createPR", async ({ title, body: prBody, changes, repoKey }) => {
      const petRunId = `gh_pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let petSpawned = false;
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "createPR", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "createPR", error: "GitHub not connected" });

        // Spawn a pet for this task
        if (room) {
          const pet = spawnPet({
            io, room,
            agentId: socket.data.agentId || socket.id,
            runId: petRunId,
            taskType: "createPR",
            taskLabel: "creating PR...",
            findPath,
            generateRandomPosition,
          });
          petSpawned = !!pet;
        }

        const repos = githubStore.getRepos(userId);
        let targetRepo = repos[0];
        if (repoKey) {
          const [o, r] = repoKey.split("/");
          targetRepo = repos.find(rp => rp.owner === o && rp.repo === r) || targetRepo;
        }
        if (!targetRepo) return socket.emit("github:error", { action: "createPR", error: "No repo connected" });

        const { owner, repo } = targetRepo;
        const rk = `${owner}/${repo}`;

        // Get the default branch ref for branching
        const baseSha = await githubService.fetchDefaultBranchSha(conn.token, owner, repo);
        const branchName = `ocw-${Date.now()}`;
        await githubService.createBranch(conn.token, owner, repo, branchName, baseSha);

        if (changes && Array.isArray(changes)) {
          for (const change of changes) {
            // Fetch existing file SHA to support updating existing files
            let existingSha;
            try {
              const existing = await githubService.fetchFileContent(conn.token, owner, repo, change.path);
              existingSha = existing.sha;
            } catch {
              // File doesn't exist yet — that's fine, create it
            }
            await githubService.createOrUpdateFile(conn.token, owner, repo, change.path, change.content, change.message || title, branchName, existingSha);
          }
        }

        const pr = await githubService.createPullRequest(conn.token, owner, repo, title, prBody || "", branchName, "main");
        socket.emit("github:prCreated", { repoKey: rk, number: pr.number, html_url: pr.html_url });
      } catch (err) {
        socket.emit("github:error", { action: "createPR", error: err.message });
      } finally {
        if (petSpawned) despawnPet({ io, runId: petRunId, rooms });
      }
    });

    socket.on("github:listIssues", async ({ repoKey }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "listIssues", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "listIssues", error: "GitHub not connected" });

        const [owner, repo] = (repoKey || "").split("/");
        if (!owner || !repo) return socket.emit("github:error", { action: "listIssues", error: "Invalid repoKey" });

        const issues = await githubService.listIssues(conn.token, owner, repo);
        socket.emit("github:issuesList", { repoKey, issues });
      } catch (err) {
        socket.emit("github:error", { action: "listIssues", error: err.message });
      }
    });

    socket.on("github:createIssue", async ({ repoKey, title, body, labels, guidelineFiles }) => {
      const petRunId = `gh_issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let petSpawned = false;
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "createIssue", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "createIssue", error: "GitHub not connected" });

        // Spawn a pet for this task
        if (room) {
          const pet = spawnPet({
            io, room,
            agentId: socket.data.agentId || socket.id,
            runId: petRunId,
            taskType: "createIssue",
            taskLabel: "creating issue...",
            findPath,
            generateRandomPosition,
          });
          petSpawned = !!pet;
        }

        const [owner, repo] = (repoKey || "").split("/");
        if (!owner || !repo) return socket.emit("github:error", { action: "createIssue", error: "Invalid repoKey" });

        const issueBody = appendGuidelineSectionToIssueBody(body, guidelineFiles);
        const issue = await githubService.createIssue(conn.token, owner, repo, title, issueBody, labels);
        socket.emit("github:issueCreated", { repoKey, ...issue });
      } catch (err) {
        socket.emit("github:error", { action: "createIssue", error: err.message });
      } finally {
        if (petSpawned) despawnPet({ io, runId: petRunId, rooms });
      }
    });

    socket.on("github:disconnect", async () => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "disconnect", error: "Not authenticated" });
        githubStore.removeConnection(userId);
        socket.emit("github:disconnected");
      } catch (err) {
        socket.emit("github:error", { action: "disconnect", error: err.message });
      }
    });

    socket.on("github:disconnectRepo", async ({ repoKey }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "disconnectRepo", error: "Not authenticated" });
        if (!repoKey || !repoKey.includes("/")) return socket.emit("github:error", { action: "disconnectRepo", error: "Invalid repoKey" });
        const [owner, repo] = repoKey.split("/");
        githubStore.removeRepo(userId, owner, repo);
        socket.emit("github:repoDisconnected", { repoKey });
      } catch (err) {
        socket.emit("github:error", { action: "disconnectRepo", error: err.message });
      }
    });

    socket.on("github:getIssue", async ({ repoKey, issueNumber }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:error", { action: "getIssue", error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:error", { action: "getIssue", error: "GitHub not connected" });

        const [owner, repo] = (repoKey || "").split("/");
        if (!owner || !repo) return socket.emit("github:error", { action: "getIssue", error: "Invalid repoKey" });

        const issue = await githubService.getIssue(conn.token, owner, repo, issueNumber);
        socket.emit("github:issueDetail", { repoKey, issue });
      } catch (err) {
        socket.emit("github:error", { action: "getIssue", error: err.message });
      }
    });

    socket.on("github:agentFix", async ({ repoKey, issueNumber, guidelineFiles }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return socket.emit("github:agentFixError", { repoKey, issueNumber, error: "Not authenticated" });
        const conn = githubStore.getConnection(userId);
        if (!conn) return socket.emit("github:agentFixError", { repoKey, issueNumber, error: "GitHub not connected" });

        const [owner, repo] = (repoKey || "").split("/");
        if (!owner || !repo) return socket.emit("github:agentFixError", { repoKey, issueNumber, error: "Invalid repoKey" });

        const issue = await githubService.getIssue(conn.token, owner, repo, issueNumber);

        const result = await solveIssue({
          token: conn.token,
          owner,
          repo,
          issue,
          io,
          room,
          rooms,
          socket,
          findPath,
          generateRandomPosition,
          guidelineFiles: normalizeGuidelineFiles(guidelineFiles),
        });

        socket.emit("github:agentFixComplete", {
          repoKey,
          issueNumber,
          pr: result.pr,
        });
      } catch (err) {
        console.error("[github:agentFix] Error:", err.message);
        socket.emit("github:agentFixError", {
          repoKey,
          issueNumber,
          error: err.message,
        });
      }
    });

      socket.on("disconnect", () => {
        console.log("User disconnected");
        cancelQueue(socket.id);
        unsitCharacter(room, socket.id, broadcastToRoom);
        if (room && character?.position) {
          ensureCellOccupancy(room);
          vacateCell(room, character.position[0], character.position[1], socket.id);
        }
        detachUserSocket();
        cleanupObjectives(socket.id);
        cleanupNeeds(socket.id);
        // Clean up pet companions for this agent
        despawnAllAgentPets({ io, agentId: socket.data.agentId || socket.id, rooms });
        // Clean up agent socket mapping
        if (socket.data.agentId) {
          agentSocketMap.delete(socket.data.agentId);
        }
        if (room) {
          cancelAutoWavesForCharacter(room.id, socket.id);
          cancelProximityGreetingsForCharacter(room.id, socket.id);
          cleanupBotActivityTracking(socket.id);
          if (character?.isBot) {
            if (!room.characters.some((c) => c.id !== socket.id && c.isBot))
              stopRoomChatterInterval(room.id);
          }
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
