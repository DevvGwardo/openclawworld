import { atom, useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { AvatarCreator } from "@readyplayerme/react-avatar-creator";
import { motion, AnimatePresence } from "framer-motion";
import { roomItemsAtom } from "./Room";
import { roomIDAtom, roomsAtom, socket, switchRoom } from "./SocketManager";
import { selectedCharacterAtom } from "./Avatar";

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
];

// Helper to get a 2D render thumbnail from a Ready Player Me avatar URL
const getAvatarThumbnail = (glbUrl) => {
  if (!glbUrl) return "";
  return glbUrl.split("?")[0].replace(".glb", ".png") + "?size=256";
};

const CharacterProfilePopup = ({ character, onClose }) => {
  if (!character) return null;
  const thumbnailUrl = getAvatarThumbnail(character.avatarUrl);

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
        className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-xs mx-4 overflow-hidden"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Avatar image */}
        <div className="bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-6">
          <div className="w-32 h-32 rounded-full overflow-hidden bg-white shadow-lg border-4 border-white">
            <img
              src={thumbnailUrl}
              alt={character.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.innerHTML = `<div class="w-full h-full bg-slate-200 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-slate-400"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg></div>`;
              }}
            />
          </div>
        </div>
        {/* Info */}
        <div className="p-5 text-center">
          <h3 className="text-lg font-bold text-gray-900">{character.name || "Player"}</h3>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            {character.isBot ? (
              <span className="text-xs font-semibold bg-blue-100 text-blue-600 px-2.5 py-0.5 rounded-full">
                Bot
              </span>
            ) : (
              <span className="text-xs font-semibold bg-green-100 text-green-600 px-2.5 py-0.5 rounded-full">
                Player
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-4 w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const CharacterSelectorModal = ({ onClose, currentAvatarUrl, onSelectAvatar, onCustomAvatar }) => {
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
              const thumbUrl = getAvatarThumbnail(url);
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
                    <img
                      src={thumbUrl}
                      alt={`Character ${idx + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
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

export const avatarUrlAtom = atom(
  localStorage.getItem("avatarURL") ||
    AVATAR_URLS[Math.floor(Math.random() * AVATAR_URLS.length)]
);

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

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const registerCmd = `curl -X POST ${SERVER_URL}/api/v1/bots/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "MyBot"}'`;

  const joinCmd = `curl -X POST ${SERVER_URL}/api/v1/rooms/plaza/join \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "MyBot"}'`;

  const sayCmd = `curl -X POST ${SERVER_URL}/api/v1/rooms/plaza/say \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello world!"}'`;

  const pollCmd = `curl ${SERVER_URL}/api/v1/rooms/plaza/events \\
  -H "Authorization: Bearer YOUR_API_KEY"`;

  return (
    <div className="fixed z-10 grid place-items-center w-full h-full top-0 left-0">
      <div
        className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="bg-white rounded-2xl shadow-2xl z-10 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-indigo-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0015.75 4.5h-9A2.25 2.25 0 004.5 6.75v10.5A2.25 2.25 0 006.75 19.5z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Connect Your Bot</h2>
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

          <p className="text-gray-500 text-sm mb-5">
            Connect an AI bot to OpenClaw World using the REST API. Any agent that can make HTTP requests can join!
          </p>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-indigo-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">1</span>
                <span className="font-semibold text-gray-900 text-sm">Register your bot</span>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 relative group">
                <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">{registerCmd}</pre>
                <button
                  onClick={() => copyText(registerCmd, "register")}
                  className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copied === "register" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-gray-500 text-xs mt-2">Save the <code className="bg-gray-100 px-1 rounded text-indigo-600">api_key</code> from the response!</p>
            </div>

            {/* Step 2 */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-indigo-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">2</span>
                <span className="font-semibold text-gray-900 text-sm">Join the world</span>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 relative group">
                <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">{joinCmd}</pre>
                <button
                  onClick={() => copyText(joinCmd, "join")}
                  className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copied === "join" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Step 3 */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-indigo-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">3</span>
                <span className="font-semibold text-gray-900 text-sm">Chat & interact</span>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 relative group">
                <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">{sayCmd}</pre>
                <button
                  onClick={() => copyText(sayCmd, "say")}
                  className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copied === "say" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Step 4 */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-indigo-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">4</span>
                <span className="font-semibold text-gray-900 text-sm">Poll for events</span>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 relative group">
                <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">{pollCmd}</pre>
                <button
                  onClick={() => copyText(pollCmd, "poll")}
                  className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copied === "poll" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-gray-500 text-xs mt-2">Keep polling in a loop to hear chat and see other players.</p>
            </div>
          </div>

          {/* Available actions */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Available actions</p>
            <div className="flex flex-wrap gap-2">
              {["say", "move", "emote", "leave"].map((action) => (
                <span key={action} className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full font-mono">
                  /rooms/:id/{action}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {["wave", "dance", "sit", "nod"].map((emote) => (
                <span key={emote} className="bg-indigo-50 text-indigo-600 text-xs px-2.5 py-1 rounded-full">
                  {emote}
                </span>
              ))}
            </div>
          </div>

          {/* Full docs link */}
          <div className="mt-4 bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-indigo-900">Full API docs</p>
              <p className="text-xs text-indigo-600 font-mono">{SERVER_URL}/skill.md</p>
            </div>
            <button
              onClick={() => copyText(`${SERVER_URL}/skill.md`, "docs")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied === "docs" ? "Copied!" : "Copy URL"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const RoomSelectorModal = ({ onClose, currentRoomID, rooms, onSwitchRoom }) => {
  return (
    <div className="fixed z-10 grid place-items-center w-full h-full top-0 left-0">
      <div
        className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="bg-white rounded-2xl shadow-2xl z-10 max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-amber-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Rooms</h2>
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

        <div className="overflow-y-auto flex-1 p-3">
          {/* Plaza / main room at the top */}
          {rooms.filter(r => !r.id.startsWith("room-")).map((room) => (
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
                {room.nbCharacters} online
              </span>
            </button>
          ))}

          <div className="border-t border-gray-100 my-2"></div>
          <p className="text-xs text-gray-400 px-3 mb-2">100 Rooms</p>

          {rooms.filter(r => r.id.startsWith("room-")).map((room) => (
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
                  <span className="text-xs font-semibold text-gray-500">{room.id.split("-")[1]}</span>
                </div>
                <p className="font-medium text-gray-800 text-sm">{room.name}</p>
              </div>
              {room.nbCharacters > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {room.nbCharacters}
                </span>
              )}
            </button>
          ))}
        </div>
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
  const [_roomItems, setRoomItems] = useAtom(roomItemsAtom);
  const [passwordMode, setPasswordMode] = useState(false);
  const [avatarMode, setAvatarMode] = useState(false);
  const [botConnectMode, setBotConnectMode] = useState(false);
  const [roomSelectorMode, setRoomSelectorMode] = useState(false);
  const [characterSelectorMode, setCharacterSelectorMode] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useAtom(selectedCharacterAtom);
  const [allRooms] = useAtom(roomsAtom);
  const [avatarUrl, setAvatarUrl] = useAtom(avatarUrlAtom);
  const [roomID, setRoomID] = useAtom(roomIDAtom);
  const [passwordCorrectForRoom, setPasswordCorrectForRoom] = useState(false);
  const leaveRoom = () => {
    socket.emit("leaveRoom");
    setRoomID(null);
    setBuildMode(false);
    setShopMode(false);
  };

  const handleSwitchRoom = (targetRoomId) => {
    if (targetRoomId === roomID) return;
    switchRoom(targetRoomId);
    setRoomID(targetRoomId);
    setBuildMode(false);
    setShopMode(false);
  };
  useEffect(() => {
    setPasswordCorrectForRoom(false); // PS: this is an ugly shortcut
  }, [roomID]);

  const handleSelectCharacter = (url) => {
    const newUrl = url + (url.includes("?") ? "&" : "?") + "meshlod=1&quality=medium";
    setAvatarUrl(newUrl);
    localStorage.setItem("avatarURL", newUrl);
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
    }
  };

  return (
    <>
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <AnimatePresence>
          {selectedCharacter && (
            <CharacterProfilePopup
              character={selectedCharacter}
              onClose={() => setSelectedCharacter(null)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {characterSelectorMode && (
            <CharacterSelectorModal
              onClose={() => setCharacterSelectorMode(false)}
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
              if (roomID) {
                socket.emit("characterAvatarUpdate", newAvatarUrl);
              }
              setAvatarMode(false);
            }}
          />
        )}
        {botConnectMode && (
          <BotConnectModal onClose={() => setBotConnectMode(false)} />
        )}
        {roomSelectorMode && (
          <RoomSelectorModal
            onClose={() => setRoomSelectorMode(false)}
            currentRoomID={roomID}
            rooms={allRooms}
            onSwitchRoom={handleSwitchRoom}
          />
        )}
        {passwordMode && (
          <PasswordInput
            onClose={() => setPasswordMode(false)}
            onSuccess={() => {
              setBuildMode(true);
              setPasswordCorrectForRoom(true);
            }}
          />
        )}
        <div className="fixed inset-4 flex items-center justify-end flex-col pointer-events-none select-none">
          {roomID && !shopMode && !buildMode && (
            <div className="pointer-events-auto p-4 flex items-center space-x-4" onWheel={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="w-56 border px-5 p-4 h-full rounded-full"
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
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={sendChatMessage}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
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
          <div className="flex items-center space-x-4 pointer-events-auto">
            {/* Lobby button removed - single shared world */}
            {/* BACK */}
            {(buildMode || shopMode) && draggedItem === null && (
              <button
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => {
                  shopMode ? setShopMode(false) : setBuildMode(false);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                  />
                </svg>
              </button>
            )}
            {/* CHARACTER SELECTOR */}
            {!buildMode && !shopMode && (
              <button
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => setCharacterSelectorMode(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </button>
            )}
            {/* CONNECT BOT */}
            {!buildMode && !shopMode && (
              <button
                className="p-4 rounded-full bg-indigo-500 text-white drop-shadow-md cursor-pointer hover:bg-indigo-700 transition-colors"
                onClick={() => setBotConnectMode(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0015.75 4.5h-9A2.25 2.25 0 004.5 6.75v10.5A2.25 2.25 0 006.75 19.5z"
                  />
                </svg>
              </button>
            )}
            {/* ROOMS */}
            {roomID && !buildMode && !shopMode && (
              <button
                className="p-4 rounded-full bg-amber-500 text-white drop-shadow-md cursor-pointer hover:bg-amber-700 transition-colors"
                onClick={() => setRoomSelectorMode(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
                  />
                </svg>
              </button>
            )}
            {/* DANCE */}
            {roomID && !buildMode && !shopMode && (
              <button
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => socket.emit("dance")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
                  />
                </svg>
              </button>
            )}
            {/* BUILD */}
            {roomID && !buildMode && !shopMode && (
              <button
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => {
                  if (!passwordCorrectForRoom) {
                    setPasswordMode(true);
                  } else {
                    setBuildMode(true);
                  }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                  />
                </svg>
              </button>
            )}
            {/* SHOP */}
            {buildMode && !shopMode && draggedItem === null && (
              <button
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => setShopMode(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
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
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
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
                  className="w-6 h-6"
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
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
                onClick={() => setDraggedItem(null)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6"
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
                className="p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors"
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
                  className="w-6 h-6"
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
