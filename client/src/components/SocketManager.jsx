import { useGLTF } from "@react-three/drei";
import { atom, useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { activityEventsAtom } from "./ActivityFeed";
import soundManager from "../audio/SoundManager";

export const socket = io(
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000"
);
export const charactersAtom = atom([]);
export const mapAtom = atom(null);
export const userAtom = atom(null);
export const itemsAtom = atom(null);
export const roomIDAtom = atom(null);
export const roomsAtom = atom([]);
export const totalRoomsAtom = atom(0);
export const chatMessagesAtom = atom([]);
export const agentThoughtsAtom = atom([]);
export const usernameAtom = atom(localStorage.getItem("clawland_username") || null);
const ensureUserId = () => {
  let id = localStorage.getItem("clawland_user_id");
  if (!id) {
    const random = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    id = random;
    localStorage.setItem("clawland_user_id", id);
  }
  return id;
};

const getSessionToken = () => localStorage.getItem("clawland_session_token");
const setSessionToken = (token) => {
  if (token) localStorage.setItem("clawland_session_token", token);
};

export const userIdAtom = atom(ensureUserId());
export const sessionTokenAtom = atom(getSessionToken());
export const coinsAtom = atom(100);
export const directMessagesAtom = atom({}); // keyed by peerId -> message array
export const dmUnreadCountsAtom = atom({}); // keyed by peerId -> unread count
export const dmPeersAtom = atom({}); // keyed by peerId -> { name, isBot }
export const dmInboxOpenAtom = atom(false);
export const walletOpenAtom = atom(false);
export const questNotificationsAtom = atom([]);
export const roomHasPasswordAtom = atom(true);
export const bondsAtom = atom({}); // keyed by peerName -> { score, level, levelLabel, nextThreshold, maxLevel }
export const roomInvitesAtom = atom([]); // pending room invites
export const characterEmotionsAtom = atom({}); // keyed by character id -> emotion string
export const roomTransitionAtom = atom({ active: false, from: null, to: null, startedAt: 0 });
export const objectivesAtom = atom(null);

// Shared ref for the local player's live world position during movement.
// Written by Avatar.jsx every frame, read by Minimap.jsx for smooth tracking.
// Uses a plain object (not an atom) to avoid triggering React re-renders.
export const selfLivePosition = { current: null }; // [gridX, gridY] or null

// Shared ref for room transition start time — ensures minimum loading screen display.
// Written when transition starts, read when roomJoined arrives to calculate remaining delay.
export const transitionStartTime = { current: 0 };
export const MIN_TRANSITION_MS = 800; // Minimum time to show loading screen

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
  bondEmotePlay: new Map(), // id -> handler(value)
  playerThinking: new Map(), // id -> handler(value) — bot thinking indicator
};

// Atom: set of character IDs whose Html overlays should render (nearest 20)
export const htmlVisibleSetAtom = atom(new Set());

export const switchRoom = (roomId) => {
  socket.emit("switchRoom", roomId);
};

export const fetchRooms = (offset, limit, search) => {
  return new Promise((resolve) => {
    socket.emit("requestRooms", { offset, limit, search }, (response) => {
      resolve(response);
    });
  });
};

const LOCAL_FALLBACK_AVATAR_URL = "/models/sillyNubCat.glb";
const isRemoteAvatarUrl = (url) => /^https?:\/\//i.test(url || "");

// Keep the avatar URL in a shared atom so onboarding + UI stay in sync.
// Prefer a local fallback avatar for first-run localhost reliability.
const initialAvatarUrl = (() => {
  const stored = (localStorage.getItem("avatarURL") || "").trim();
  if (!stored) {
    localStorage.setItem("avatarURL", LOCAL_FALLBACK_AVATAR_URL);
    return LOCAL_FALLBACK_AVATAR_URL;
  }

  const hasExplicitAvatarChoice = localStorage.getItem("clawland_avatar_chosen") === "1";
  if (!hasExplicitAvatarChoice && isRemoteAvatarUrl(stored)) {
    localStorage.setItem("avatarURL", LOCAL_FALLBACK_AVATAR_URL);
    return LOCAL_FALLBACK_AVATAR_URL;
  }

  return stored;
})();
export const avatarUrlAtom = atom(initialAvatarUrl);

