import { useAtom } from "jotai";
import { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { activeDrawerAtom } from "./ui-atoms";
import { Drawer } from "./Drawer";
import {
  socket,
  chatMessagesAtom,
  dmInboxOpenAtom,
  walletOpenAtom,
  dmUnreadCountsAtom,
  coinsAtom,
  userIdAtom,
  directMessagesAtom,
  dmPeersAtom,
  roomIDAtom,
} from "./SocketManager";
import { dmPanelTargetAtom } from "./DirectMessagePanel";
import { activityEventsAtom } from "./ActivityFeed";
import { masterVolumeAtom, musicVolumeAtom, sfxVolumeAtom, uiVolumeAtom, mutedAtom } from "../audio/atoms";
import soundManager from "../audio/SoundManager";

// ─────────────────────────────────────────────────────────────────────────────
// Chat Drawer Content
// ─────────────────────────────────────────────────────────────────────────────

const ChatDrawerContent = ({ onClose }) => {
  const [messages] = useAtom(chatMessagesAtom);
  const [events] = useAtom(activityEventsAtom);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [roomID] = useAtom(roomIDAtom);
  const scrollRef = useRef(null);

  const EXPIRE_MS = 6000;
  const visibleEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => now - e.timestamp < EXPIRE_MS).slice(-20);
  }, [events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const sendMessage = () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    socket.emit("chatMessage", trimmed);
    setChatInput("");
    soundManager.play("chat_send");
  };

  return (
    <div className="flex flex-col" style={{ maxHeight: "inherit" }}>
      {/* Tabs + close */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-700/50 flex-shrink-0">
        {["chat", "activity"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${
              activeTab === tab ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white transition-colors p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5"
        style={{ maxHeight: "calc(40vh - 100px)", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
      >
        {activeTab === "chat" && (
          messages.length === 0
            ? <p className="text-slate-500 text-xs text-center py-6">No messages yet.</p>
            : messages.map((msg) => (
              <div key={msg.id} className="text-sm leading-snug">
                <span className={`font-bold ${msg.isBot ? "text-blue-400" : "text-white"}`}>
                  {msg.senderName}
                  {msg.isBot && <span className="text-blue-400 ml-1 text-xs">[BOT]</span>}
                </span>
                <span className="text-slate-300 ml-1.5">{msg.message}</span>
              </div>
            ))
        )}
        {activeTab === "activity" && (
          visibleEvents.length === 0
            ? <p className="text-slate-500 text-xs text-center py-6">No recent activity.</p>
            : visibleEvents.map((event) => (
              <div key={event.id} className="text-xs text-slate-300 flex items-center gap-1.5">
                <span>🦀</span>
                <span className="font-semibold text-white">{event.name}</span>
                {event.isBot && <span className="text-blue-400 text-[10px]">BOT</span>}
                <span className="text-slate-400">{event.detail || event.type}</span>
              </div>
            ))
        )}
      </div>

      {/* Input */}
      {roomID && activeTab === "chat" && (
        <div className="px-4 py-3 border-t border-slate-700/50 flex-shrink-0 flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
            placeholder="Message..."
            className="flex-1 bg-white/5 border border-slate-700/50 rounded-full px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
          />
          <button
            onClick={sendMessage}
            className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DMs Drawer Content
// ─────────────────────────────────────────────────────────────────────────────

const DmsDrawerContent = ({ onClose }) => {
  const [target, setTarget] = useAtom(dmPanelTargetAtom);
  const [directMessages] = useAtom(directMessagesAtom);
  const [dmUnreadCounts, setDmUnreadCounts] = useAtom(dmUnreadCountsAtom);
  const [dmPeers, setDmPeers] = useAtom(dmPeersAtom);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [shopItems, setShopItems] = useState([]);
  const messagesEndRef = useRef(null);

  const messages = target ? (directMessages[target.id] || []) : [];
  const threads = Object.entries(directMessages)
    .map(([peerId, msgs]) => {
      const last = msgs[msgs.length - 1];
      const meta = dmPeers[peerId] || {};
      return {
        id: peerId,
        name: meta.name || last?.senderName || "Unknown",
        isBot: meta.isBot ?? last?.senderIsBot ?? false,
        userId: meta.userId || null,
        lastMessage: last?.message || "",
        lastTimestamp: last?.timestamp || 0,
        unread: dmUnreadCounts[peerId] || 0,
      };
    })
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  useEffect(() => {
    if (!target) return;
    setDmUnreadCounts((prev) => (!prev[target.id] ? prev : { ...prev, [target.id]: 0 }));
  }, [messages.length, target?.id]);

  useEffect(() => {
    if (!target) return;
    setDmPeers((prev) => ({
      ...prev,
      [target.id]: { name: target.name || prev[target.id]?.name || "Player", isBot: !!target.isBot, userId: target.userId || prev[target.id]?.userId || null },
    }));
    setDmUnreadCounts((prev) => (!prev[target.id] ? prev : { ...prev, [target.id]: 0 }));
    setActiveTab("chat");
  }, [target?.id]);

  useEffect(() => {
    if (!target || activeTab !== "shop") return;
    socket.emit("getBotShop", target.id);
    const onShop = (data) => { if (data.botId === target.id) setShopItems(data.items || []); };
    socket.on("botShop", onShop);
    return () => socket.off("botShop", onShop);
  }, [target?.id, activeTab]);

  const sendDm = () => {
    const trimmed = message.trim();
    if (!trimmed || !target) return;
    socket.emit("directMessage", { toId: target.id, message: trimmed });
    setMessage("");
    soundManager.play("chat_send");
  };

  if (!target) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-700/50 flex-shrink-0">
          <span className="text-white font-semibold text-sm">Direct Messages</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {threads.length === 0
            ? <p className="text-slate-500 text-xs text-center py-6">No messages yet. Click a player to DM them.</p>
            : threads.map((t) => (
              <button key={t.id} onClick={() => setTarget({ id: t.id, name: t.name, isBot: t.isBot, userId: t.userId })}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 transition-colors text-left mb-1">
                <div className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">{(t.name || "?")[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white text-sm truncate">{t.name}</span>
                    {t.isBot && <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 rounded">Bot</span>}
                  </div>
                  <span className="text-xs text-slate-400 truncate block">{t.lastMessage}</span>
                </div>
                {t.unread > 0 && (
                  <span className="flex-shrink-0 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{t.unread}</span>
                )}
              </button>
            ))
          }
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-700/50 flex-shrink-0">
        <button onClick={() => setTarget(null)} className="text-slate-400 hover:text-white p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <span className="font-semibold text-white text-sm flex-1 truncate">{target.name}</span>
        {target.isBot && ["chat", "shop"].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${activeTab === tab ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white"}`}>
            {tab}
          </button>
        ))}
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      {activeTab === "chat" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.fromSelf ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] px-3 py-1.5 rounded-xl text-sm ${msg.fromSelf ? "bg-orange-500 text-white" : "bg-white/10 text-slate-200"}`}>
                  {msg.message}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="px-4 py-3 border-t border-slate-700/50 flex-shrink-0 flex gap-2">
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendDm(); }}
              placeholder={`Message ${target.name}...`}
              className="flex-1 bg-white/5 border border-slate-700/50 rounded-full px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
            <button onClick={sendDm} className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition-colors flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
            </button>
          </div>
        </>
      )}
      {activeTab === "shop" && (
        <div className="flex-1 overflow-y-auto px-4 py-3 grid grid-cols-3 gap-2">
          {shopItems.length === 0
            ? <p className="col-span-3 text-slate-500 text-xs text-center py-4">No items for sale.</p>
            : shopItems.map((item) => (
              <button key={item.id} onClick={() => { socket.emit("buyItem", { botId: target.id, itemId: item.id }); soundManager.play("purchase"); }}
                className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
                <span className="text-2xl">{item.emoji || "📦"}</span>
                <span className="text-[11px] text-slate-300 text-center leading-tight">{item.name}</span>
                {item.price != null && <span className="text-[10px] text-amber-400 font-semibold">{item.price} 🪙</span>}
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Drawer Content
// ─────────────────────────────────────────────────────────────────────────────

const WalletDrawerContent = ({ onClose }) => {
  const [coins] = useAtom(coinsAtom);
  const [userId] = useAtom(userIdAtom);
  const [directMessages] = useAtom(directMessagesAtom);
  const [dmPeers] = useAtom(dmPeersAtom);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferStatus, setTransferStatus] = useState(null);

  const recentRecipients = Object.entries(directMessages)
    .map(([peerId, msgs]) => {
      const last = msgs[msgs.length - 1];
      const meta = dmPeers[peerId] || {};
      return { id: peerId, name: meta.name || last?.senderName || "Unknown", userId: meta.userId || null, lastTimestamp: last?.timestamp || 0 };
    })
    .filter((t) => t.userId)
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, 6);

  useEffect(() => {
    const onSuccess = (value) => { setTransferStatus({ type: "success", message: `Sent ${value.amount} coins.` }); setTransferAmount(""); };
    const onError = (value) => { setTransferStatus({ type: "error", message: value?.error || "Transfer failed." }); };
    socket.on("coinsTransferSuccess", onSuccess);
    socket.on("coinsTransferError", onError);
    return () => { socket.off("coinsTransferSuccess", onSuccess); socket.off("coinsTransferError", onError); };
  }, []);

  const sendCoins = () => {
    const amount = parseInt(transferAmount, 10);
    const recipientId = (transferTargetId || "").trim();
    if (!recipientId || !Number.isFinite(amount) || amount <= 0) { setTransferStatus({ type: "error", message: "Enter a valid recipient ID and amount." }); return; }
    socket.emit("coins:transfer", { toUserId: recipientId, amount });
  };

  const copyMyId = async () => {
    if (!userId) return;
    try { await navigator.clipboard.writeText(userId); setTransferStatus({ type: "success", message: "Copied your user ID." }); }
    catch { setTransferStatus({ type: "error", message: "Clipboard blocked." }); }
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-semibold text-sm">Wallet</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="bg-gradient-to-br from-amber-500/30 to-amber-600/20 rounded-xl px-4 py-4 text-center border border-amber-500/20">
        <p className="text-amber-300 text-xs font-semibold uppercase tracking-wide mb-1">Balance</p>
        <p className="text-white text-3xl font-bold">{coins}</p>
        <p className="text-amber-400 text-xs font-semibold mt-0.5">coins</p>
        <div className="flex items-center justify-center gap-2 mt-2.5">
          <span className="text-slate-400 text-[10px] truncate max-w-[160px]">ID: {userId}</span>
          <button onClick={copyMyId} className="px-2 py-0.5 text-[10px] font-semibold rounded bg-white/10 text-white hover:bg-white/20 transition-colors">Copy</button>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Send Coins</p>
        {recentRecipients.length > 0 && (
          <select value="" onChange={(e) => { if (e.target.value) { setTransferTargetId(e.target.value); setTransferStatus(null); } }}
            className="w-full text-xs px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 mb-2 focus:outline-none">
            <option value="">Recent recipients...</option>
            {recentRecipients.map((rec) => (
              <option key={rec.id} value={rec.userId}>{rec.name} ({rec.userId.slice(0, 8)}...)</option>
            ))}
          </select>
        )}
        <div className="space-y-2">
          <input value={transferTargetId} onChange={(e) => setTransferTargetId(e.target.value)} placeholder="Recipient user ID"
            className="w-full px-3 py-2 text-sm border border-white/10 rounded-xl bg-white/5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50" />
          <div className="flex gap-2">
            <input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="Amount"
              className="flex-1 px-3 py-2 text-sm border border-white/10 rounded-xl bg-white/5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 text-right" />
            <button onClick={sendCoins} className="px-4 py-2 text-sm font-semibold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors">Send</button>
          </div>
        </div>
        {transferStatus && (
          <p className={`text-xs mt-2 ${transferStatus.type === "error" ? "text-red-400" : "text-green-400"}`}>{transferStatus.message}</p>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Audio Drawer Content
// ─────────────────────────────────────────────────────────────────────────────

const VolumeSlider = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-slate-400 w-12 flex-shrink-0">{label}</span>
    <input type="range" min="0" max="1" step="0.05" value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-orange-500" style={{ background: "rgba(255,255,255,0.1)" }} />
    <span className="text-[10px] text-slate-500 w-7 text-right">{Math.round(value * 100)}%</span>
  </div>
);

const AudioDrawerContent = ({ onClose }) => {
  const [master, setMaster] = useAtom(masterVolumeAtom);
  const [music, setMusic] = useAtom(musicVolumeAtom);
  const [sfx, setSfx] = useAtom(sfxVolumeAtom);
  const [ui, setUi] = useAtom(uiVolumeAtom);
  const [muted, setMuted] = useAtom(mutedAtom);

  const updateVolume = (category, value, setter) => { setter(value); soundManager.setVolume(category, value); };
  const toggleMute = () => { const next = !muted; setMuted(next); soundManager.setMuted(next); };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-semibold text-sm">Audio Settings</span>
        <div className="flex items-center gap-2">
          <button onClick={toggleMute}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${muted ? "bg-red-500/30 text-red-400 border border-red-500/30" : "bg-green-500/30 text-green-400 border border-green-500/30"}`}>
            {muted ? "Muted" : "On"}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <VolumeSlider label="Master" value={master} onChange={(v) => updateVolume("master", v, setMaster)} />
      <VolumeSlider label="Music" value={music} onChange={(v) => updateVolume("music", v, setMusic)} />
      <VolumeSlider label="SFX" value={sfx} onChange={(v) => updateVolume("sfx", v, setSfx)} />
      <VolumeSlider label="UI" value={ui} onChange={(v) => updateVolume("ui", v, setUi)} />
      <p className="text-[10px] text-slate-500 text-center pt-1">
        Press <kbd className="px-1 py-0.5 bg-white/10 rounded text-slate-400 font-mono">M</kbd> to toggle mute
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Help Drawer Content
// ─────────────────────────────────────────────────────────────────────────────

const HELP_SECTIONS = {
  basics: [
    { key: "Move", desc: "Click anywhere on the ground to walk there" },
    { key: "Chat", desc: "Open the Chat drawer and type a message" },
    { key: "Dance", desc: "Click ··· → Dance" },
    { key: "Switch Rooms", desc: "Click 🗺️ Rooms to browse and join rooms" },
    { key: "Change Avatar", desc: "Click ··· → Avatar to pick a character" },
    { key: "Coins", desc: "Earn coins from social milestones — check Wallet" },
  ],
  social: [
    { key: "Click a Player", desc: "Opens their profile card with actions" },
    { key: "Follow", desc: "Follow a player and your camera tracks them" },
    { key: "DMs", desc: "Open the DMs drawer to message players directly" },
    { key: "Shop", desc: "Buy items from bot shops via the Shop tab in DMs" },
  ],
  building: [
    { key: "Enter Build Mode", desc: "Click ··· → Build — requires room password" },
    { key: "Open Shop", desc: "In build mode, click the shop icon" },
    { key: "Place Item", desc: "Drag an item from the shop onto the grid" },
    { key: "Rotate", desc: "Click the rotate button while placing an item" },
  ],
  camera: [
    { key: "Zoom", desc: "Scroll the mouse wheel to zoom in and out" },
    { key: "Rotate View", desc: "Right-click and drag to rotate the camera" },
    { key: "Q / E Keys", desc: "Press Q or E to rotate the camera left or right" },
  ],
};

const HelpDrawerContent = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState("basics");
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-700/50 flex-shrink-0">
        <span className="text-white font-semibold text-sm">Help</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex gap-1 px-4 py-2 border-b border-slate-700/50 flex-wrap">
        {Object.keys(HELP_SECTIONS).map((tab) => (
          <button key={tab} onClick={() => setActiveSection(tab)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${activeSection === tab ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white"}`}>
            {tab}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto px-4 py-3 space-y-2">
        {HELP_SECTIONS[activeSection].map((item, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-500/30 text-orange-400 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
            <div>
              <p className="font-semibold text-white text-xs">{item.key}</p>
              <p className="text-slate-400 text-xs mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 text-center px-4 py-2 border-t border-slate-700/50">
        Press <kbd className="px-1 py-0.5 bg-white/10 rounded text-slate-400 font-mono">?</kbd> to open help
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BottomToolbar
// ─────────────────────────────────────────────────────────────────────────────

const DRAWER_CONFIG = {
  chat:   { maxHeight: "40vh" },
  dms:    { maxHeight: "50vh" },
  wallet: { maxHeight: "40vh" },
  audio:  { maxHeight: "30vh" },
  help:   { maxHeight: "50vh" },
};

export const BottomToolbar = () => {
  const [activeDrawer, setActiveDrawer] = useAtom(activeDrawerAtom);
  const [, setWalletOpen] = useAtom(walletOpenAtom);
  const [, setDmInboxOpen] = useAtom(dmInboxOpenAtom);
  const [dmUnreadCounts] = useAtom(dmUnreadCountsAtom);
  const [muted] = useAtom(mutedAtom);

  const unreadThreads = useMemo(
    () => Object.values(dmUnreadCounts).filter((count) => count > 0).length,
    [dmUnreadCounts]
  );

  // Backward compat: sync activeDrawerAtom → legacy atoms
  useEffect(() => {
    setWalletOpen(activeDrawer === "wallet");
    setDmInboxOpen(activeDrawer === "dms");
  }, [activeDrawer]);

  const toggle = (name) => {
    soundManager.play("button_click");
    setActiveDrawer((prev) => (prev === name ? null : name));
  };

  const closeDrawer = () => {
    soundManager.play("menu_close");
    setActiveDrawer(null);
  };

  const config = DRAWER_CONFIG[activeDrawer] || {};

  return (
    <>
      {/* Active drawer */}
      <Drawer isOpen={!!activeDrawer} onClose={closeDrawer} maxHeight={config.maxHeight}>
        {activeDrawer === "chat"   && <ChatDrawerContent   onClose={closeDrawer} />}
        {activeDrawer === "dms"    && <DmsDrawerContent    onClose={closeDrawer} />}
        {activeDrawer === "wallet" && <WalletDrawerContent onClose={closeDrawer} />}
        {activeDrawer === "audio"  && <AudioDrawerContent  onClose={closeDrawer} />}
        {activeDrawer === "help"   && <HelpDrawerContent   onClose={closeDrawer} />}
      </Drawer>

      {/* Toolbar bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/90 backdrop-blur-md border-t border-slate-700/50 h-14">
        <div className="flex items-center justify-center h-full gap-1 px-2 max-w-lg mx-auto">

          {/* Chat */}
          <ToolbarBtn
            label="Chat"
            active={activeDrawer === "chat"}
            onClick={() => toggle("chat")}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            }
          />

          {/* DMs */}
          <ToolbarBtn
            label="DMs"
            active={activeDrawer === "dms"}
            onClick={() => toggle("dms")}
            badge={unreadThreads}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            }
          />

          {/* Wallet */}
          <ToolbarBtn
            label="Wallet"
            active={activeDrawer === "wallet"}
            onClick={() => toggle("wallet")}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
              </svg>
            }
          />

          {/* Audio */}
          <ToolbarBtn
            label="Audio"
            active={activeDrawer === "audio"}
            onClick={() => toggle("audio")}
            icon={
              muted
                ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )
            }
          />

          {/* Help */}
          <ToolbarBtn
            label="Help"
            active={activeDrawer === "help"}
            onClick={() => toggle("help")}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            }
          />
        </div>
      </div>
    </>
  );
};

// Small presenter component for toolbar buttons
const ToolbarBtn = ({ icon, label, active, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`relative flex flex-col items-center justify-center gap-0.5 px-3 sm:px-4 py-1.5 rounded-xl transition-colors cursor-pointer min-w-[52px] ${
      active ? "text-orange-400" : "text-slate-400 hover:text-slate-200"
    }`}
  >
    {icon}
    <span className={`text-[9px] font-medium leading-none ${active ? "text-orange-400" : ""}`}>{label}</span>
    {badge > 0 && (
      <span className="absolute -top-0.5 right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
        {badge}
      </span>
    )}
  </button>
);
