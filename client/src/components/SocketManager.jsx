import { useGLTF } from "@react-three/drei";
import { atom, useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { activityEventsAtom } from "./ActivityFeed";

export const socket = io(
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000"
);
export const charactersAtom = atom([]);
export const mapAtom = atom(null);
export const userAtom = atom(null);
export const itemsAtom = atom(null);
export const roomIDAtom = atom(null);
export const roomsAtom = atom([]);
export const chatMessagesAtom = atom([]);
export const moltbookPostsAtom = atom([]);
export const usernameAtom = atom(localStorage.getItem("clawland_username") || null);
export const coinsAtom = atom(100);
export const directMessagesAtom = atom({}); // keyed by peerId -> message array
export const activeQuestsAtom = atom([]);
export const questNotificationsAtom = atom([]);
export const roomHasPasswordAtom = atom(true);

// Per-avatar dispatch maps — one global socket listener dispatches to the
// relevant Avatar via O(1) Map lookup instead of N listeners filtering by id.
export const avatarDispatch = {
  playerMove: new Map(),    // id -> handler(value)
  playerDance: new Map(),   // id -> handler(value)
  playerChatMessage: new Map(), // id -> handler(value)
  playerAction: new Map(),  // id -> handler(value)
  playerWaveAt: new Map(),  // id -> handler(value)
  playerSit: new Map(),     // id -> handler(value)
  playerUnsit: new Map(),   // id -> handler(value)
};

// Atom: set of character IDs whose Html overlays should render (nearest 20)
export const htmlVisibleSetAtom = atom(new Set());

export const switchRoom = (roomId) => {
  socket.emit("switchRoom", roomId);
};

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
];
const randomAvatarUrl = () => AVATAR_URLS[Math.floor(Math.random() * AVATAR_URLS.length)];