export const SocketManager = () => {
  const [_characters, setCharacters] = useAtom(charactersAtom);
  const [_chatMessages, setChatMessages] = useAtom(chatMessagesAtom);
  const [_map, setMap] = useAtom(mapAtom);
  const [_user, setUser] = useAtom(userAtom);
  const [items, setItems] = useAtom(itemsAtom);
  const [_rooms, setRooms] = useAtom(roomsAtom);
  const [_roomID, setRoomID] = useAtom(roomIDAtom);
  const [_agentThoughts, setAgentThoughts] = useAtom(agentThoughtsAtom);
  const [_activityEvents, setActivityEvents] = useAtom(activityEventsAtom);
  const [username] = useAtom(usernameAtom);
  const [userId, setUserId] = useAtom(userIdAtom);
  const [sessionToken, setSessionTokenState] = useAtom(sessionTokenAtom);
  const [avatarUrl] = useAtom(avatarUrlAtom);
  const [_coins, setCoins] = useAtom(coinsAtom);
  const [_directMessages, setDirectMessages] = useAtom(directMessagesAtom);
  const [_dmUnreadCounts, setDmUnreadCounts] = useAtom(dmUnreadCountsAtom);
  const [_dmPeers, setDmPeers] = useAtom(dmPeersAtom);
  const [_questNotifications, setQuestNotifications] = useAtom(questNotificationsAtom);
  const [_roomHasPassword, setRoomHasPassword] = useAtom(roomHasPasswordAtom);
  const [_bonds, setBonds] = useAtom(bondsAtom);
  const [_roomInvites, setRoomInvites] = useAtom(roomInvitesAtom);
  const [_totalRooms, setTotalRooms] = useAtom(totalRoomsAtom);
  const [_characterEmotions, setCharacterEmotions] = useAtom(characterEmotionsAtom);
  const [_roomTransition, setRoomTransition] = useAtom(roomTransitionAtom);
  const [_objectives, setObjectives] = useAtom(objectivesAtom);

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
    if (username && avatarUrl && pendingWelcomeRef.current) {
      const roomId = pendingWelcomeRef.current;
      pendingWelcomeRef.current = null;
      transitionStartTime.current = Date.now();
      setRoomTransition({ active: true, from: null, to: roomId, startedAt: transitionStartTime.current });
      socket.emit("joinRoom", roomId, { avatarUrl, name: username, userId, sessionToken });
      setRoomID(roomId);
    }
  }, [username, avatarUrl, userId, sessionToken]);

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
      setRoomTransition({ active: false, from: null, to: null, startedAt: 0 });
    }

    function onWelcome(value) {
      setRooms(value.rooms);
      if (value.totalRooms !== undefined) setTotalRooms(value.totalRooms);
      setItems(value.items);
      if (value.agentThoughts) setAgentThoughts(value.agentThoughts);
      // Join once username is available (may be immediate if stored)
      if (value.rooms && value.rooms.length > 0) {
        const storedName = localStorage.getItem("clawland_username");
        if (storedName) {
          const avatarUrl = localStorage.getItem("avatarURL") || initialAvatarUrl;
          transitionStartTime.current = Date.now();
          setRoomTransition({ active: true, from: null, to: value.rooms[0].id, startedAt: transitionStartTime.current });
          socket.emit("joinRoom", value.rooms[0].id, {
            avatarUrl,
            name: storedName,
            userId: ensureUserId(),
            sessionToken: getSessionToken(),
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
      if (value.userId && value.userId !== userId) {
        localStorage.setItem("clawland_user_id", value.userId);
        setUserId(value.userId);
      }
      // Save new session token if provided
      if (value.sessionToken) {
        setSessionToken(value.sessionToken);
        setSessionTokenState(value.sessionToken);
      }
      setCharacters(value.characters);
      setChatMessages([]);
      if (value.coins !== undefined) setCoins(value.coins);
      setRoomHasPassword(value.hasPassword !== false);
      // Delay clearing the transition overlay to ensure minimum display time
      // This gives the 3D scene time to render before the overlay fades out
      const elapsed = Date.now() - transitionStartTime.current;
      const remaining = Math.max(0, MIN_TRANSITION_MS - elapsed);
      setTimeout(() => {
        setRoomTransition({ active: false, from: null, to: null, startedAt: 0 });
      }, remaining);
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

    function onRoomsUpdate(activeRooms) {
      // Merge active room data into the rooms list — update character counts
      setRooms((prev) => {
        const activeMap = new Map(activeRooms.map(r => [r.id, r]));
        // Update existing entries, or add new active rooms
        const updatedIds = new Set();
        const next = prev.map(r => {
          if (activeMap.has(r.id)) {
            updatedIds.add(r.id);
            return { ...r, ...activeMap.get(r.id) };
          }
          // Room is no longer active — set nbCharacters to 0
          return r.nbCharacters > 0 ? { ...r, nbCharacters: 0 } : r;
        });
        // Add any new active rooms not in our list
        for (const [id, r] of activeMap) {
          if (!updatedIds.has(id) && !next.some(e => e.id === id)) {
            next.push(r);
          }
        }
        return next;
      });
    }

    function onPlayerChatMessage(value) {
      soundManager.play("chat_receive");
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

    function onCoinsTransferSuccess(value) {
      if (!value) return;
      addActivity("coins_sent", "You", false, `sent ${value.amount} coins to ${value.toName || value.toUserId}`);
    }

    function onCoinsTransferReceived(value) {
      if (!value) return;
      soundManager.play("notification");
      addActivity("coins_received", value.fromName || "Player", !!value.fromIsBot, `sent you ${value.amount} coins`);
    }

    function onDirectMessage(value) {
      soundManager.play("dm_receive");
      setDmUnreadCounts((prev) => ({
        ...prev,
        [value.senderId]: (prev[value.senderId] || 0) + 1,
      }));
      setDmPeers((prev) => ({
        ...prev,
        [value.senderId]: {
          name: value.senderName || "Player",
          isBot: !!value.senderIsBot,
          userId: value.senderUserId || prev[value.senderId]?.userId || null,
        },
      }));
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
      if (value?.targetUserId) {
        setDmPeers((prev) => ({
          ...prev,
          [value.targetId]: {
            name: prev[value.targetId]?.name || "Player",
            isBot: prev[value.targetId]?.isBot ?? false,
            userId: value.targetUserId,
          },
        }));
      }
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

    function onPurchaseComplete(value) {
      soundManager.play("purchase_complete");
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
        soundManager.play("player_join");
        return [...prev, char];
      });
    }

    function onCharacterLeft(value) {
      // value = { id, name, isBot, roomName }
      if (!value || !value.id) return;
      setCharacterEmotions((prev) => {
        if (!(value.id in prev)) return prev;
        const { [value.id]: _, ...rest } = prev;
        return rest;
      });
      // Mark the character as leaving so the Avatar can fade out,
      // then actually remove it after the animation completes.
      setCharacters((prev) => {
        const idx = prev.findIndex((c) => c.id === value.id);
        if (idx === -1) return prev; // not in our list
        addActivity("despawn", value.name || "Player", value.isBot);
        soundManager.play("player_leave");
        const next = [...prev];
        next[idx] = { ...next[idx], leaving: true };
        return next;
      });
      // Remove the character after the fade-out animation duration
      setTimeout(() => {
        setCharacters((prev) => prev.filter((c) => c.id !== value.id));
      }, 800);
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
      if (value && value.id) {
        soundManager.play("dance_start");
        avatarDispatch.playerDance.get(value.id)?.(value);
      }
    }

    function onAvatarPlayerChatMessage(value) {
      if (value && value.id) avatarDispatch.playerChatMessage.get(value.id)?.(value);
    }

    function onAvatarPlayerAction(value) {
      if (value && value.id) avatarDispatch.playerAction.get(value.id)?.(value);
    }

    function onAvatarPlayerWaveAt(value) {
      if (value && value.id) {
        soundManager.play("wave_emote");
        avatarDispatch.playerWaveAt.get(value.id)?.(value);
      }
    }

    function onAvatarPlayerSit(value) {
      if (value && value.id) {
        soundManager.play("sit_down");
        avatarDispatch.playerSit.get(value.id)?.(value);
      }
    }

    function onAvatarPlayerUnsit(value) {
      if (value && value.id) avatarDispatch.playerUnsit.get(value.id)?.(value);
    }

    function onAvatarPlayerThinking(value) {
      if (value && value.id) avatarDispatch.playerThinking.get(value.id)?.(value);
    }

    function onAgentThought(value) {
      if (!value) return;
      setAgentThoughts((prev) => {
        // Add new thought at the beginning, keep max 50
        const next = [value, ...prev];
        return next.slice(0, 50);
      });
    }

    function onAgentThoughts(value) {
      if (!value) return;
      setAgentThoughts(value);
    }

    function onBondUpdate(value) {
      if (!value || !value.peerName) return;
      setBonds((prev) => ({
        ...prev,
        [value.peerName]: {
          score: value.score,
          level: value.level,
          levelLabel: value.levelLabel,
          nextThreshold: value.nextThreshold,
          maxLevel: value.maxLevel,
        },
      }));
    }

    function onBondInfo(value) {
      if (!value || !value.peerName) return;
      setBonds((prev) => ({
        ...prev,
        [value.peerName]: {
          score: value.score,
          level: value.level,
          levelLabel: value.levelLabel,
          nextThreshold: value.nextThreshold,
          maxLevel: value.maxLevel,
        },
      }));
    }

    function onBondFormed(value) {
      if (!value) return;
      addActivity("bond_formed", value.nameA, false, `bonded with ${value.nameB}`);
    }

    function onBondEmotePlay(value) {
      if (value && value.id) avatarDispatch.bondEmotePlay.get(value.id)?.(value);
    }

    function onRoomInvite(value) {
      if (!value || !value.inviteId) return;
      soundManager.play("notification");
      setRoomInvites((prev) => {
        // Deduplicate by fromId+roomId
        if (prev.some((inv) => inv.fromId === value.fromId && inv.roomId === value.roomId)) return prev;
        const next = [...prev, value];
        return next.slice(-5); // cap at 5
      });
    }

    function onObjectivesInit(value) {
      setObjectives(value);
    }

    function onObjectivesProgress(value) {
      setObjectives(value);
    }

    function onObjectivesComplete(value) {
      if (!value) return;
      soundManager.play("quest_complete");
      setQuestNotifications((prev) => [...prev.slice(-5), {
        id: `obj-${Date.now()}`,
        type: value.type || "room",
        title: value.label,
        reward: value.reward,
        timestamp: Date.now(),
      }]);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomJoined", onRoomJoined);
    socket.on("rooms", onRooms);
    socket.on("roomsUpdate", onRoomsUpdate);
    socket.on("welcome", onWelcome);
    socket.on("characters", onCharacters);
    socket.on("mapUpdate", onMapUpdate);
    socket.on("playerChatMessage", onPlayerChatMessage);
    socket.on("playerAction", onPlayerAction);
    socket.on("playerWaveAt", onPlayerWaveAt);
    socket.on("coinsUpdate", onCoinsUpdate);
    socket.on("coinsTransferSuccess", onCoinsTransferSuccess);
    socket.on("coinsTransferReceived", onCoinsTransferReceived);
    socket.on("directMessage", onDirectMessage);
    socket.on("directMessageSent", onDirectMessageSent);
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
    socket.on("playerThinking", onAvatarPlayerThinking);
    socket.on("agentThought", onAgentThought);
    socket.on("agentThoughts", onAgentThoughts);
    socket.on("bondUpdate", onBondUpdate);
    socket.on("bondInfo", onBondInfo);
    socket.on("bondFormed", onBondFormed);
    socket.on("bondEmote:play", onBondEmotePlay);
    socket.on("roomInvite", onRoomInvite);
    socket.on("objectives:init", onObjectivesInit);
    socket.on("objectives:progress", onObjectivesProgress);
    socket.on("objectives:complete", onObjectivesComplete);
    return () => {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("roomJoined", onRoomJoined);
      socket.off("rooms", onRooms);
      socket.off("roomsUpdate", onRoomsUpdate);
      socket.off("welcome", onWelcome);
      socket.off("characters", onCharacters);
      socket.off("mapUpdate", onMapUpdate);
      socket.off("playerChatMessage", onPlayerChatMessage);
      socket.off("playerAction", onPlayerAction);
      socket.off("playerWaveAt", onPlayerWaveAt);
      socket.off("coinsUpdate", onCoinsUpdate);
      socket.off("coinsTransferSuccess", onCoinsTransferSuccess);
      socket.off("coinsTransferReceived", onCoinsTransferReceived);
      socket.off("directMessage", onDirectMessage);
      socket.off("directMessageSent", onDirectMessageSent);
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
      socket.off("playerThinking", onAvatarPlayerThinking);
      socket.off("agentThought", onAgentThought);
      socket.off("agentThoughts", onAgentThoughts);
      socket.off("bondUpdate", onBondUpdate);
      socket.off("bondInfo", onBondInfo);
      socket.off("bondFormed", onBondFormed);
      socket.off("bondEmote:play", onBondEmotePlay);
      socket.off("roomInvite", onRoomInvite);
      socket.off("objectives:init", onObjectivesInit);
      socket.off("objectives:progress", onObjectivesProgress);
      socket.off("objectives:complete", onObjectivesComplete);
    };
  }, []);
};
