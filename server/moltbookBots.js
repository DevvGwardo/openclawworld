// --- Moltbook Virtual Bots: extracted from server/index.js ---
// Factory function that receives all dependencies and returns the moltbook bot system.

import crypto from "crypto";

function createMoltbookSystem(deps) {
  const {
    io,
    rooms,
    items,
    itemsCatalog,
    ALLOWED_EMOTES,
    ROOM_ZONES,
    scaleZoneArea,
    ENTRANCE_ZONE,
    findPath,
    updateGrid,
    addItemToGrid,
    getCachedRoom,
    getAllCachedRooms,
    persistRooms,
    broadcastToRoom: externalBroadcastToRoom,
    stripCharacters,
    generateRandomPosition,
    randomAvatarUrl,
    unsitCharacter,
    ensureSeatMaps,
    getSitSpots,
    normalizeAngle,
    DEFAULT_SIT_FACING_OFFSET,
  } = deps;

  // --- Moltbook Virtual Bots: fetch posts and spawn them as live characters ---
  const MOLTBOOK_API = "https://www.moltbook.com/api/v1/posts";
  const MOLTBOOK_BOT_COUNT = 50;
  const MOLTBOOK_REFRESH_INTERVAL = 30_000; // fetch new data & cull stale bots every 30s
  const MOLTBOOK_TICK_INTERVAL = 4_000; // bots act every 4 seconds
  const MOLTBOOK_MAX_ACTIONS_PER_TICK = 20; // cap bot actions per tick to limit broadcast storm

  const extractBotName = (title) => {
    const mention = title.match(/@(\w+)/);
    if (mention) return mention[1];
    const token = title.match(/\$(\w+)/);
    if (token) return token[1];
    for (const re of [
      /(?:I am|I'm|Meet|Introducing)\s+(\w+)/i,
      /^(\w+)\s+is\s+(?:online|live|here|born)/i,
      /(\w+)\s+Has Arrived/i,
    ]) {
      const m = title.match(re);
      if (m) return m[1];
    }
    const skip = new Set(["the","a","an","i","is","am","are","was","were","be","been",
      "to","of","in","for","on","with","at","by","from","and","or","not","no","but",
      "that","this","it","its","my","your","his","her","our","just","about","what",
      "how","why","when","all","new","will","can","has","have","had"]);
    const words = (title.match(/[A-Za-z]+/g) || []).filter(w => !skip.has(w.toLowerCase()) && w.length > 2);
    if (words.length > 0) {
      const name = words.slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1)).join("");
      if (name.length >= 3) return name;
    }
    return null;
  };

  // Pool of fetched posts and active virtual bots
  let moltbookPostPool = [];
  let prevMoltbookPostIds = new Set();
  let moltbookPageOffset = 0;
  const moltbookVirtualBots = new Map(); // id -> { character, postData, joinedAt }

  const fetchMoltbookPosts = async () => {
    try {
      const allPosts = [];
      for (let offset = 0; offset < 300; offset += 50) {
        const resp = await fetch(`${MOLTBOOK_API}?limit=50&offset=${offset}`);
        if (!resp.ok) break;
        const data = await resp.json();
        allPosts.push(...(data.posts || []));
        if (!data.has_more) break;
      }
      if (allPosts.length > 0) {
        moltbookPostPool = allPosts;
        console.log(`[moltbook] Fetched ${allPosts.length} posts`);
      }
    } catch (err) {
      console.error("[moltbook] Fetch error:", err.message);
    }
  };

  const spawnMoltbookBot = (room) => {
    if (moltbookPostPool.length === 0 || !room) return null;

    // Pick a random post — prefer unused ones, but allow reuse if pool is exhausted
    const activePostIds = new Set([...moltbookVirtualBots.values()].map(b => b.postData.id));
    const available = moltbookPostPool.filter(p => !activePostIds.has(p.id));
    const post = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : moltbookPostPool[Math.floor(Math.random() * moltbookPostPool.length)];
    const title = post.title || "";

    // Derive name
    let name = extractBotName(title);
    const existingNames = new Set(room.characters.map(c => (c.name || "").toLowerCase()));
    if (!name || name.length < 2 || existingNames.has(name.toLowerCase())) {
      const hash = crypto.createHash("md5").update(post.id).digest("hex").slice(0, 4);
      name = `Molt-${hash}`;
    }
    let finalName = name.slice(0, 28);
    let counter = 2;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${name.slice(0, 26)}${counter}`;
      counter++;
    }

    const botId = `moltbot-${crypto.randomBytes(4).toString("hex")}`;
    const character = {
      id: botId,
      session: parseInt(Math.random() * 1000),
      position: generateRandomPosition(room),
      avatarUrl: randomAvatarUrl(),
      isBot: true,
      name: finalName,
    };

    room.characters.push(character);
    moltbookVirtualBots.set(botId, {
      character,
      postData: post,
      joinedAt: Date.now(),
      lastAction: 0,
    });
    moltbookBotRooms.set(botId, room.id);

    return character;
  };

  const removeMoltbookBot = (botId, room) => {
    const bot = moltbookVirtualBots.get(botId);
    if (!bot) return;
    // If no room specified, look up which room the bot is in
    const targetRoom = room || getBotRoom(botId);
    if (targetRoom) {
      const idx = targetRoom.characters.findIndex(c => c.id === botId);
      if (idx !== -1) targetRoom.characters.splice(idx, 1);
      // Emit incremental removal event instead of full character list
      io.to(targetRoom.id).emit("characterLeft", {
        id: botId,
        name: bot.character.name || "Bot",
        isBot: true,
        roomName: targetRoom.name,
      });
    }
    moltbookBotRooms.delete(botId);
    pendingRoomSwitch.delete(botId);
    moltbookVirtualBots.delete(botId);
  };

  // Broadcast helpers for virtual bots (they don't have sockets, so we emit directly)
  const broadcastToRoom = (roomId, event, data) => {
    io.to(roomId).emit(event, data);
  };

  const broadcastMoltbookPosts = () => {
    const currentIds = new Set(moltbookPostPool.map((p) => p.id));
    const added = moltbookPostPool
      .filter((p) => !prevMoltbookPostIds.has(p.id))
      .map((p) => ({
        id: p.id,
        title: p.title || "",
        content: (p.content || "").slice(0, 300),
        authorName: p.author?.name || p.author_name || "",
        submoltName: p.submolt?.display_name || p.submolt_display_name || "",
        upvotes: p.upvotes || 0,
        downvotes: p.downvotes || 0,
        commentCount: p.comment_count || 0,
        createdAt: p.created_at || "",
      }));
    const removed = [...prevMoltbookPostIds].filter((id) => !currentIds.has(id));
    prevMoltbookPostIds = currentIds;
    if (added.length > 0 || removed.length > 0) {
      io.emit("moltbookPostsDelta", { added, removed });
    }
  };

  // --- Moltbook bot building: room layout templates ---
  // ROOM_ZONES imported via deps

  // Compute a style analysis of a room's current furnishing state
  const computeRoomStyle = (room) => {
    const totalCells = room.size[0] * room.gridDivision * room.size[1] * room.gridDivision;
    const totalItems = room.items.length;

    const zones = ROOM_ZONES.map((zone) => {
      const scaled = scaleZoneArea(zone.area, room);
      const zoneItems = room.items.filter((item) => {
        const [ix, iy] = item.gridPosition;
        return (
          ix >= scaled.x[0] && ix < scaled.x[1] &&
          iy >= scaled.y[0] && iy < scaled.y[1]
        );
      });
      const zoneCells =
        (scaled.x[1] - scaled.x[0]) * (scaled.y[1] - scaled.y[0]);
      return {
        name: zone.name,
        area: scaled,
        items: zoneItems.map((i) => i.name),
        itemCount: zoneItems.length,
        coverage: zoneCells > 0 ? +(zoneItems.length / zoneCells).toFixed(4) : 0,
      };
    });

    const dominantZone =
      zones.reduce((best, z) => (z.itemCount > best.itemCount ? z : best), zones[0])?.name || null;
    const emptyZones = zones.filter((z) => z.itemCount === 0).map((z) => z.name);
    const furnishedZones = zones.filter((z) => z.itemCount > 0).map((z) => z.name);

    return {
      zones,
      totalItems,
      density: totalCells > 0 ? +(totalItems / totalCells).toFixed(4) : 0,
      dominantZone,
      emptyZones,
      furnishedZones,
    };
  };

  const tryPlaceItemInRoom = (room, itemName, area) => {
    const itemDef = items[itemName];
    if (!itemDef) return false;

    const rot = itemDef.rotation ?? 0;
    const width = rot === 1 || rot === 3 ? itemDef.size[1] : itemDef.size[0];
    const height = rot === 1 || rot === 3 ? itemDef.size[0] : itemDef.size[1];
    const maxGrid = room.size[0] * room.gridDivision;

    // Try random positions within the zone area
    for (let attempt = 0; attempt < 20; attempt++) {
      const gx = area.x[0] + Math.floor(Math.random() * (area.x[1] - area.x[0] - width));
      const gy = area.y[0] + Math.floor(Math.random() * (area.y[1] - area.y[0] - height));

      if (gx < 0 || gy < 0 || gx + width > maxGrid || gy + height > maxGrid) continue;

      // Skip collision check for walkable/wall items
      if (!itemDef.walkable && !itemDef.wall) {
        let blocked = false;
        for (let x = 0; x < width && !blocked; x++) {
          for (let y = 0; y < height && !blocked; y++) {
            if (!room.grid.isWalkableAt(gx + x, gy + y)) blocked = true;
          }
        }
        if (blocked) continue;
      }

      const newItem = {
        name: itemDef.name,
        size: itemDef.size,
        gridPosition: [gx, gy],
        rotation: rot,
      };
      if (itemDef.walkable) newItem.walkable = true;
      if (itemDef.wall) newItem.wall = true;

      room.items.push(newItem);
      addItemToGrid(room, newItem);
      return true;
    }
    return false;
  };

  // Pending build tasks for bots — tracks multi-step building flow
  const pendingBuilds = new Map(); // botId → { stage, itemName, zone, targetPos, startedAt }
  // Pending sit timers for bots — tracks when they should stand up
  const pendingBotSits = new Map(); // botId → setTimeout handle

  // Pending room switches for bots walking to entrance zone
  const pendingRoomSwitch = new Map(); // botId → { targetRoomId, walkingToEntrance }

  // Track which room each moltbook bot is in (default: plaza / rooms[0])
  const moltbookBotRooms = new Map(); // botId → roomId

  const THINKING_PHRASES = [
    "Hmm, what should go here...",
    "Let me think about this...",
    "Looking around for ideas...",
    "What would look good here?",
    "Considering the layout...",
    "Maybe something for this area...",
    "I have an idea...",
    "Let me figure this out...",
  ];

  const BUILDING_PHRASES = (itemName) => {
    const pretty = itemName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
    return [
      `Placing a ${pretty}...`,
      `Setting up the ${pretty}...`,
      `This ${pretty} should work here`,
      `Adding a ${pretty} to the room`,
      `Let me put this ${pretty} right here`,
    ];
  };

  // Helper: get the room a moltbook bot is currently in
  const getBotRoom = (botId) => {
    const roomId = moltbookBotRooms.get(botId);
    if (roomId) return rooms.find(r => r.id === roomId);
    return getCachedRoom("plaza"); // default to plaza
  };

  // Transfer a moltbook bot from one room to another
  const transferMoltbookBot = (botId, fromRoom, toRoom) => {
    const bot = moltbookVirtualBots.get(botId);
    if (!bot || !fromRoom || !toRoom) return;

    // Unsit bot if sitting
    unsitCharacter(fromRoom, botId);
    if (pendingBotSits.has(botId)) {
      clearTimeout(pendingBotSits.get(botId));
      pendingBotSits.delete(botId);
    }

    // Capture info before removal
    const charName = bot.character.name || "Bot";
    const charIsBot = bot.character.isBot || true;

    // Remove from old room
    const idx = fromRoom.characters.findIndex(c => c.id === botId);
    if (idx !== -1) fromRoom.characters.splice(idx, 1);
    io.to(fromRoom.id).emit("characterLeft", {
      id: botId,
      name: charName,
      isBot: charIsBot,
      roomName: fromRoom.name,
    });

    // Add to new room with random position
    bot.character.position = generateRandomPosition(toRoom);
    bot.character.path = undefined;
    toRoom.characters.push(bot.character);
    moltbookBotRooms.set(botId, toRoom.id);
    io.to(toRoom.id).emit("characterJoined", {
      character: stripCharacters([bot.character])[0],
      roomName: toRoom.name,
    });

    // Broadcast room counts
    io.emit("roomsUpdate", rooms.map(r => ({ id: r.id, name: r.name, nbCharacters: r.characters.length, claimedBy: r.claimedBy || null, generated: r.generated || false })));
  };

  // Bot behavior tick — each bot randomly moves, chats, or emotes
  // Optimized: caps actions per tick, batches movement broadcasts per room,
  // and removes redundant playerAction status messages to reduce socket traffic.
  const moltbookBotTick = () => {
    const now = Date.now();

    // Process pending room switches — check if bots have reached entrance zone
    for (const [botId, switchData] of pendingRoomSwitch) {
      const bot = moltbookVirtualBots.get(botId);
      if (!bot) { pendingRoomSwitch.delete(botId); continue; }

      if (now - switchData.startedAt > 3500) {
        const fromRoom = getBotRoom(botId);
        const toRoom = rooms.find(r => r.id === switchData.targetRoomId);
        if (fromRoom && toRoom) {
          transferMoltbookBot(botId, fromRoom, toRoom);
        }
        pendingRoomSwitch.delete(botId);
        bot.lastAction = now;
      }
    }

    // Process pending builds (multi-step building flow)
    for (const [botId, build] of pendingBuilds) {
      const bot = moltbookVirtualBots.get(botId);
      if (!bot) { pendingBuilds.delete(botId); continue; }
      const room = getBotRoom(botId);
      if (!room) { pendingBuilds.delete(botId); continue; }

      if (build.stage === "thinking" && now - build.startedAt > 2500) {
        const zone = build.zone;
        const needed = zone.items.filter(name => {
          const count = room.items.filter(i => i.name === name).length;
          if (["chair", "chairCushion", "chairModernCushion", "stoolBar", "stoolBarSquare", "plantSmall", "plant", "lampRoundFloor", "lampSquareFloor"].includes(name)) {
            return count < 3;
          }
          return count < 1;
        });

        if (needed.length === 0) {
          broadcastToRoom(room.id, "playerAction", { id: botId, action: null });
          pendingBuilds.delete(botId);
          continue;
        }

        const itemName = needed[Math.floor(Math.random() * needed.length)];
        const scaledArea = scaleZoneArea(zone.area, room);
        const targetX = Math.floor((scaledArea.x[0] + scaledArea.x[1]) / 2);
        const targetY = Math.floor((scaledArea.y[0] + scaledArea.y[1]) / 2);
        const pos = bot.character.position || [0, 0];
        const maxGrid = room.size[0] * room.gridDivision - 1;
        const tx = Math.max(0, Math.min(maxGrid, targetX));
        const ty = Math.max(0, Math.min(maxGrid, targetY));

        if (room.grid.isWalkableAt(tx, ty)) {
          const path = findPath(room, pos, [tx, ty]);
          if (path && path.length > 0) {
            bot.character.position = pos;
            bot.character.path = path;
            broadcastToRoom(room.id, "playerMove", bot.character);
            bot.character.position = path[path.length - 1];
          }
        }

        const phrases = BUILDING_PHRASES(itemName);
        broadcastToRoom(room.id, "playerAction", {
          id: botId,
          action: "building",
          detail: phrases[Math.floor(Math.random() * phrases.length)],
        });

        build.stage = "building";
        build.itemName = itemName;
        build.startedAt = now;
      } else if (build.stage === "building" && now - build.startedAt > 3000) {
        const placed = tryPlaceItemInRoom(room, build.itemName, scaleZoneArea(build.zone.area, room));
        if (placed) {
          io.to(room.id).emit("mapUpdate", {
            map: {
              gridDivision: room.gridDivision,
              size: room.size,
              items: room.items,
            },
          });
          persistRooms(room);
          const pretty = build.itemName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
          broadcastToRoom(room.id, "playerAction", {
            id: botId,
            action: "done",
            detail: `Finished placing the ${pretty}!`,
          });
        }

        setTimeout(() => {
          broadcastToRoom(room.id, "playerAction", { id: botId, action: null });
        }, 2000);
        pendingBuilds.delete(botId);
        bot.lastAction = now;
      }
    }

    // Collect movement updates per room to batch-broadcast
    const roomMoves = new Map(); // roomId -> [characterData, ...]

    const queueMove = (roomId, charData) => {
      if (!roomMoves.has(roomId)) roomMoves.set(roomId, []);
      roomMoves.get(roomId).push({ ...charData });
    };

    // Cap the number of bot actions per tick to avoid broadcast storms
    let actionsThisTick = 0;

    for (const [botId, bot] of moltbookVirtualBots) {
      if (actionsThisTick >= MOLTBOOK_MAX_ACTIONS_PER_TICK) break;
      if (pendingBuilds.has(botId)) continue;
      if (pendingRoomSwitch.has(botId)) continue;
      if (pendingBotSits.has(botId)) continue; // currently sitting, skip

      // Wider stagger window: 6-14 seconds per bot (was 4-8)
      if (now - bot.lastAction < 6000 + Math.random() * 8000) continue;
      bot.lastAction = now;
      actionsThisTick++;

      const room = getBotRoom(botId);
      if (!room) continue;

      const action = Math.random();

      // Unsit bot before any action (if sitting without pending timer, clean up)
      ensureSeatMaps(room);
      if (room.characterSeats.has(botId)) {
        unsitCharacter(room, botId);
        if (pendingBotSits.has(botId)) {
          clearTimeout(pendingBotSits.get(botId));
          pendingBotSits.delete(botId);
        }
      }

      // ~5% chance to switch rooms
      if (action < 0.05) {
        const plaza = getCachedRoom("plaza");
        const isInPlaza = room.id === (plaza ? plaza.id : "plaza");

        if (isInPlaza) {
          const allCached = getAllCachedRooms();
          const generatedRooms = allCached.filter(r => r.generated);
          const targetRoom = generatedRooms.length > 0
            ? generatedRooms[Math.floor(Math.random() * generatedRooms.length)]
            : null;
          if (targetRoom) {
            const pos = bot.character.position || [0, 0];
            const ex = ENTRANCE_ZONE.x[0] + Math.floor(Math.random() * (ENTRANCE_ZONE.x[1] - ENTRANCE_ZONE.x[0]));
            const ey = ENTRANCE_ZONE.y[0] + Math.floor(Math.random() * (ENTRANCE_ZONE.y[1] - ENTRANCE_ZONE.y[0]));

            if (room.grid.isWalkableAt(ex, ey)) {
              const path = findPath(room, pos, [ex, ey]);
              if (path && path.length > 0) {
                bot.character.position = pos;
                bot.character.path = path;
                queueMove(room.id, bot.character);
                bot.character.position = path[path.length - 1];
              }
            }

            pendingRoomSwitch.set(botId, { targetRoomId: targetRoom.id, startedAt: now });
          }
        } else {
          const pos = bot.character.position || [0, 0];
          const maxGrid = room.size[0] * room.gridDivision - 1;
          const cx = Math.floor(maxGrid / 2);
          const cy = Math.floor(maxGrid / 2);

          if (room.grid.isWalkableAt(cx, cy)) {
            const path = findPath(room, pos, [cx, cy]);
            if (path && path.length > 0) {
              bot.character.position = pos;
              bot.character.path = path;
              queueMove(room.id, bot.character);
              bot.character.position = path[path.length - 1];
            }
          }

          pendingRoomSwitch.set(botId, { targetRoomId: plaza.id, startedAt: now });
        }
        continue;
      }

      if (action < 0.50) {
        // Move — no redundant "walking" playerAction broadcast
        const pos = bot.character.position || [0, 0];
        const maxGrid = room.size[0] * room.gridDivision - 1;
        let newX, newY;

        if (room.size[0] <= 30 && ROOM_ZONES.length > 0) {
          const zone = ROOM_ZONES[Math.floor(Math.random() * ROOM_ZONES.length)];
          const scaled = scaleZoneArea(zone.area, room);
          const zw = scaled.x[1] - scaled.x[0];
          const zh = scaled.y[1] - scaled.y[0];
          newX = Math.max(0, Math.min(maxGrid, scaled.x[0] + Math.floor(Math.random() * zw)));
          newY = Math.max(0, Math.min(maxGrid, scaled.y[0] + Math.floor(Math.random() * zh)));
        } else {
          const range = 8;
          newX = Math.max(0, Math.min(maxGrid, pos[0] + Math.floor(Math.random() * range * 2) - range));
          newY = Math.max(0, Math.min(maxGrid, pos[1] + Math.floor(Math.random() * range * 2) - range));
        }

        if (room.grid.isWalkableAt(newX, newY)) {
          const path = findPath(room, pos, [newX, newY]);
          if (path && path.length > 0) {
            bot.character.position = pos;
            bot.character.path = path;
            queueMove(room.id, bot.character);
            bot.character.position = path[path.length - 1];
          }
        }
      } else if (action < 0.58) {
        // Interact with a nearby bot/player
        const nearbyChars = room.characters.filter(c => c.id !== botId);
        if (nearbyChars.length > 0) {
          const target = nearbyChars[Math.floor(Math.random() * nearbyChars.length)];

          const pos = bot.character.position || [0, 0];
          const targetPos = target.position || [0, 0];
          const offsetX = Math.floor(Math.random() * 3) - 1;
          const offsetY = Math.floor(Math.random() * 3) - 1;
          const nearX = Math.max(0, Math.min(room.size[0] * room.gridDivision - 1, targetPos[0] + offsetX));
          const nearY = Math.max(0, Math.min(room.size[1] * room.gridDivision - 1, targetPos[1] + offsetY));

          if (room.grid.isWalkableAt(nearX, nearY)) {
            const path = findPath(room, pos, [nearX, nearY]);
            if (path && path.length > 0) {
              bot.character.position = pos;
              bot.character.path = path;
              queueMove(room.id, bot.character);
              bot.character.position = path[path.length - 1];
            }
          }

          // Single emote broadcast instead of multiple
          const interactionType = Math.random();
          if (interactionType < 0.5) {
            broadcastToRoom(room.id, "emote:play", { id: botId, emote: "wave" });
          } else if (interactionType < 0.8) {
            broadcastToRoom(room.id, "emote:play", { id: botId, emote: "nod" });
          } else {
            broadcastToRoom(room.id, "playerDance", { id: botId });
          }
        }
      } else if (action < 0.68) {
        // Chat — skip "Typing..." status, just send the message
        const content = bot.postData.content || bot.postData.title || "";
        const sentences = content.match(/[^.!?]+[.!?]*/g) || [content];
        const msg = (sentences[Math.floor(Math.random() * sentences.length)] || "").trim().slice(0, 200);
        if (msg.length > 0) {
          broadcastToRoom(room.id, "playerChatMessage", { id: botId, message: msg });
        }
      } else if (action < 0.78) {
        // Emote — single broadcast
        const emote = ALLOWED_EMOTES[Math.floor(Math.random() * ALLOWED_EMOTES.length)];
        broadcastToRoom(room.id, "emote:play", { id: botId, emote });
      } else if (action < 0.85) {
        // Dance — single broadcast
        broadcastToRoom(room.id, "playerDance", { id: botId });
      } else if (action < 0.93) {
        // Sit on furniture (~8% chance)
        const sittableItems = [];
        room.items.forEach((it, idx) => {
          const def = itemsCatalog[it.name];
          if (def && def.sittable) sittableItems.push({ item: it, idx, sittable: def.sittable });
        });
        if (sittableItems.length > 0) {
          const pick = sittableItems[Math.floor(Math.random() * sittableItems.length)];
          ensureSeatMaps(room);
          const facingOffset = pick.sittable.facingOffset ?? DEFAULT_SIT_FACING_OFFSET;
          const allSpots = getSitSpots(room, pick.item, pick.sittable, facingOffset);
          // Filter available spots
          let occupiedCount = 0;
          for (const [key] of room.seatOccupancy) {
            if (key.startsWith(`${pick.idx}-`)) occupiedCount++;
          }
          if (occupiedCount < pick.sittable.seats) {
            let available = allSpots.filter((s) => {
              if (room.seatOccupancy.has(`${pick.idx}-${s.seatIdx}`)) return false;
              return room.grid.isWalkableAt(s.walkTo[0], s.walkTo[1]);
            });
            // Prefer the furniture-facing edge so bots don't sit backwards
            // depending on approach direction.
            if (available.length > 0 && pick.sittable.preferFacing !== false) {
              const desired = normalizeAngle(((pick.item.rotation || 0) * Math.PI) / 2 + facingOffset);
              const angleDelta = (a, b) => {
                const d = Math.abs(a - b) % (Math.PI * 2);
                return d > Math.PI ? (Math.PI * 2) - d : d;
              };
              const preferred = available.filter((s) => angleDelta(s.seatRotation, desired) < 0.01);
              if (preferred.length > 0) available = preferred;
            }
            if (available.length > 0) {
              const pos = bot.character.position || [0, 0];
              available.sort((a, b) => {
                const da = (a.walkTo[0] - pos[0]) ** 2 + (a.walkTo[1] - pos[1]) ** 2;
                const db = (b.walkTo[0] - pos[0]) ** 2 + (b.walkTo[1] - pos[1]) ** 2;
                return da - db;
              });
              const spot = available[0];
              const path = findPath(room, pos, spot.walkTo);
              if (path && path.length > 0) {
                // Reserve seat
                room.seatOccupancy.set(`${pick.idx}-${spot.seatIdx}`, botId);
                room.characterSeats.set(botId, {
                  itemIndex: pick.idx,
                  seatIdx: spot.seatIdx,
                  seatPos: spot.seatPos,
                  seatHeight: spot.seatHeight,
                  seatRotation: spot.seatRotation,
                });

                bot.character.position = pos;
                bot.character.path = path;
                bot.character.position = path[path.length - 1];

                // Broadcast sit
                broadcastToRoom(room.id, "playerSit", {
                  id: botId,
                  path,
                  seatPos: spot.seatPos,
                  seatHeight: spot.seatHeight,
                  seatRotation: spot.seatRotation,
                  itemIndex: pick.idx,
                });

                // Stand up after 10-20 seconds
                const sitDuration = 10000 + Math.random() * 10000;
                const timer = setTimeout(() => {
                  pendingBotSits.delete(botId);
                  const currentRoom = getBotRoom(botId);
                  if (currentRoom) unsitCharacter(currentRoom, botId);
                }, sitDuration);
                pendingBotSits.set(botId, timer);
              }
            }
          }
        }
      } else {
        // Build
        const zone = ROOM_ZONES[Math.floor(Math.random() * ROOM_ZONES.length)];
        const needed = zone.items.filter(name => {
          const count = room.items.filter(i => i.name === name).length;
          if (["chair", "chairCushion", "chairModernCushion", "stoolBar", "stoolBarSquare", "plantSmall", "plant", "lampRoundFloor", "lampSquareFloor"].includes(name)) {
            return count < 3;
          }
          return count < 1;
        });

        if (needed.length > 0) {
          const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
          broadcastToRoom(room.id, "playerAction", {
            id: botId,
            action: "thinking",
            detail: phrase,
          });
          pendingBuilds.set(botId, { stage: "thinking", zone, startedAt: now });
        }
      }
    }

    // Batch-broadcast all movement updates per room (single emit per room)
    for (const [roomId, moves] of roomMoves) {
      if (moves.length === 1) {
        io.to(roomId).emit("playerMove", moves[0]);
      } else {
        io.to(roomId).emit("playerMoves", moves);
      }
    }
  };

  // Refresh: fetch new posts, cull bots over limit (oldest first), respawn to fill back
  const moltbookRefresh = async (room) => {
    if (!room) return;

    // Fetch fresh data from the API
    await fetchMoltbookPosts();
    broadcastMoltbookPosts();

    // Remove stale bots if count exceeds limit (oldest first)
    const bots = [...moltbookVirtualBots.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    const excess = bots.length - MOLTBOOK_BOT_COUNT;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        removeMoltbookBot(bots[i][0]); // room is auto-detected via getBotRoom
      }
      console.log(`[moltbook] Culled ${excess} stale bots`);
    }

    // Spawn replacements up to the target count, emitting incremental joins
    let spawned = 0;
    while (moltbookVirtualBots.size < MOLTBOOK_BOT_COUNT) {
      const bot = spawnMoltbookBot(room);
      if (!bot) break; // no more available posts
      io.to(room.id).emit("characterJoined", {
        character: stripCharacters([bot])[0],
        roomName: room.name,
      });
      spawned++;
    }

    // Broadcast room counts only (lightweight)
    io.emit("roomsUpdate", rooms.map(r => ({ id: r.id, name: r.name, nbCharacters: r.characters.length, claimedBy: r.claimedBy || null, generated: r.generated || false })));
    console.log(`[moltbook] Refresh complete — spawned ${spawned}, active: ${moltbookVirtualBots.size}`);
  };

  // Initialize moltbook bots after rooms are loaded
  const initMoltbookBots = async () => {
    await fetchMoltbookPosts();
    const waitForPlaza = () => {
      const plaza = getCachedRoom("plaza");
      if (!plaza) return setTimeout(waitForPlaza, 500);

      const BATCH_SIZE = 25;
      const BATCH_DELAY = 200;
      let spawned = 0;

      const spawnBatch = () => {
        const batchEnd = Math.min(spawned + BATCH_SIZE, MOLTBOOK_BOT_COUNT);
        for (let i = spawned; i < batchEnd; i++) {
          const bot = spawnMoltbookBot(plaza);
          if (bot) moltbookBotRooms.set(bot.id, plaza.id);
        }
        spawned = batchEnd;

        io.to(plaza.id).emit("characters", stripCharacters(plaza.characters));

        if (spawned < MOLTBOOK_BOT_COUNT) {
          setTimeout(spawnBatch, BATCH_DELAY);
        } else {
          broadcastMoltbookPosts();
          console.log(`[moltbook] Spawned ${moltbookVirtualBots.size} virtual bots in "${plaza.name}"`);
          setInterval(() => moltbookBotTick(), MOLTBOOK_TICK_INTERVAL);
          setInterval(() => moltbookRefresh(plaza), MOLTBOOK_REFRESH_INTERVAL);
        }
      };

      spawnBatch();
    };
    waitForPlaza();
  };

  // Return the public API
  return {
    moltbookVirtualBots,
    get moltbookPostPool() { return moltbookPostPool; },
    getBotRoom,
    pendingBuilds,
    init: initMoltbookBots,
    THINKING_PHRASES,
  };
}

export { createMoltbookSystem };
