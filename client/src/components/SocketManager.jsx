import { useGLTF } from "@react-three/drei";
import { atom, useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

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

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/65893b0514f9f5f28e61d783.glb",
  "https://models.readyplayer.me/62ea7bc28a6d28ec134bbcce.glb",
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

  const charactersRef = useRef([]);
  useEffect(() => { charactersRef.current = _characters; }, [_characters]);

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
      // Auto-join the first (only) room
      if (value.rooms && value.rooms.length > 0) {
        const avatarUrl =
          localStorage.getItem("avatarURL") ||
          randomAvatarUrl();
        socket.emit("joinRoom", value.rooms[0].id, { avatarUrl });
        setRoomID(value.rooms[0].id);
      }
    }

    function onRoomJoined(value) {
      setMap(value.map);
      setUser(value.id);
      setCharacters(value.characters);
    }

    function onCharacters(value) {
      setCharacters(value);
    }

    function onMapUpdate(value) {
      setMap(value.map);
      setCharacters(value.characters);
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

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("roomJoined", onRoomJoined);
    socket.on("rooms", onRooms);
    socket.on("welcome", onWelcome);
    socket.on("characters", onCharacters);
    socket.on("mapUpdate", onMapUpdate);
    socket.on("playerChatMessage", onPlayerChatMessage);
    socket.on("moltbookPosts", onMoltbookPosts);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("roomJoined", onRoomJoined);
      socket.off("rooms", onRooms);
      socket.off("welcome", onWelcome);
      socket.off("characters", onCharacters);
      socket.off("mapUpdate", onMapUpdate);
      socket.off("playerChatMessage", onPlayerChatMessage);
      socket.off("moltbookPosts", onMoltbookPosts);
    };
  }, []);
};
