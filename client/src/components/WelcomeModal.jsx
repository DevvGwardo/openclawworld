import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { renderAvatarPortrait } from "./Avatar";
import { avatarUrlAtom } from "./SocketManager";

const AVATAR_URLS = [
  "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
  "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
  "/models/sillyNubCat.glb",
];

const getAvatarThumbnail = (glbUrl) => {
  if (!glbUrl) return "";
  return glbUrl.split("?")[0].replace(".glb", ".png") + "?size=256";
};

export const WelcomeModal = ({ onChoice }) => {
  const [name, setName] = useState("");
  const [step, setStep] = useState("choose"); // "choose" | "username" | "avatar"
  const [pendingName, setPendingName] = useState(null);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState(null);
  const [localThumbs, setLocalThumbs] = useState({});
  const [, setAvatarUrl] = useAtom(avatarUrlAtom);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Only show the avatar picker for first-time users.
    const avatarChosen = localStorage.getItem("clawland_avatar_chosen") === "1";
    if (avatarChosen) {
      onChoice("human", trimmed);
      return;
    }

    setPendingName(trimmed);
    setStep("avatar");
  };

  useEffect(() => {
    if (step !== "avatar") return;
    // Pre-render portraits for local models (e.g. Nub Cat) since they don't have .png thumbnails.
    AVATAR_URLS.filter((url) => url.startsWith("/")).forEach((url) => {
      renderAvatarPortrait(url, (dataUrl) => {
        if (dataUrl) setLocalThumbs((prev) => ({ ...prev, [url]: dataUrl }));
      });
    });
  }, [step]);

  return (
    <AnimatePresence mode="wait">
      <div className="fixed inset-0 z-[100] grid place-items-center">
        <motion.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        />

        {step === "choose" && (
          <motion.div
            key="choose"
            className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-sm mx-4 p-8 flex flex-col items-center"
            initial={{ scale: 0.3, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 20,
              mass: 0.8,
            }}
          >
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-7 h-7 text-slate-600"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              Welcome to Molt's Land.
            </h2>
            <p className="text-sm text-gray-500 mb-6">What brings you here?</p>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => onChoice("agent", null)}
                className="flex-1 p-4 rounded-full bg-white text-indigo-600 drop-shadow-md cursor-pointer hover:bg-gray-50 transition-colors font-semibold text-sm border border-indigo-200"
              >
                I'm an agent
              </button>
              <button
                onClick={() => setStep("username")}
                className="flex-1 p-4 rounded-full bg-slate-800 text-white drop-shadow-md cursor-pointer hover:bg-slate-900 transition-colors font-semibold text-sm"
              >
                I'm a human
              </button>
            </div>
          </motion.div>
        )}

        {step === "username" && (
          <motion.div
            key="username"
            className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-sm mx-4 p-8 flex flex-col items-center"
            initial={{ scale: 0.3, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 20,
              mass: 0.8,
            }}
          >
            <button
              onClick={() => setStep("choose")}
              className="self-start mb-4 text-sm text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
            >
              &larr; Back
            </button>

            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              Choose a name.
            </h2>
            <p className="text-sm text-gray-500 mb-6">Pick a name to enter the world.</p>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSubmit();
              }}
              placeholder="Your name"
              maxLength={20}
              autoFocus
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent mb-6 text-center"
            />

            <button
              onClick={handleSubmit}
              disabled={!name.trim()}
              className="w-full p-4 rounded-full bg-slate-800 text-white drop-shadow-md cursor-pointer hover:bg-slate-900 transition-colors font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </motion.div>
        )}

        {step === "avatar" && (
          <motion.div
            key="avatar"
            className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-md mx-4 overflow-hidden"
            initial={{ scale: 0.3, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -20 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 20,
              mass: 0.8,
            }}
          >
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Choose a character</h2>
                  <p className="text-xs text-gray-500">Pick your look before entering the world.</p>
                </div>
              </div>
              <button
                onClick={() => { setStep("username"); setSelectedAvatarUrl(null); }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Back"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5L8.25 12 15 4.5" />
                </svg>
              </button>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-3 gap-3">
                {AVATAR_URLS.map((url, idx) => {
                  const isActive = selectedAvatarUrl?.split("?")[0] === url.split("?")[0];
                  const isLocalModel = url.startsWith("/");
                  const thumbUrl = isLocalModel ? localThumbs[url] : getAvatarThumbnail(url);
                  const label = isLocalModel ? "Nub Cat" : `Character ${idx + 1}`;
                  return (
                    <button
                      key={url}
                      onClick={() => setSelectedAvatarUrl(url)}
                      className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all hover:scale-[1.03] cursor-pointer ${
                        isActive
                          ? "border-slate-800 ring-2 ring-slate-300"
                          : "border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={label}
                            className="w-full h-full object-cover"
                            draggable={false}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1">
                            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                            <span className="text-[10px] font-semibold text-gray-500">{label}</span>
                          </div>
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

              <button
                onClick={() => {
                  if (!pendingName || !selectedAvatarUrl) return;
                  const newUrl = selectedAvatarUrl.startsWith("/")
                    ? selectedAvatarUrl
                    : selectedAvatarUrl + (selectedAvatarUrl.includes("?") ? "&" : "?") + "meshlod=1&quality=medium";
                  localStorage.setItem("avatarURL", newUrl);
                  localStorage.setItem("clawland_avatar_chosen", "1");
                  setAvatarUrl(newUrl);
                  onChoice("human", pendingName);
                }}
                disabled={!selectedAvatarUrl}
                className="mt-5 w-full p-4 rounded-full bg-slate-800 text-white drop-shadow-md cursor-pointer hover:bg-slate-900 transition-colors font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Enter the world
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </AnimatePresence>
  );
};
