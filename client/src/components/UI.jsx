import { atom, useAtom } from "jotai";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as THREE from "three";

import { AvatarCreator } from "@readyplayerme/react-avatar-creator";
import { motion, AnimatePresence } from "framer-motion";
import { GLTFLoader } from "three-stdlib";
import { roomItemsAtom } from "./Room";
import {
  roomIDAtom,
  roomsAtom,
  totalRoomsAtom,
  socket,
  switchRoom,
  fetchRooms,
  coinsAtom,
  activeQuestsAtom,
  questNotificationsAtom,
  charactersAtom,
  itemsAtom,
  roomInvitesAtom,
  userAtom,
  characterMotivesAtom,
  roomTransitionAtom,
  avatarUrlAtom,
  mapAtom,
  pendingInteractionAtom,
  dmUnreadCountsAtom,
  dmInboxOpenAtom,
} from "./SocketManager";
import DirectMessagePanel, { dmPanelTargetAtom } from "./DirectMessagePanel";
import { renderAvatarPortrait } from "./Avatar";
import soundManager from "../audio/SoundManager";

// Offscreen thumbnail renderer — renders each GLB to a data URL image
const thumbnailCache = {};

const renderThumbnails = (itemNames, onThumbnail, signal) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(128, 128);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 100);
  camera.position.set(1, 0.8, 1);
  camera.lookAt(0, 0, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 3, 2);
  scene.add(dir);

  const loader = new GLTFLoader();

  let i = 0;
  const next = () => {
    if (signal.aborted || i >= itemNames.length) {
      renderer.dispose();
      return;
    }
    const name = itemNames[i++];
    if (thumbnailCache[name]) {
      onThumbnail(name, thumbnailCache[name]);
      next();
      return;
    }
    loader.load(
      `/models/items/${name}.glb`,
      (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const s = maxDim > 0 ? 0.55 / maxDim : 1;
        model.scale.setScalar(s);
        model.position.set(-center.x * s, -center.y * s, -center.z * s);
        scene.add(model);
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL();
        scene.remove(model);
        // Dispose model geometry/materials to free memory
        model.traverse((child) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material?.dispose();
          }
        });
        thumbnailCache[name] = dataUrl;
        onThumbnail(name, dataUrl);
        // Yield to main thread between renders
        setTimeout(next, 0);
      },
      undefined,
      () => {
        // Skip failed loads
        setTimeout(next, 0);
      }
    );
  };
  next();
};

