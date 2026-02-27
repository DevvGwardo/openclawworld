import { atom, useAtom } from "jotai";
import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  socket,
  directMessagesAtom,
  dmUnreadCountsAtom,
  dmPeersAtom,
  dmInboxOpenAtom,
  coinsAtom,
} from "./SocketManager";
import soundManager from "../audio/SoundManager";

// Which bot's DM panel is open (null = closed)
export const dmPanelTargetAtom = atom(null);

const DirectMessagePanel = () => {
  const [target, setTarget] = useAtom(dmPanelTargetAtom);
  const [directMessages] = useAtom(directMessagesAtom);
  const [dmUnreadCounts, setDmUnreadCounts] = useAtom(dmUnreadCountsAtom);
  const [dmPeers, setDmPeers] = useAtom(dmPeersAtom);
  const [inboxOpen, setInboxOpen] = useAtom(dmInboxOpenAtom);
  const [coins] = useAtom(coinsAtom);
  const [activeTab, setActiveTab] = useState("chat");
  const [message, setMessage] = useState("");
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!target) return;
    setDmUnreadCounts((prev) => {
      if (!prev[target.id]) return prev;
      return { ...prev, [target.id]: 0 };
    });
  }, [messages.length, target?.id]);

  useEffect(() => {
    if (!target) return;
    setDmPeers((prev) => ({
      ...prev,
      [target.id]: {
        name: target.name || prev[target.id]?.name || "Player",
        isBot: !!target.isBot,
        userId: target.userId || prev[target.id]?.userId || null,
      },
    }));
    setDmUnreadCounts((prev) => {
      if (!prev[target.id]) return prev;
      return { ...prev, [target.id]: 0 };
    });
    setActiveTab("chat");
  }, [target?.id]);

  // Fetch shop when shop tab is opened
  useEffect(() => {
    if (!target || activeTab !== "shop") return;
    socket.emit("getBotShop", target.id);
    const handler = (data) => {
      if (data.botId === target.id) setShopItems(data.items || []);
    };
    socket.on("botShopInventory", handler);
    return () => socket.off("botShopInventory", handler);
  }, [target?.id, activeTab]);

  useEffect(() => {
    const handler = (event) => {
      const nextTab = event?.detail;
      if (typeof nextTab === "string") setActiveTab(nextTab);
    };
    window.addEventListener("dm-panel-tab", handler);
    return () => window.removeEventListener("dm-panel-tab", handler);
  }, []);

  const sendMessage = () => {
    if (!message.trim() || !target) return;
    setDmPeers((prev) => ({
      ...prev,
      [target.id]: { name: target.name || "Player", isBot: !!target.isBot, userId: target.userId || prev[target.id]?.userId || null },
    }));
    socket.emit("directMessage", { targetId: target.id, message: message.trim() });
    setMessage("");
    soundManager.play("chat_send");
  };

  const buyItem = (itemName) => {
    if (!target) return;
    socket.emit("buyFromBot", { botId: target.id, itemName });
  };

  const isOpen = !!(target || inboxOpen);
  const tabs = target?.isBot ? ["chat", "shop"] : ["chat"];

  return (
    <AnimatePresence>
      {isOpen && <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none">
        <motion.div
        key="dm-panel"
        initial={{ y: 30, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="pointer-events-auto w-[90vw] max-w-[380px] h-[55vh] max-h-[500px] flex flex-col bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
            {target ? (target.name || "B")[0].toUpperCase() : "I"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{target ? target.name : "Inbox"}</p>
            {target && (
              <p className="text-xs text-blue-500">
                {target.isBot ? "Bot" : "Player"}
                {target.userId ? ` • ID ${target.userId}` : ""}
              </p>
            )}
          </div>
          <button
            onClick={() => { soundManager.play("menu_close"); setTarget(null); setInboxOpen(false); }}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {target && (
          <div className="flex border-b border-gray-100">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => { soundManager.play("tab_switch"); setActiveTab(tab); }}
                className={`flex-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  activeTab === tab
                    ? "text-slate-800 border-b-2 border-slate-800"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Chat Tab */}
          {!target && (
            <div className="p-3 space-y-2">
              {threads.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-8">No messages yet</p>
              )}
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => {
                    setTarget({ id: thread.id, name: thread.name, isBot: thread.isBot, userId: thread.userId });
                    setInboxOpen(false);
                    setDmUnreadCounts((prev) => ({ ...prev, [thread.id]: 0 }));
                  }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 border border-gray-100"
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                    thread.isBot ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                  }`}>
                    {thread.name[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm truncate">{thread.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        thread.isBot ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
                      }`}>
                        {thread.isBot ? "Bot" : "Player"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{thread.lastMessage || "(no preview)"}</p>
                  </div>
                  {thread.unread > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {thread.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {target && activeTab === "chat" && (
            <div className="p-3 space-y-2">
              {messages.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-8">Start a conversation with {target.name}</p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.incoming ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-1.5 rounded-xl text-sm ${
                      msg.incoming
                        ? "bg-gray-100 text-gray-800"
                        : "bg-slate-800 text-white"
                    }`}
                  >
                    <p className="break-words">{msg.message}</p>
                    <p className={`text-[10px] mt-0.5 ${msg.incoming ? "text-gray-400" : "text-gray-300"}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Shop Tab */}
          {target && activeTab === "shop" && (
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase">Your balance</p>
                <span className="text-sm font-bold text-amber-600">{coins} coins</span>
              </div>
              {shopItems.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-8">This bot has no shop items</p>
              )}
              {shopItems.map((shopItem, i) => {
                const canAfford = coins >= shopItem.price;
                return (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{shopItem.item}</p>
                      <p className="text-xs text-amber-600 font-semibold">{shopItem.price} coins</p>
                    </div>
                    <button
                      onClick={() => buyItem(shopItem.item)}
                      disabled={!canAfford}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        canAfford
                          ? "bg-slate-800 text-white hover:bg-slate-900"
                          : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}
                    >
                      {canAfford ? "Buy" : "Not enough"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chat input (only visible on chat tab) */}
        {target && activeTab === "chat" && (
          <div className="p-2 border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:border-slate-400"
              />
              <button
                onClick={sendMessage}
                className="bg-slate-800 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-slate-900 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </motion.div>
      </div>}
    </AnimatePresence>
  );
};

export default DirectMessagePanel;
