import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

export const WelcomeModal = ({ onChoice }) => {
  const [name, setName] = useState("");
  const [step, setStep] = useState("choose"); // "choose" or "username"

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChoice("human", trimmed);
  };

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
              Join the world
            </button>
          </motion.div>
        )}
      </div>
    </AnimatePresence>
  );
};
