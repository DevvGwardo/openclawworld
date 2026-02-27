import { useAtom } from "jotai";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  socket,
  walletOpenAtom,
  coinsAtom,
  userIdAtom,
  directMessagesAtom,
  dmPeersAtom,
} from "./SocketManager";
import soundManager from "../audio/SoundManager";

const WalletPanel = () => {
  const [walletOpen, setWalletOpen] = useAtom(walletOpenAtom);
  const [coins] = useAtom(coinsAtom);
  const [userId] = useAtom(userIdAtom);
  const [directMessages] = useAtom(directMessagesAtom);
  const [dmPeers] = useAtom(dmPeersAtom);

  const [transferAmount, setTransferAmount] = useState("");
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferStatus, setTransferStatus] = useState(null);

  // Build recent recipients from DM threads that have userId
  const recentRecipients = Object.entries(directMessages)
    .map(([peerId, msgs]) => {
      const last = msgs[msgs.length - 1];
      const meta = dmPeers[peerId] || {};
      return {
        id: peerId,
        name: meta.name || last?.senderName || "Unknown",
        userId: meta.userId || null,
        lastTimestamp: last?.timestamp || 0,
      };
    })
    .filter((t) => t.userId)
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, 6);

  // Socket listeners for transfer results
  useEffect(() => {
    const onSuccess = (value) => {
      setTransferStatus({ type: "success", message: `Sent ${value.amount} coins.` });
      setTransferAmount("");
    };
    const onError = (value) => {
      setTransferStatus({ type: "error", message: value?.error || "Transfer failed." });
    };
    socket.on("coinsTransferSuccess", onSuccess);
    socket.on("coinsTransferError", onError);
    return () => {
      socket.off("coinsTransferSuccess", onSuccess);
      socket.off("coinsTransferError", onError);
    };
  }, []);

  const sendCoins = () => {
    const amount = parseInt(transferAmount, 10);
    const recipientId = (transferTargetId || "").trim();
    if (!recipientId || !Number.isFinite(amount) || amount <= 0) {
      setTransferStatus({ type: "error", message: "Enter a valid recipient ID and amount." });
      return;
    }
    socket.emit("coins:transfer", { toUserId: recipientId, amount });
  };

  const copyMyId = async () => {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      setTransferStatus({ type: "success", message: "Copied your user ID." });
    } catch {
      setTransferStatus({ type: "error", message: "Clipboard blocked. Select and copy your ID manually." });
    }
  };

  return (
    <AnimatePresence>
      {walletOpen && (
        <motion.div
          key="wallet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-30 flex items-center justify-center"
          onClick={() => { soundManager.play("menu_close"); setWalletOpen(false); }}
        >
          <motion.div
            key="wallet-panel"
            initial={{ y: 30, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-[90vw] max-w-[380px] bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Balance Hero */}
            <div className="bg-gradient-to-br from-amber-400 to-amber-500 px-5 py-5 text-center relative">
              <button
                onClick={() => { soundManager.play("menu_close"); setWalletOpen(false); }}
                className="absolute top-3 right-3 text-amber-100 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <p className="text-amber-100 text-xs font-semibold uppercase tracking-wide mb-1">Your Balance</p>
              <p className="text-white text-3xl font-bold">{coins}</p>
              <p className="text-amber-100 text-xs font-semibold mt-0.5">coins</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-amber-100 text-[10px] truncate max-w-[180px]">ID: {userId}</span>
                <button
                  onClick={copyMyId}
                  className="px-2 py-0.5 text-[10px] font-semibold rounded bg-white/20 text-white hover:bg-white/30 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* Send Coins Form */}
            <div className="px-4 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Send Coins</p>
              <div className="flex items-center gap-2 mb-2">
                {recentRecipients.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setTransferTargetId(e.target.value);
                        setTransferStatus(null);
                      }
                    }}
                    className="text-[11px] px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 flex-1"
                  >
                    <option value="">Recent recipients...</option>
                    {recentRecipients.map((rec) => (
                      <option key={rec.id} value={rec.userId}>
                        {rec.name} ({rec.userId.slice(0, 8)}...)
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="space-y-2">
                <input
                  value={transferTargetId}
                  onChange={(e) => setTransferTargetId(e.target.value)}
                  placeholder="Recipient user ID"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 bg-gray-50"
                />
                <div className="flex gap-2">
                  <input
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Amount"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 bg-gray-50 text-right"
                  />
                  <button
                    onClick={sendCoins}
                    className="px-5 py-2 text-sm font-semibold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
                  >
                    Send
                  </button>
                </div>
              </div>

              {/* Status message */}
              {transferStatus && (
                <p className={`text-xs mt-2 ${transferStatus.type === "error" ? "text-red-500" : "text-green-600"}`}>
                  {transferStatus.message}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WalletPanel;