export const SocketManager = () => {
  const [_characters, setCharacters] = useAtom(charactersAtom);
  const [_chatMessages, setChatMessages] = useAtom(chatMessagesAtom);
  const [_map, setMap] = useAtom(mapAtom);
  const [_user, setUser] = useAtom(userAtom);
  const [items, setItems] = useAtom(itemsAtom);
  const [_rooms, setRooms] = useAtom(roomsAtom);
  const [_roomID, setRoomID] = useAtom(roomIDAtom);
  const [_moltbookPosts, setMoltbookPosts] = useAtom(moltbookPostsAtom);
  const [_activityEvents, setActivityEvents] = useAtom(activityEventsAtom);
  const [username] = useAtom(usernameAtom);
  const [_coins, setCoins] = useAtom(coinsAtom);
  const [_directMessages, setDirectMessages] = useAtom(directMessagesAtom);
  const [_activeQuests, setActiveQuests] = useAtom(activeQuestsAtom);
  const [_questNotifications, setQuestNotifications] = useAtom(questNotificationsAtom);
  const [_roomHasPassword, setRoomHasPassword] = useAtom(roomHasPasswordAtom);

  const charactersRef = useRef([]);
  useEffect(() => { charactersRef.current = _characters; }, [_characters]);

  // Batched position updates from playerMove events — flushed periodically
  // so the proximity sort in CharacterList stays current without re-rendering
  // on every single move event.
  const pendingPositionsRef = useRef(new Map()); // id -> [x, y]
  const flushTimerRef = useRef(null);

  // Store pending welcome data so we can join once username is available
  const pendingWelcomeRef = useRef(null);

  const addActivity = (type, name, isBot, detail) => {
    setActivityEvents((prev) => [
      ...prev.slice(-20),
      { id: `${Date.now()}-${Math.random()}`, type, name, isBot, detail, timestamp: Date.now() },
    ]);
  };

  // When username is set and we have a pending room to join, do the join
  useEffect(() => {
    if (username && pendingWelcomeRef.current) {
      const roomId = pendingWelcomeRef.current;
      pendingWelcomeRef.current = null;
      const avatarUrl =
        localStorage.getItem("avatarURL") || randomAvatarUrl();
      socket.emit("joinRoom", roomId, { avatarUrl, name: username });
      setRoomID(roomId);
    }
  }, [username]);

  useEffect(() => {
    if (!items) {
      return;
    }
    Object.values(items).forEach((item) => {
      useGLTF.preload(`/models/items/${item.name}.glb`);
    });
  }, [items]);
  useEffect(() => {
    function onConnect() {
      console.log("connected");
    }
    function onDisconnect() {
      console.log("disconnected");
    }

    function onWelcome(value) {
      setRooms(value.rooms);
      setItems(value.items);
      if (value.moltbookPosts) setMoltbookPosts(value.moltbookPosts);
      // Join once username is available (may be immediate if stored)
      if (value.rooms && value.rooms.length > 0) {
        const storedName = localStorage.getItem("clawland_username");
        if (storedName) {
          const avatarUrl =
            localStorage.getItem("avatarURL") || randomAvatarUrl();
          socket.emit("joinRoom", value.rooms[0].id, {
            avatarUrl,
            name: storedName,
          });
          setRoomID(value.rooms[0].id);
        } else {
          // Defer join until username is set via WelcomeModal
          pendingWelcomeRef.current = value.rooms[0].id;
        }
      }
    }

    function onRoomJoined(value) {
      setMap(value.map);
      setUser(value.id);
      setCharacters(value.characters);
      setChatMessages([]);
      if (value.coins !== undefined) setCoins(value.coins);
      setRoomHasPassword(value.hasPassword !== false);
    }

    // Merge incoming character list with existing state so that characters
    // whose position hasn't changed keep the SAME object reference.  This
    // prevents React from re-rendering every Avatar (and triggering the
    // snap-to-server-position effect) on every join/leave/refresh broadcast.
    function mergeCharacters(next) {
      const prev = charactersRef.current || [];
      const prevMap = new Map(prev.map((c) => [c.id, c]));
      const nextIds = new Set(next.map((c) => c.id));

      // Detect spawns/despawns for the activity feed
      next.forEach((c) => {
        if (!prevMap.has(c.id)) {
          addActivity("spawn", c.name || "Player", c.isBot);
        }
      });
      prev.forEach((c) => {
        if (!nextIds.has(c.id)) {
          addActivity("despawn", c.name || "Player", c.isBot);
        }
      });

      // Build merged array — reuse old object when position is unchanged
      let changed = prev.length !== next.length;
      const merged = next.map((nc) => {
        const old = prevMap.get(nc.id);
        if (
          old &&
          old.position[0] === nc.position[0] &&
          old.position[1] === nc.position[1] &&
          old.avatarUrl === nc.avatarUrl &&
          old.name === nc.name
        ) {
          return old; // same reference — Avatar won't re-render
        }
        changed = true;
        return nc;
      });

      if (!changed) return; // nothing actually changed — skip atom update entirely
      setCharacters(merged);
    }

    function onCharacters(value) {
      mergeCharacters(value);
    }

    function onMapUpdate(value) {
      setMap(value.map);
      if (value.characters) mergeCharacters(value.characters);
    }

    function onRooms(value) {
      setRooms(value);
    }

    function onPlayerChatMessage(value) {
      const chars = charactersRef.current || [];
      const sender = chars.find((c) => c.id === value.id);
      setChatMessages((prev) => {
        const next = [
          ...prev,
          {
            id: `${Date.now()}-${value.id}`,
            senderId: value.id,
            senderName: sender?.name || "Player",
            isBot: sender?.isBot || false,
            message: value.message,
            timestamp: Date.now(),
          },
        ];
        return next.slice(-20);
      });
    }

    function onMoltbookPosts(value) {
      setMoltbookPosts(value);
    }

    function onPlayerAction(value) {
      if (!value.action || value.action === "thinking") return;
      const chars = charactersRef.current || [];
      const sender = chars.find((c) => c.id === value.id);
      if (!sender) return;
      const type = value.action === "done" ? "item_placed" : value.action;
      addActivity(type, sender.name || "Player", sender.isBot, value.detail);
    }

    function onPlayerWaveAt(value) {
      const chars = charactersRef.current || [];
      const sender = chars.find((c) => c.id === value.id);
      const target = chars.find((c) => c.id === value.targetId);
      if (!sender || !target) return;
      addActivity("wave_at", sender.name || "Player", sender.isBot, `waved at ${target.name || "someone"}`);
    }

    function onCoinsUpdate(value) {
      if (value.coins !== undefined) setCoins(value.coins);
    }

    function onDirectMessage(value) {
      setDirectMessages((prev) => {
        const peerId = value.senderId;
        const existing = prev[peerId] || [];
        return {
          ...prev,
          [peerId]: [...existing.slice(-50), {
            id: `${Date.now()}-${Math.random()}`,
            senderId: value.senderId,
            senderName: value.senderName,
            senderIsBot: value.senderIsBot,
            message: value.message,
            timestamp: value.timestamp || Date.now(),
            incoming: true,
          }],
        };
      });
    }

    function onDirectMessageSent(value) {
      setDirectMessages((prev) => {
        const peerId = value.targetId;
        const existing = prev[peerId] || [];
        return {
          ...prev,
          [peerId]: [...existing.slice(-50), {
            id: `${Date.now()}-${Math.random()}`,
            senderId: "me",
            message: value.message,
            timestamp: value.timestamp || Date.now(),
            incoming: false,
          }],
        };
      });
    }

    function onQuestAccepted(value) {
      setActiveQuests((prev) => [...prev, { questId: value.questId, ...value.quest }]);
    }

    function onQuestCompleted(value) {
      setActiveQuests((prev) => prev.filter(q => q.id !== value.questId));
      setQuestNotifications((prev) => [...prev.slice(-5), {
        id: `${Date.now()}`,
        title: value.title,
        reward: value.reward,
        timestamp: Date.now(),
      }]);
      setCoins(value.coins);
      addActivity("quest_completed", "You", false, `completed "${value.title}" (+${value.reward} coins)`);
    }

    function onPurchaseComplete(value) {
      setCoins(value.coins);
      addActivity("purchase", "You", false, `bought ${value.item} for ${value.price} coins`);
    }

    function onBuildStarted(value) {
      const chars = charactersRef.current || [];
      const bot = chars.find(c => c.id === value.botId);
      addActivity("build_started", bot?.name || "Bot", true, "started building");
    }

    function onCharacterJoined(value) {
      // value = { character: { id, position, avatarUrl, name, isBot, ... }, roomName }
      const char = value.character;
      if (!char || !char.id) return;
      setCharacters((prev) => {
        // Don't add duplicates
        if (prev.some((c) => c.id === char.id)) return prev;
        addActivity("spawn", char.name || "Player", char.isBot);
        return [...prev, char];
      });
    }

    function onCharacterLeft(value) {
      // value = { id, name, isBot, roomName }
      if (!value || !value.id) return;
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === value.id);
        if (idx === -1) return prev; // not in our list
        addActivity("despawn", value.name || "Player", value.isBot);
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });
    }

    // Flush batched position updates to the characters atom so the
    // proximity sort in CharacterList picks up movement over time.
    function flushPositionUpdates() {
      const pending = pendingPositionsRef.current;
      if (pending.size === 0) return;
      const updates = new Map(pending);
      pending.clear();
      setCharacters((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          const pos = updates.get(c.id);
          if (pos && (c.position[0] !== pos[0] || c.position[1] !== pos[1])) {
            changed = true;
            return { ...c, position: pos };
          }
          return c;
        });
        return changed ? next : prev;
      });
    }

    function scheduleFlush() {
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushPositionUpdates();
        }, 2000); // flush every 2 seconds
      }
    }

    function onPlayerMove(value) {
      if (!value || !value.id) return;
      // Use path endpoint as the destination position for proximity sorting
      const dest = value.path && value.path.length > 0
        ? value.path[value.path.length - 1]
        : value.position;
      if (dest) {
        pendingPositionsRef.current.set(value.id, dest);
        scheduleFlush();
      }
    }

    function onPlayerMoves(values) {
      if (!Array.isArray(values)) return;
      values.forEach((v) => {
        if (!v || !v.id) return;
        const dest = v.path && v.path.length > 0
          ? v.path[v.path.length - 1]
          : v.position;
        if (dest) {
          pendingPositionsRef.current.set(v.id, dest);
        }
      });
      scheduleFlush();
    }

    function onCharacterUpdated(value) {
      // value = { id, ...updatedFields }
      if (!value || !value.id) return;
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === value.id);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], ...value };
        // Check if anything actually changed
        const old = prev[idx];
        if (old.avatarUrl === updated.avatarUrl && old.name === updated.name &&
            old.position[0] === updated.position[0] && old.position[1] === updated.position[1]) {
          return prev; // no change
        }
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    }

    function onAvatarPlayerMove(value) {
      if (!value || !value.id) return;
      avatarDispatch.playerMove.get(value.id)?.(value);
    }

    function onAvatarPlayerMoves(values) {
      if (!Array.isArray(values)) return;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v && v.id) avatarDispatch.playerMove.get(v.id)?.(v);
      }
    }

    function onAvatarPlayerDance(value) {
      if (value && value.id) avatarDispatch.playerDance.get(value.id)?.(value);
    }

    function onAvatarPlayerChatMessage(value) {
      if (value && value.id) avatarDispatch.playerChatMessage.get(value.id)?.(value);
    }

    function onAvatarPlayerAction(value) {
      if (value && value.id) avatarDispatch.playerAction.get(value.id)?.(value);
    }

    function onAvatarPlayerWaveAt(value) {
      if (value && value.id) avatarDispatch.playerWaveAt.get(value.id)?.(value);
    }

    function onAvatarPlayerSit(value) {
      if (value && value.id) avatarDispatch.playerSit.get(value.id)?.(value);
    }

    function onAvatarPlayerUnsit(value) {
      if (value && value.id) avatarDispatch.playerUnsit.get(value.id)?.(value);
    }

    function onMoltbookPostsDelta(value) {
      if (!value) return;
      setMoltbookPosts((prev) => {
        let next = prev;
        if (value.removed && value.removed.length > 0) {
          const removedSet = new Set(value.removed);
          next = next.filter((p) => !removedSet.has(p.id));
        }
        if (value.added && value.added.length > 0) {
          next = [...next, ...value.added];
        }
        return next;
      });
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomJoined", onRoomJoined);
    socket.on("rooms", onRooms);
    socket.on("welcome", onWelcome);
    socket.on("characters", onCharacters);
    socket.on("mapUpdate", onMapUpdate);
    socket.on("playerChatMessage", onPlayerChatMessage);
    socket.on("moltbookPosts", onMoltbookPosts);
    socket.on("playerAction", onPlayerAction);
    socket.on("playerWaveAt", onPlayerWaveAt);
    socket.on("coinsUpdate", onCoinsUpdate);
    socket.on("directMessage", onDirectMessage);
    socket.on("directMessageSent", onDirectMessageSent);
    socket.on("questAccepted", onQuestAccepted);
    socket.on("questCompleted", onQuestCompleted);
    socket.on("purchaseComplete", onPurchaseComplete);
    socket.on("buildStarted", onBuildStarted);
    socket.on("playerMove", onPlayerMove);
    socket.on("playerMoves", onPlayerMoves);
    socket.on("characterJoined", onCharacterJoined);
    socket.on("characterLeft", onCharacterLeft);
    socket.on("characterUpdated", onCharacterUpdated);
    socket.on("playerMove", onAvatarPlayerMove);
    socket.on("playerMoves", onAvatarPlayerMoves);
    socket.on("playerDance", onAvatarPlayerDance);
    socket.on("playerChatMessage", onAvatarPlayerChatMessage);
    socket.on("playerAction", onAvatarPlayerAction);
    socket.on("playerWaveAt", onAvatarPlayerWaveAt);
    socket.on("playerSit", onAvatarPlayerSit);
    socket.on("playerUnsit", onAvatarPlayerUnsit);
    socket.on("moltbookPostsDelta", onMoltbookPostsDelta);
    return () => {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("roomJoined", onRoomJoined);
      socket.off("rooms", onRooms);
      socket.off("welcome", onWelcome);
      socket.off("characters", onCharacters);
      socket.off("mapUpdate", onMapUpdate);
      socket.off("playerChatMessage", onPlayerChatMessage);
      socket.off("moltbookPosts", onMoltbookPosts);
      socket.off("playerAction", onPlayerAction);
      socket.off("playerWaveAt", onPlayerWaveAt);
      socket.off("coinsUpdate", onCoinsUpdate);
      socket.off("directMessage", onDirectMessage);
      socket.off("directMessageSent", onDirectMessageSent);
      socket.off("questAccepted", onQuestAccepted);
      socket.off("questCompleted", onQuestCompleted);
      socket.off("purchaseComplete", onPurchaseComplete);
      socket.off("buildStarted", onBuildStarted);
      socket.off("playerMove", onPlayerMove);
      socket.off("playerMoves", onPlayerMoves);
      socket.off("characterJoined", onCharacterJoined);
      socket.off("characterLeft", onCharacterLeft);
      socket.off("characterUpdated", onCharacterUpdated);
      socket.off("playerMove", onAvatarPlayerMove);
      socket.off("playerMoves", onAvatarPlayerMoves);
      socket.off("playerDance", onAvatarPlayerDance);
      socket.off("playerChatMessage", onAvatarPlayerChatMessage);
      socket.off("playerAction", onAvatarPlayerAction);
      socket.off("playerWaveAt", onAvatarPlayerWaveAt);
      socket.off("playerSit", onAvatarPlayerSit);
      socket.off("playerUnsit", onAvatarPlayerUnsit);
      socket.off("moltbookPostsDelta", onMoltbookPostsDelta);
    };
  }, []);
};
