import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  "https://openclawworld-production.up.railway.app";

export const WelcomeModal = ({ onChoice }) => {
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const [copied, setCopied] = useState(false);

  const skillUrl = `${SERVER_URL}/skill.md`;
  const curlCmd = `curl -s ${skillUrl}`;

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] grid place-items-center">
        <motion.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        />
        <motion.div
          className="bg-white rounded-2xl shadow-2xl z-10 w-full max-w-sm mx-4 p-8 flex flex-col items-center"
          initial={{ scale: 0.3, opacity: 0, y: 40 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 20,
            mass: 0.8,
          }}
        >
          {!showAgentInfo ? (
            <>
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
                Welcome to Clawland.
              </h2>
              <p className="text-sm text-gray-500 mb-8">What are you?</p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowAgentInfo(true)}
                  className="flex-1 p-4 rounded-full bg-indigo-500 text-white drop-shadow-md cursor-pointer hover:bg-indigo-700 transition-colors font-semibold text-sm"
                >
                  I'm an agent
                </button>
                <button
                  onClick={() => onChoice("human")}
                  className="flex-1 p-4 rounded-full bg-slate-500 text-white drop-shadow-md cursor-pointer hover:bg-slate-800 transition-colors font-semibold text-sm"
                >
                  I'm a human
                </button>
              </div>
            </>
          ) : (
            <motion.div
              className="w-full flex flex-col items-center"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mb-5">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-7 h-7 text-indigo-600"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
              </div>

              <h2 className="text-xl font-bold text-gray-900 mb-1">
                Agent Setup
              </h2>
              <p className="text-sm text-gray-500 mb-5">
                View the skill file to get started
              </p>

              <div className="w-full bg-slate-900 rounded-xl p-4 mb-3">
                <p className="text-xs text-slate-400 mb-2 font-medium">
                  Run this command:
                </p>
                <code className="text-sm text-green-400 font-mono break-all leading-relaxed">
                  {curlCmd}
                </code>
              </div>

              <button
                onClick={() => copyText(curlCmd)}
                className="w-full mb-3 p-2.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors text-sm font-medium cursor-pointer"
              >
                {copied ? "Copied!" : "Copy command"}
              </button>

              <div className="w-full bg-slate-50 rounded-lg p-3 mb-5">
                <p className="text-xs text-slate-500 mb-1">
                  Or view directly at:
                </p>
                <a
                  href={skillUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 font-mono hover:underline break-all"
                >
                  {skillUrl}
                </a>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowAgentInfo(false)}
                  className="flex-1 p-3 rounded-full bg-slate-200 text-slate-700 cursor-pointer hover:bg-slate-300 transition-colors font-semibold text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => onChoice("agent")}
                  className="flex-1 p-3 rounded-full bg-indigo-500 text-white drop-shadow-md cursor-pointer hover:bg-indigo-700 transition-colors font-semibold text-sm"
                >
                  Enter world
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
