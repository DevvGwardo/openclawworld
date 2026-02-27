import { useAtom } from "jotai";
import { useState, useEffect } from "react";
import {
  socket,
  walletOpenAtom,
  coinsAtom,
  userIdAtom,
  directMessagesAtom,
  dmPeersAtom,
} from "./SocketManager";
import { activeDrawerAtom } from "./ui-atoms";
import Drawer from "./Drawer";
import soundManager from "../audio/SoundManager";

const WalletPanel = () => {
  const [walletOpen, setWalletOpen] = useAtom(walletOpenAtom);
  const [activeDrawer, setActiveDrawer] = useAtom(activeDrawerAtom);
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

  const handleClose = () => {
    soundManager.play("menu_close");
    setActiveDrawer(null);
    setWalletOpen(false);
  };

  const isOpen = activeDrawer === "wallet" || walletOpen;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      maxHeight="40vh"
      title="Wallet"
    >
      <div className="flex flex-col" style={{ maxHeight: "calc(40vh - 44px)", overflowY: "auto" }}>
        {/* Balance Hero */}
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 px-5 py-4 text-center mx-4 mt-1 rounded-xl">
          <p className="text-amber-100 text-xs font-semibold uppercase tracking-wide mb-1">Your Balance</p>
          <p className="text-white text-3xl font-bold">{coins}</p>
          <p className="text-amber-100 text-xs font-semibold mt-0.5">coins</p>
          <div className="mt-2 flex items-center justify-center gap-2">
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
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Send Coins</p>
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
                className="text-[11px] px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 flex-1"
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
              className="w-full px-3 py-2 text-sm border border-slate-600 rounded-xl bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            <div className="flex gap-2">
              <input
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Amount"
                className="flex-1 px-3 py-2 text-sm border border-slate-600 rounded-xl bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 text-right"
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
            <p className={`text-xs mt-2 ${transferStatus.type === "error" ? "text-red-400" : "text-green-400"}`}>
              {transferStatus.message}
            </p>
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default WalletPanel;