const ShopPanel = ({ itemsCatalog, onClose, onSelect }) => {
  const [thumbnails, setThumbnails] = useState(() => ({ ...thumbnailCache }));
  const items = useMemo(() => Object.values(itemsCatalog), [itemsCatalog]);

  useEffect(() => {
    const controller = new AbortController();
    const names = items.map((it) => it.name).filter((n) => !thumbnailCache[n]);
    if (names.length === 0) return;
    renderThumbnails(
      names,
      (name, url) => {
        setThumbnails((prev) => ({ ...prev, [name]: url }));
      },
      controller.signal
    );
    return () => controller.abort();
  }, [items]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200 w-[90vw] max-w-lg max-h-[70vh] flex flex-col"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">Shop</h2>
          <button
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            onClick={onClose}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-gray-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {items.map((item) => (
            <button
              key={item.name}
              className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-green-50 border border-gray-100 hover:border-green-300 transition-colors cursor-pointer"
              onClick={() => onSelect(item)}
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
                {thumbnails[item.name] ? (
                  <img
                    src={thumbnails[item.name]}
                    alt={item.name}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                )}
              </div>
              <span className="text-[10px] sm:text-xs text-gray-600 text-center leading-tight truncate w-full">
                {item.name.replace(/([A-Z])/g, " $1").trim()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
  "/models/sillyNubCat.glb",
];

// Helper to get a 2D render thumbnail from a Ready Player Me avatar URL
const getAvatarThumbnail = (glbUrl) => {
  if (!glbUrl) return "";
  return glbUrl.split("?")[0].replace(".glb", ".png") + "?size=256";
};

const CharacterSelectorModal = ({ onClose, currentAvatarUrl, onSelectAvatar, onCustomAvatar }) => {
  const [localThumbs, setLocalThumbs] = useState({});

  useEffect(() => {
    AVATAR_URLS.filter((url) => url.startsWith("/")).forEach((url) => {
      renderAvatarPortrait(url, (dataUrl) => {
        if (dataUrl) setLocalThumbs((prev) => ({ ...prev, [url]: dataUrl }));
      });
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 overflow-hidden"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Choose Character</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-3 gap-3">
            {AVATAR_URLS.map((url, idx) => {
              const isActive = currentAvatarUrl?.split("?")[0] === url.split("?")[0];
              const isLocalModel = url.startsWith("/");
              const thumbUrl = isLocalModel ? null : getAvatarThumbnail(url);
              const label = isLocalModel ? "Nub Cat" : `Character ${idx + 1}`;
              return (
                <button
                  key={idx}
                  onClick={() => { onSelectAvatar(url); onClose(); }}
                  className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all hover:scale-105 ${
                    isActive
                      ? "border-slate-800 ring-2 ring-slate-300"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                    {isLocalModel ? (
                      localThumbs[url] ? (
                        <img
                          src={localThumbs[url]}
                          alt={label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1">
                          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                          <span className="text-[10px] font-semibold text-gray-500">{label}</span>
                        </div>
                      )
                    ) : (
                      <img
                        src={thumbUrl}
                        alt={label}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                      />
                    )}
                  </div>
                  {isActive && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-slate-800 rounded-full flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3 text-white">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-gray-100 mt-4 pt-4">
            <button
              onClick={() => { onCustomAvatar(); onClose(); }}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
              </svg>
              Create Custom Avatar
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-3">Select a character or create a custom one</p>
        </div>
      </motion.div>
    </div>
  );
};
export const buildModeAtom = atom(false);
export const shopModeAtom = atom(false);
export const draggedItemAtom = atom(null);
export const draggedItemRotationAtom = atom(0);
export const showRoomSelectorAtom = atom(false);
export const selectedShopItemAtom = atom(null);

const PasswordInput = ({ onClose, onSuccess }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // TODO: To make things properly we should have a loading state 😊

  const checkPassword = () => {
    socket.emit("passwordCheck", password);
  };

  useEffect(() => {
    socket.on("passwordCheckSuccess", () => {
      onSuccess();
      onClose();
    });
    socket.on("passwordCheckFail", () => {
      setError("Wrong password");
    });
    return () => {
      socket.off("passwordCheckSuccess");
      socket.off("passwordCheckFail");
    };
  });

  return (
    <div className="fixed z-10 grid place-items-center w-full h-full top-0 left-0">
      <div
        className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="bg-white rounded-lg shadow-lg p-4 z-10">
        <p className="text-lg font-bold">Password</p>
        <input
          autoFocus
          type="text"
          className="border rounded-lg p-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="space-y-2 mt-2">
          <button
            className="bg-green-500 text-white rounded-lg px-4 py-2 flex-1 w-full"
            onClick={checkPassword}
          >
            Enter
          </button>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </div>
    </div>
  );
};

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  "https://openclawworld-production.up.railway.app";

const BotConnectModal = ({ onClose }) => {
  const [copied, setCopied] = useState(null);
  const [activeTab, setActiveTab] = useState("molthub");

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const npxCommand = "npx moltland@latest install-moltland";
  const manualText = "Read https://molts.land/skill.md and follow the instructions to join Molt's Land";

  return (
    <div className="fixed z-10 grid place-items-center w-full h-full top-0 left-0">
      <div
        className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="z-10 max-w-md w-full mx-4 rounded-2xl shadow-2xl overflow-hidden bg-white">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🦀</span>
              <h2 className="text-lg font-bold text-gray-900">Send Your AI Agent to Molt's Land</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { soundManager.play("tab_switch"); setActiveTab("molthub"); }}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                activeTab === "molthub"
                  ? "bg-slate-800 text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              }`}
            >
              molthub
            </button>
            <button
              onClick={() => { soundManager.play("tab_switch"); setActiveTab("manual"); }}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                activeTab === "manual"
                  ? "bg-slate-800 text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              }`}
            >
              manual
            </button>
          </div>

          {/* Tab content */}
          <div className="mb-5">
            <p className="text-gray-500 text-xs mb-2 uppercase tracking-wide font-semibold">
              {activeTab === "molthub" ? "Copy this command to your agent" : "Send this to your agent"}
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 relative group">
              <pre className="text-gray-800 text-sm font-mono whitespace-pre-wrap break-all pr-16">
                {activeTab === "molthub" ? npxCommand : manualText}
              </pre>
              <button
                onClick={() => copyText(activeTab === "molthub" ? npxCommand : manualText, "cmd")}
                className="absolute top-2 right-2 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded px-2.5 py-1 text-xs transition-colors"
              >
                {copied === "cmd" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3 mb-5">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center mt-0.5">1</span>
              <p className="text-gray-700 text-sm">Send this to your agent</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center mt-0.5">2</span>
              <p className="text-gray-700 text-sm">They sign up & send you a claim link</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center mt-0.5">3</span>
              <p className="text-gray-700 text-sm">Tweet to verify ownership</p>
            </div>
          </div>

          {/* Footer link */}
          <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
            <p className="text-xs text-gray-400 font-mono">molts.land/skill.md</p>
            <button
              onClick={() => copyText("https://molts.land/skill.md", "docs")}
              className="bg-slate-800 hover:bg-slate-900 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-semibold"
            >
              {copied === "docs" ? "Copied!" : "Copy Docs URL"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const HelpModal = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState("basics");

  const sections = [
    { id: "basics", label: "Basics", icon: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" },
    { id: "social", label: "Social", icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
    { id: "building", label: "Building", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
    { id: "bots", label: "Bots", icon: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0015.75 4.5h-9A2.25 2.25 0 004.5 6.75v10.5A2.25 2.25 0 006.75 19.5z" },
    { id: "camera", label: "Camera", icon: "M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" },
  ];

  const content = {
    basics: [
      { key: "Move", desc: "Click anywhere on the ground to walk there" },
      { key: "Chat", desc: "Type a message and press Enter or click Send" },
      { key: "Dance", desc: "Click the music note button to dance" },
      { key: "Switch Rooms", desc: "Click the building icon to browse and join rooms" },
      { key: "Change Avatar", desc: "Click the person icon to pick a character or create a custom one" },
      { key: "Coins", desc: "Earn coins by completing quests — your balance shows at the top" },
    ],
    social: [
      { key: "Click a Player", desc: "Opens their profile card with actions" },
      { key: "Wave", desc: "Send a wave emote from the character menu" },
      { key: "Follow", desc: "Follow a player and your camera tracks them" },
      { key: "Talk", desc: "Open a direct message chat with a bot or player" },
      { key: "Quests", desc: "Accept quests from bots via the Quests tab in DMs" },
      { key: "Shop", desc: "Buy items from bot shops via the Shop tab in DMs" },
    ],
    building: [
      { key: "Enter Build Mode", desc: "Click the house button — requires the room password" },
      { key: "Open Shop", desc: "In build mode, click the shop icon to browse items" },
      { key: "Place Item", desc: "Drag an item from the shop onto the grid" },
      { key: "Rotate", desc: "Click the rotate button while placing an item" },
      { key: "Cancel", desc: "Click X to cancel placing the current item" },
      { key: "Remove Item", desc: "Select a placed item and click the trash icon" },
    ],
    bots: [
      { key: "AI Agents", desc: "Bots are AI-powered characters that can chat, give quests, and sell items" },
      { key: "Connect a Bot", desc: "Click the bot icon (purple) and follow the instructions" },
      { key: "Moltland", desc: "Run the npx command to install and connect your agent" },
      { key: "Manual Setup", desc: "Use the manual tab for custom bot integration via molts.land" },
      { key: "Bot Badges", desc: "Bots display a blue 'Bot' badge on their profile card" },
    ],
    camera: [
      { key: "Zoom", desc: "Scroll the mouse wheel to zoom in and out" },
      { key: "Rotate View", desc: "Right-click and drag to rotate the camera" },
      { key: "Q / E Keys", desc: "Press Q or E to rotate the camera left or right" },
      { key: "Follow Mode", desc: "When following a player, the camera tracks them automatically" },
    ],
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-lg mx-4 overflow-hidden max-h-[85vh] flex flex-col"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Help</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Section tabs */}
        <div className="px-5 pt-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => { soundManager.play("tab_switch"); setActiveSection(s.id); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                activeSection === s.id
                  ? "bg-slate-800 text-white"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 pb-5 pt-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="space-y-2"
            >
              {content[activeSection].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{item.key}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <p className="text-xs text-gray-400 text-center">Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-[10px]">?</kbd> anytime to open this menu</p>
        </div>
      </motion.div>
    </div>
  );
};

const RoomTransitionOverlay = ({ transition, roomLabel }) => {
  return (
    <AnimatePresence mode="wait">
      {transition?.active && (
        <motion.div
          key="room-transition-overlay"
          className="fixed inset-0 z-[200] grid place-items-center"
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <motion.div
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.92 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          />

          <motion.div
            className="relative w-[92vw] max-w-sm rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-2xl px-5 py-4"
            initial={{ y: 10, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.985, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-xl bg-white/10 border border-white/10 grid place-items-center overflow-hidden">
                <motion.img
                  src="/favicon.ico"
                  alt=""
                  className="w-6 h-6"
                  initial={{ opacity: 0, scale: 0.85, rotate: -8 }}
                  animate={{
                    opacity: 1,
                    scale: [1, 1.05, 1],
                    y: [0, -1.5, 0],
                    rotate: [0, 3, 0],
                  }}
                  exit={{ opacity: 0, scale: 0.9, rotate: 6 }}
                  transition={{
                    opacity: { duration: 0.2, ease: "easeOut" },
                    scale: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
                    y: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
                    rotate: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
                  }}
                  style={{ willChange: "transform, opacity" }}
                />
              </div>
              <div className="min-w-0">
                <p className="text-white font-extrabold tracking-tight">Teleporting...</p>
                <p className="text-xs text-white/70 mt-0.5 truncate">
                  {roomLabel ? `Heading to ${roomLabel}` : "Loading room"}
                </p>
              </div>
            </div>

            <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-white"
                initial={{ x: "-40%" }}
                animate={{ x: "110%" }}
                transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: "40%" }}
              />
            </div>
            <p className="text-[11px] text-white/55 mt-2">Tip: Press ? anytime for controls.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const InviteModal = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [onlineRooms, setOnlineRooms] = useState([]); // [{ roomId, roomName, users }]
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [sentMap, setSentMap] = useState({}); // id -> "sent" | "error:msg"
  const debounceRef = useRef(null);

  // Fetch all online users on mount
  useEffect(() => {
    socket.emit("getOnlineUsers", (res) => {
      setLoading(false);
      if (res?.success) setOnlineRooms(res.rooms || []);
    });
  }, []);

  // Filter online users client-side, or fall back to server search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim().toLowerCase();
    if (q.length === 0) { setSearchResults([]); setSearching(false); return; }
    // Client-side filter first
    const filtered = onlineRooms.map((room) => ({
      ...room,
      users: room.users.filter((u) => u.name.toLowerCase().includes(q)),
    })).filter((room) => room.users.length > 0);
    const totalFiltered = filtered.reduce((sum, r) => sum + r.users.length, 0);
    if (totalFiltered > 0) {
      setSearchResults(filtered);
      setSearching(false);
      return;
    }
    // Fall back to server search
    setSearching(true);
    setSearchResults([]);
    debounceRef.current = setTimeout(() => {
      socket.emit("searchUsers", q, (res) => {
        setSearching(false);
        if (res?.success && res.results.length > 0) {
          // Group server results by room
          const byRoom = {};
          for (const u of res.results) {
            if (!byRoom[u.roomId]) byRoom[u.roomId] = { roomId: u.roomId, roomName: u.roomName, users: [] };
            byRoom[u.roomId].users.push({ id: u.id, name: u.name, isBot: u.isBot });
          }
          setSearchResults(Object.values(byRoom));
        }
      });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, onlineRooms]);

  const sendInvite = (targetId) => {
    soundManager.play("button_click");
    socket.emit("inviteToRoom", targetId, (res) => {
      if (res?.success) {
        setSentMap((prev) => ({ ...prev, [targetId]: "sent" }));
      } else {
        setSentMap((prev) => ({ ...prev, [targetId]: `error:${res?.error || "Failed"}` }));
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 overflow-hidden max-h-[85vh] flex flex-col"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-blue-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Invite to Room</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="px-5 pt-4 pb-2 flex-shrink-0">
          <input
            autoFocus
            type="text"
            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            placeholder="Search by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 px-5 pb-5 pt-2">
          {(loading || searching) && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          )}
          {!loading && !searching && (() => {
            const displayRooms = query.trim().length > 0 ? searchResults : onlineRooms;
            if (displayRooms.length === 0) {
              return (
                <p className="text-sm text-gray-400 text-center py-8">
                  {query.trim().length > 0 ? "No users found" : "No other users online"}
                </p>
              );
            }
            return displayRooms.map((room) => (
              <div key={room.roomId} className="mb-3">
                <div className="flex items-center gap-2 px-1 py-1.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{room.roomName}</p>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{room.users.length}</span>
                </div>
                {room.users.map((user) => {
                  const status = sentMap[user.id];
                  return (
                    <div key={user.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors mb-1">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-gray-500">{(user.name || "?")[0].toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-gray-900 text-sm truncate">{user.name}</p>
                            {user.isBot && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-semibold flex-shrink-0">Bot</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {status === "sent" ? (
                          <span className="text-xs font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg">Sent!</span>
                        ) : status?.startsWith("error:") ? (
                          <span className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">{status.slice(6)}</span>
                        ) : (
                          <button
                            onClick={() => sendInvite(user.id)}
                            className="text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            Invite
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>
      </motion.div>
    </div>
  );
};

const InviteNotification = ({ invite, onAccept, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(), 30000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-4 w-72 pointer-events-auto"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-blue-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="font-semibold text-gray-900 text-sm truncate">{invite.fromName}</p>
            {invite.fromIsBot && (
              <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-semibold flex-shrink-0">Bot</span>
            )}
          </div>
          <p className="text-xs text-gray-500">invited you to <span className="font-medium text-gray-700">{invite.roomName}</span></p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={onAccept}
              className="text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Accept
            </button>
            <button
              onClick={onDismiss}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const CreateRoomModal = ({ onClose }) => {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [sizePreset, setSizePreset] = useState("medium");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const SIZE_PRESETS = {
    small: { sizeX: 10, sizeY: 10, label: "Small", desc: "10x10" },
    medium: { sizeX: 15, sizeY: 15, label: "Medium", desc: "15x15" },
    large: { sizeX: 20, sizeY: 20, label: "Large", desc: "20x20" },
  };

  const handleCreate = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Room name is required"); return; }
    setCreating(true);
    setError("");
    const preset = SIZE_PRESETS[sizePreset];
    socket.emit("createRoom", {
      name: trimmedName,
      password: password.trim() || undefined,
      sizeX: preset.sizeX,
      sizeY: preset.sizeY,
    }, (res) => {
      setCreating(false);
      if (res?.success) {
        onClose();
      } else {
        setError(res?.error || "Failed to create room");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-sm mx-4 overflow-hidden"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-emerald-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Create Room</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Room name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Room Name</label>
            <input
              autoFocus
              type="text"
              maxLength={50}
              className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              placeholder="My Awesome Room"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
            />
          </div>

          {/* Password (optional) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              placeholder="Leave empty for public room"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* Size presets */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Room Size</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SIZE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => setSizePreset(key)}
                  className={`p-2.5 rounded-xl border-2 text-center transition-colors ${
                    sizePreset === key
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <p className="text-sm font-semibold">{preset.label}</p>
                  <p className="text-xs text-gray-400">{preset.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? "Creating..." : "Create Room"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const ROOMS_PER_PAGE = 30;

const RoomSelectorModal = ({ onClose, currentRoomID, onSwitchRoom }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [displayedRooms, setDisplayedRooms] = useState([]);
  const [totalRooms, setTotalRooms] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const debounceRef = useRef(null);

  const loadRooms = async (pageNum, search) => {
    setLoading(true);
    try {
      const res = await fetchRooms(pageNum * ROOMS_PER_PAGE, ROOMS_PER_PAGE, search);
      if (res?.success) {
        setDisplayedRooms(res.rooms);
        setTotalRooms(res.total);
      }
    } catch (err) {
      console.error("Failed to fetch rooms:", err);
    }
    setLoading(false);
  };

  // Initial load
  useEffect(() => {
    loadRooms(0, "");
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      loadRooms(0, searchQuery.trim());
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadRooms(newPage, searchQuery.trim());
  };

  const totalPages = Math.max(1, Math.ceil(totalRooms / ROOMS_PER_PAGE));

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="bg-white rounded-2xl shadow-2xl z-10 max-w-md w-full mx-4 max-h-[70vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-amber-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Rooms</h2>
              <p className="text-xs text-gray-400">{totalRooms} rooms total</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateRoom(true)}
              className="w-8 h-8 bg-emerald-100 hover:bg-emerald-200 rounded-lg flex items-center justify-center transition-colors"
              title="Create Room"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Create Room Modal */}
        <AnimatePresence>
          {showCreateRoom && <CreateRoomModal onClose={() => { setShowCreateRoom(false); loadRooms(page, searchQuery.trim()); }} />}
        </AnimatePresence>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <input
            type="text"
            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="overflow-y-auto flex-1 p-3">
          {loading && displayedRooms.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
            </div>
          )}

          {/* Plaza / main rooms at the top */}
          {displayedRooms.filter(r => !r.generated && !r.id.startsWith("room-")).map((room) => (
            <button
              key={room.id}
              onClick={() => { onSwitchRoom(room.id); onClose(); }}
              className={`w-full text-left p-3 rounded-xl mb-1 flex items-center justify-between transition-colors ${
                currentRoomID === room.id
                  ? "bg-amber-100 border-2 border-amber-400"
                  : "hover:bg-gray-50 border-2 border-transparent"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-green-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{room.name}</p>
                  <p className="text-xs text-gray-500">Main plaza</p>
                </div>
              </div>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {room.nbCharacters || 0} online
              </span>
            </button>
          ))}

          {displayedRooms.some(r => !r.generated && !r.id.startsWith("room-")) &&
            displayedRooms.some(r => r.generated || r.id.startsWith("room-")) && (
            <div className="border-t border-gray-100 my-2"></div>
          )}

          {/* Generated rooms */}
          {displayedRooms.filter(r => r.generated || r.id.startsWith("room-")).map((room) => (
            <button
              key={room.id}
              onClick={() => { onSwitchRoom(room.id); onClose(); }}
              className={`w-full text-left p-2.5 rounded-xl mb-0.5 flex items-center justify-between transition-colors ${
                currentRoomID === room.id
                  ? "bg-amber-100 border-2 border-amber-400"
                  : "hover:bg-gray-50 border-2 border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">
                  <span className="text-xs font-semibold text-gray-500">{room.id.replace(/\D/g, "").slice(0, 4)}</span>
                </div>
                <p className="font-medium text-gray-800 text-sm">{room.name}</p>
              </div>
              {(room.nbCharacters || 0) > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {room.nbCharacters}
                </span>
              )}
            </button>
          ))}

          {!loading && displayedRooms.length === 0 && searchQuery.trim().length > 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No rooms found</p>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => handlePageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-100 hover:bg-gray-200 text-gray-600"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-100 hover:bg-gray-200 text-gray-600"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const UI = () => {
  const [buildMode, setBuildMode] = useAtom(buildModeAtom);
  const [shopMode, setShopMode] = useAtom(shopModeAtom);
  const [draggedItem, setDraggedItem] = useAtom(draggedItemAtom);
  const [draggedItemRotation, setDraggedItemRotation] = useAtom(
    draggedItemRotationAtom
  );
  const [roomItems, setRoomItems] = useAtom(roomItemsAtom);
  const [, setPendingInteraction] = useAtom(pendingInteractionAtom);
  const [avatarMode, setAvatarMode] = useState(false);
  const [botConnectMode, setBotConnectMode] = useState(false);
  const [roomSelectorMode, setRoomSelectorMode] = useState(false);
  const [showRoomSelector, setShowRoomSelector] = useAtom(showRoomSelectorAtom);
  const [characterSelectorMode, setCharacterSelectorMode] = useState(false);
  const [helpMode, setHelpMode] = useState(false);
  const [inviteMode, setInviteMode] = useState(false);
  const [roomInvites, setRoomInvites] = useAtom(roomInvitesAtom);
  const [allRooms] = useAtom(roomsAtom);
  const [avatarUrl, setAvatarUrl] = useAtom(avatarUrlAtom);
  const [roomID, setRoomID] = useAtom(roomIDAtom);
  const [coins] = useAtom(coinsAtom);
  const [characters] = useAtom(charactersAtom);
  const [activeQuests] = useAtom(activeQuestsAtom);
  const [questNotifications, setQuestNotifications] = useAtom(questNotificationsAtom);
  const [user] = useAtom(userAtom);
  const [characterMotives] = useAtom(characterMotivesAtom);
  const [itemsCatalog] = useAtom(itemsAtom);
  const [, setSelectedShopItem] = useAtom(selectedShopItemAtom);
  const [roomTransition, setRoomTransition] = useAtom(roomTransitionAtom);
  const [map] = useAtom(mapAtom);
  const [dmUnreadCounts] = useAtom(dmUnreadCountsAtom);
  const [dmInboxOpen, setDmInboxOpen] = useAtom(dmInboxOpenAtom);
  const [dmPanelTarget, setDmPanelTarget] = useAtom(dmPanelTargetAtom);

  // Safety timeout: force-clear the transition overlay if it stays active too long
  useEffect(() => {
    if (!roomTransition?.active) return;
    const timeout = setTimeout(() => {
      setRoomTransition({ active: false, from: null, to: null, startedAt: 0 });
    }, 8000);
    return () => clearTimeout(timeout);
  }, [roomTransition?.active, roomTransition?.startedAt]);

  // --- Client-side energy interpolation for smooth HUD ---
  // Mirror the server DECAY_RATES.energy so we can predict locally between server ticks
  const ENERGY_DECAY_PER_SEC = 0.11;
  const myEnergyRaw = user ? characterMotives?.[user]?.energy : undefined;
  const energyBaselineRef = useRef({ value: null, time: 0 });

  // Reset baseline whenever server sends a new value
  useEffect(() => {
    if (typeof myEnergyRaw === "number") {
      energyBaselineRef.current = { value: myEnergyRaw, time: Date.now() };
    }
  }, [myEnergyRaw]);

  const [interpolatedEnergy, setInterpolatedEnergy] = useState(null);
  useEffect(() => {
    if (typeof myEnergyRaw !== "number") {
      setInterpolatedEnergy(null);
      return;
    }
    const tick = () => {
      const { value, time } = energyBaselineRef.current;
      if (value === null) return;
      const dt = (Date.now() - time) / 1000;
      setInterpolatedEnergy(Math.max(0, Math.min(100, value - ENERGY_DECAY_PER_SEC * dt)));
    };
    tick();
    const id = setInterval(tick, 500); // update display every 500ms
    return () => clearInterval(id);
  }, [myEnergyRaw]);

  const myEnergy = interpolatedEnergy;
  const leaveRoom = () => {
    setRoomTransition({ active: true, from: roomID, to: null, startedAt: Date.now() });
    socket.emit("leaveRoom");
    setRoomID(null);
    setBuildMode(false);
    setShopMode(false);
  };

  const handleSwitchRoom = (targetRoomId) => {
    if (targetRoomId === roomID) return;
    setRoomTransition({ active: true, from: roomID, to: targetRoomId, startedAt: Date.now() });
    switchRoom(targetRoomId);
    setRoomID(targetRoomId);
    setBuildMode(false);
    setShopMode(false);
    soundManager.play("room_transition");
  };
  const handleAcceptInvite = (invite) => {
    soundManager.play("room_transition");
    handleSwitchRoom(invite.roomId);
    setRoomInvites((prev) => prev.filter((inv) => inv.inviteId !== invite.inviteId));
  };

  const handleDismissInvite = (invite) => {
    setRoomInvites((prev) => prev.filter((inv) => inv.inviteId !== invite.inviteId));
  };

  // Open room selector when triggered from 3D scene (e.g. clicking Apartment building)
  useEffect(() => {
    if (showRoomSelector) {
      setRoomSelectorMode(true);
      setShowRoomSelector(false);
    }
  }, [showRoomSelector]);

  const handleSelectCharacter = (url) => {
    const newUrl = url.startsWith("/") ? url : url + (url.includes("?") ? "&" : "?") + "meshlod=1&quality=medium";
    setAvatarUrl(newUrl);
    localStorage.setItem("avatarURL", newUrl);
    localStorage.setItem("clawland_avatar_chosen", "1");
    if (roomID) {
      socket.emit("characterAvatarUpdate", newUrl);
    }
  };

  const ref = useRef();
  const [chatMessage, setChatMessage] = useState("");
  const sendChatMessage = () => {
    if (chatMessage.length > 0) {
      socket.emit("chatMessage", chatMessage);
      setChatMessage("");
      soundManager.play("chat_send");
    }
  };

  // --- Eat handler: walk to stove (or room center) then interact ---
  const handleEat = useCallback(() => {
    if (!roomID || !map || !user) return;
    const stove = roomItems.find((it) => it.name === "kitchenStove");
    const fridge = roomItems.find((it) => it.name === "kitchenFridge");
    const target = stove || fridge;
    let targetPos;
    let interactionItem;

    if (target) {
      // Walk to the item's grid position
      targetPos = target.gridPosition || target.position;
      interactionItem = target.name;
    } else {
      // No food source — walk to room center and use virtual eatSpot
      targetPos = [Math.floor(map.size[0] / 2), Math.floor(map.size[1] / 2)];
      interactionItem = "eatSpot";
    }

    // Emit move to the target, set pending interaction for Avatar to fire on arrival
    const me = characters.find((c) => c.id === user);
    const from = me?.position || [0, 0];
    socket.emit("move", from, targetPos);
    setPendingInteraction({ itemName: interactionItem });
    soundManager.play("button_click");
  }, [roomID, map, user, roomItems, characters, setPendingInteraction]);

  // Keyboard shortcut for help modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        setHelpMode((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-dismiss quest notifications
  useEffect(() => {
    if (questNotifications.length === 0) return;
    soundManager.play("notification");
    const timer = setTimeout(() => {
      setQuestNotifications((prev) => prev.slice(1));
    }, 4000);
    return () => clearTimeout(timer);
  }, [questNotifications]);

  const totalOnline = characters.length;
  const botCount = characters.filter((c) => c.isBot).length;
  const playerCount = totalOnline - botCount;
  const unreadThreads = useMemo(
    () => Object.values(dmUnreadCounts).filter((count) => count > 0).length,
    [dmUnreadCounts]
  );
  const currentRoom = allRooms.find((r) => r.id === roomID);
  const isPlaza = currentRoom && !currentRoom.generated && !currentRoom.id.startsWith("room-");
  const isApartment = currentRoom && (currentRoom.generated || currentRoom.id.startsWith("room-"));
  const locationLabel = isPlaza ? "online" : "in apartment";
  const toRoom = roomTransition?.to ? allRooms.find((r) => r.id === roomTransition.to) : null;
  const toRoomLabel = toRoom?.name || toRoom?.id || (roomTransition?.to ? `room ${roomTransition.to}` : null);

  return (
    <>
      <RoomTransitionOverlay transition={roomTransition} roomLabel={toRoomLabel} />
      {/* Online Count Badge + Coins (top-right) */}
      {roomID && (
        <div className="fixed top-10 right-3 sm:top-12 sm:right-4 z-[15] flex flex-col items-end gap-1.5">
          <div className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-sm">
            <img src="/favicon.ico" alt="" className="w-4 h-4" />
            <span className="text-gray-800 font-bold text-sm">{totalOnline}</span>
            <span className="text-gray-400 text-xs">{locationLabel}</span>
            <div className="w-px h-3.5 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-gray-600 text-xs font-medium">{playerCount}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span className="text-gray-600 text-xs font-medium">{botCount}</span>
              </div>
            </div>
          </div>
          <div className="bg-amber-50/90 backdrop-blur-sm border border-amber-200 rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm">
            <span className="text-amber-500 text-sm">&#x26AA;</span>
            <span className="text-amber-700 font-bold text-sm">{coins}</span>
            <span className="text-amber-500 text-xs font-semibold">coins</span>
          </div>
          {myEnergy !== null && (
            <div className="bg-sky-50/90 backdrop-blur-sm border border-sky-200 rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm">
              <span className="text-sky-500 text-sm">
                {myEnergy <= 0 ? "\u{1F635}" : myEnergy < 20 ? "\u{1F62B}" : "\u26A1"}
              </span>
              <span className="text-sky-700 text-xs font-semibold">
                {myEnergy <= 0 ? "exhausted" : myEnergy < 20 ? "tired" : "energy"}
              </span>
              <div className="w-20 h-2 rounded-full bg-sky-100 overflow-hidden border border-sky-200">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${myEnergy}%`,
                    background: myEnergy <= 0
                      ? "#ef4444"
                      : myEnergy < 20
                        ? "linear-gradient(to right, #ef4444, #f59e0b)"
                        : myEnergy < 50
                          ? "linear-gradient(to right, #f59e0b, #84cc16)"
                          : "linear-gradient(to right, #0ea5e9, #34d399)",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quest Tracker */}
      {roomID && activeQuests.length > 0 && (
        <div className="fixed top-28 right-2 sm:top-32 sm:right-4 z-[5] pointer-events-none w-56">
          {activeQuests.map((quest) => (
            <div key={quest.id || quest.questId} className="bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-200 shadow-sm mb-1.5">
              <p className="text-xs font-bold text-amber-700 truncate">{quest.title}</p>
              {quest.required_items?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {quest.required_items.map((item, i) => (
                    <span key={i} className="text-[10px] bg-amber-50 px-1.5 py-0.5 rounded text-amber-600 border border-amber-100">
                      {item}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-amber-500 mt-1">+{quest.reward_coins} coins</p>
            </div>
          ))}
        </div>
      )}

      {/* Quest Completion Notifications */}
      <AnimatePresence>
        {questNotifications.map((notif) => (
          <motion.div
            key={notif.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[20] pointer-events-none"
          >
            <div className="bg-green-50/95 backdrop-blur-sm border border-green-200 rounded-xl px-5 py-3 shadow-lg text-center">
              <p className="text-green-700 font-bold text-sm">Quest Complete!</p>
              <p className="text-green-600 text-xs mt-0.5">{notif.title}</p>
              <p className="text-amber-600 font-semibold text-xs mt-1">+{notif.reward} coins</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Direct Message Panel */}
      <DirectMessagePanel />

      {/* Room Invite Notifications */}
      <div className="fixed bottom-24 right-4 z-[20] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {roomInvites.map((invite) => (
            <InviteNotification
              key={invite.inviteId}
              invite={invite}
              onAccept={() => handleAcceptInvite(invite)}
              onDismiss={() => handleDismissInvite(invite)}
            />
          ))}
        </AnimatePresence>
      </div>

      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        {/* Character profile + actions are now combined in CharacterMenu (Avatar.jsx) */}
        <AnimatePresence>
          {characterSelectorMode && (
            <CharacterSelectorModal
              onClose={() => { soundManager.play("menu_close"); setCharacterSelectorMode(false); }}
              currentAvatarUrl={avatarUrl}
              onSelectAvatar={handleSelectCharacter}
              onCustomAvatar={() => setAvatarMode(true)}
            />
          )}
        </AnimatePresence>
        {avatarMode && (
          <AvatarCreator
            subdomain="wawa-sensei-tutorial"
            className="fixed top-0 left-0 z-[999999999] w-full h-full" // have to put a crazy z-index to be on top of HTML generated by Drei
            onAvatarExported={(event) => {
              let newAvatarUrl =
                event.data.url === avatarUrl.split("?")[0]
                  ? event.data.url.split("?")[0] + "?" + new Date().getTime()
                  : event.data.url;
              newAvatarUrl +=
                (newAvatarUrl.includes("?") ? "&" : "?") +
                "meshlod=1&quality=medium";
              setAvatarUrl(newAvatarUrl);
              localStorage.setItem("avatarURL", newAvatarUrl);
              localStorage.setItem("clawland_avatar_chosen", "1");
              if (roomID) {
                socket.emit("characterAvatarUpdate", newAvatarUrl);
              }
              setAvatarMode(false);
            }}
          />
        )}
        {botConnectMode && (
          <BotConnectModal onClose={() => { soundManager.play("menu_close"); setBotConnectMode(false); }} />
        )}
        <AnimatePresence>
          {helpMode && (
            <HelpModal onClose={() => { soundManager.play("menu_close"); setHelpMode(false); }} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {inviteMode && (
            <InviteModal onClose={() => { soundManager.play("menu_close"); setInviteMode(false); }} />
          )}
        </AnimatePresence>
        {roomSelectorMode && (
          <RoomSelectorModal
            onClose={() => { soundManager.play("menu_close"); setRoomSelectorMode(false); }}
            currentRoomID={roomID}
            onSwitchRoom={handleSwitchRoom}
          />
        )}
        {/* Shop grid panel — HTML overlay with 3D item previews */}
        {shopMode && itemsCatalog && (
          <ShopPanel
            itemsCatalog={itemsCatalog}
            onClose={() => setShopMode(false)}
            onSelect={(item) => {
              setSelectedShopItem(item);
              setShopMode(false);
            }}
          />
        )}
        <div className="fixed inset-2 sm:inset-4 flex items-center justify-end flex-col pointer-events-none select-none z-10">
          {roomID && !shopMode && !buildMode && (
            <div className="pointer-events-auto p-2 sm:p-4 flex items-center space-x-2 sm:space-x-4" onWheel={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="w-40 sm:w-56 border border-gray-200 bg-white/90 backdrop-blur-sm px-3 sm:px-5 p-3 sm:p-4 h-full rounded-full text-sm sm:text-base text-gray-800 placeholder-gray-400"
                placeholder="Message..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendChatMessage();
                  }
                }}
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
              />
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={sendChatMessage}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center flex-wrap justify-center gap-2 sm:gap-4 pointer-events-auto">
            {/* Lobby button removed - single shared world */}
            {/* BACK */}
            {(buildMode || shopMode) && draggedItem === null && (
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={() => {
                  if (shopMode) { soundManager.play("menu_close"); setShopMode(false); }
                  else { soundManager.play("build_mode_exit"); setBuildMode(false); }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
              </button>
            )}
            {/* BOTTOM NAV BAR */}
            {!buildMode && !shopMode && (
              <div className="flex items-end justify-center gap-1 sm:gap-2 pointer-events-auto bg-white/95 backdrop-blur-sm rounded-2xl px-2 py-2 sm:px-4 sm:py-3 drop-shadow-lg border border-gray-200">
                {/* Avatar */}
                <button
                  className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => { soundManager.play("button_click"); setCharacterSelectorMode(true); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500 group-hover:text-gray-800 transition-colors">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <span className="text-[10px] sm:text-xs text-gray-500 group-hover:text-gray-800 font-medium transition-colors">Avatar</span>
                </button>

                {/* Rooms */}
                {roomID && (
                  <button
                    className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-amber-50 transition-colors group"
                    onClick={() => { soundManager.play("button_click"); setRoomSelectorMode(true); }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 group-hover:text-amber-700 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-amber-500 group-hover:text-amber-700 font-medium transition-colors">Rooms</span>
                  </button>
                )}

                {/* Invite */}
                {roomID && (
                  <button
                    className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors group"
                    onClick={() => { soundManager.play("button_click"); setInviteMode(true); }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 group-hover:text-blue-600 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-blue-400 group-hover:text-blue-600 font-medium transition-colors">Invite</span>
                  </button>
                )}

                {/* Inbox */}
                {roomID && (
                  <button
                    className="relative flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-red-50 transition-colors group"
                    onClick={() => {
                      soundManager.play("button_click");
                      if (dmInboxOpen || dmPanelTarget) {
                        setDmInboxOpen(false);
                        setDmPanelTarget(null);
                      } else {
                        setDmPanelTarget(null);
                        setDmInboxOpen(true);
                      }
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-red-400 group-hover:text-red-600 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 7.5l-8.25 5.25L5.25 7.5M3.75 5.25h16.5a1.5 1.5 0 011.5 1.5v10.5a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5z" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-red-400 group-hover:text-red-600 font-medium transition-colors">Inbox</span>
                    {unreadThreads > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unreadThreads}
                      </span>
                    )}
                  </button>
                )}

                {/* Dance */}
                {roomID && (
                  <button
                    className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-pink-50 transition-colors group"
                    onClick={() => { soundManager.play("button_click"); socket.emit("dance"); }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-pink-400 group-hover:text-pink-600 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-pink-400 group-hover:text-pink-600 font-medium transition-colors">Dance</span>
                  </button>
                )}

                {/* Eat (apartment rooms only) */}
                {roomID && isApartment && (
                  <button
                    className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-orange-50 transition-colors group"
                    onClick={handleEat}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400 group-hover:text-orange-600 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.379a48.474 48.474 0 00-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265zm-3 0a.375.375 0 11-.53 0L9 2.845l.265.265zm6 0a.375.375 0 11-.53 0L15 2.845l.265.265z" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-orange-400 group-hover:text-orange-600 font-medium transition-colors">Eat</span>
                  </button>
                )}

                {/* Build */}
                {roomID && (
                  <button
                    className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-green-50 transition-colors group"
                    onClick={() => { soundManager.play("build_mode_enter"); setBuildMode(true); }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-green-500 group-hover:text-green-700 transition-colors">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                    <span className="text-[10px] sm:text-xs text-green-500 group-hover:text-green-700 font-medium transition-colors">Build</span>
                  </button>
                )}

                {/* Divider */}
                <div className="w-px h-8 bg-gray-200 mx-1 hidden sm:block" />

                {/* Bots */}
                <button
                  className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-indigo-50 transition-colors group"
                  onClick={() => { soundManager.play("button_click"); setBotConnectMode(true); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-400 group-hover:text-indigo-600 transition-colors">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0015.75 4.5h-9A2.25 2.25 0 004.5 6.75v10.5A2.25 2.25 0 006.75 19.5z" />
                  </svg>
                  <span className="text-[10px] sm:text-xs text-indigo-400 group-hover:text-indigo-600 font-medium transition-colors">Bots</span>
                </button>

                {/* Help */}
                <button
                  className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => { soundManager.play("button_click"); setHelpMode(true); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-gray-400 group-hover:text-gray-700 transition-colors">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                  </svg>
                  <span className="text-[10px] sm:text-xs text-gray-400 group-hover:text-gray-700 font-medium transition-colors">Help</span>
                </button>
              </div>
            )}
            {/* SHOP */}
            {buildMode && !shopMode && draggedItem === null && (
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={() => { soundManager.play("menu_open"); setShopMode(true); }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"
                  />
                </svg>
              </button>
            )}

            {/* ROTATE */}
            {buildMode && !shopMode && draggedItem !== null && (
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={() =>
                  setDraggedItemRotation(
                    draggedItemRotation === 3 ? 0 : draggedItemRotation + 1
                  )
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            )}
            {/* CANCEL */}
            {buildMode && !shopMode && draggedItem !== null && (
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={() => setDraggedItem(null)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
            {/* REMOVE ITEM */}
            {buildMode && !shopMode && draggedItem !== null && (
              <button
                className="p-3 sm:p-4 rounded-full bg-white/90 text-gray-700 drop-shadow-md cursor-pointer hover:bg-white hover:text-gray-900 transition-colors border border-gray-200"
                onClick={() => {
                  setRoomItems((prev) => {
                    const newItems = [...prev];
                    newItems.splice(draggedItem, 1);
                    return newItems;
                  });
                  setDraggedItem(null);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
};
