import { atom, useAtom } from "jotai";
import { useState, useEffect, useRef } from "react";
import {
  socket,
  directMessagesAtom,
  dmUnreadCountsAtom,
  dmPeersAtom,
  dmInboxOpenAtom,
  coinsAtom,
} from "./SocketManager";
import { activeDrawerAtom } from "./ui-atoms";
import Drawer from "./Drawer";
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
  const [activeDrawer, setActiveDrawer] = useAtom(activeDrawerAtom);
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

  // When target is set externally (e.g. clicking a character), open DMs drawer
  useEffect(() => {
    if (target && activeDrawer !== "dms") {
      setActiveDrawer("dms");
    }
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

  const handleClose = () => {
    soundManager.play("menu_close");
    setActiveDrawer(null);
    setTarget(null);
    setInboxOpen(false);
  };

  const isOpen = activeDrawer === "dms" || !!(target || inboxOpen);
  const tabs = target?.isBot ? ["chat", "shop"] : ["chat"];
  const drawerTitle = target ? target.name : "Inbox";

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      maxHeight="50vh"
      title={drawerTitle}
    >
      <div className="flex flex-col" style={{ maxHeight: "calc(50vh - 44px)" }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
            target ? "bg-blue-900/60 text-blue-300" : "bg-slate-700 text-slate-300"
          }`}>
            {target ? (target.name || "B")[0].toUpperCase() : "📬"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm truncate">{drawerTitle}</p>
            {target && (
              <p className="text-xs text-blue-400">
                {target.isBot ? "Bot" : "Player"}
                {target.userId ? ` • ID ${target.userId}` : ""}
              </p>
            )}
          </div>
          {target && (
            <button
              onClick={() => { setTarget(null); setInboxOpen(true); }}
              className="text-slate-500 hover:text-slate-300 transition-colors text-xs px-2 py-1 rounded"
            >
              ← Back
            </button>
          )}
        </div>

        {/* Tabs */}
        {target && (
          <div className="flex border-b border-slate-700/50">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => { soundManager.play("tab_switch"); setActiveTab(tab); }}
                className={`flex-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  activeTab === tab
                    ? "text-orange-400 border-b-2 border-orange-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Inbox thread list */}
          {!target && (
            <div className="p-3 space-y-2">
              {threads.length === 0 && (
                <p className="text-center text-slate-500 text-xs mt-8">No messages yet</p>
              )}
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => {
                    setTarget({ id: thread.id, name: thread.name, isBot: thread.isBot, userId: thread.userId });
                    setInboxOpen(false);
                    setDmUnreadCounts((prev) => ({ ...prev, [thread.id]: 0 }));
                  }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800 border border-slate-700/50"
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                    thread.isBot ? "bg-blue-900/60 text-blue-300" : "bg-green-900/60 text-green-300"
                  }`}>
                    {thread.name[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-white text-sm truncate">{thread.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        thread.isBot ? "bg-blue-900/60 text-blue-300" : "bg-green-900/60 text-green-300"
                      }`}>
                        {thread.isBot ? "Bot" : "Player"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{thread.lastMessage || "(no preview)"}</p>
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

          {/* Chat messages */}
          {target && activeTab === "chat" && (
            <div className="p-3 space-y-2">
              {messages.length === 0 && (
                <p className="text-center text-slate-500 text-xs mt-8">Start a conversation with {target.name}</p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.incoming ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-1.5 rounded-xl text-sm ${
                      msg.incoming
                        ? "bg-slate-700 text-slate-100"
                        : "bg-orange-500 text-white"
                    }`}
                  >
                    <p className="break-words">{msg.message}</p>
                    <p className={`text-[10px] mt-0.5 ${msg.incoming ? "text-slate-400" : "text-orange-100"}`}>
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
                <p className="text-xs font-semibold text-slate-400 uppercase">Your balance</p>
                <span className="text-sm font-bold text-amber-400">{coins} coins</span>
              </div>
              {shopItems.length === 0 && (
                <p className="text-center text-slate-500 text-xs mt-8">This bot has no shop items</p>
              )}
              {shopItems.map((shopItem, i) => {
                const canAfford = coins >= shopItem.price;
                return (
                  <div key={i} className="flex items-center justify-between bg-slate-800 rounded-xl p-3 border border-slate-700/50">
                    <div>
                      <p className="font-semibold text-white text-sm">{shopItem.item}</p>
                      <p className="text-xs text-amber-400 font-semibold">{shopItem.price} coins</p>
                    </div>
                    <button
                      onClick={() => buyItem(shopItem.item)}
                      disabled={!canAfford}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        canAfford
                          ? "bg-orange-500 text-white hover:bg-orange-600"
                          : "bg-slate-700 text-slate-500 cursor-not-allowed"
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

        {/* Chat input (only on chat tab with target) */}
        {target && activeTab === "chat" && (
          <div className="p-3 border-t border-slate-700/50 flex-shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-slate-800 border border-slate-600 rounded-full px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
              />
              <button
                onClick={sendMessage}
                className="bg-orange-500 hover:bg-orange-600 text-white rounded-full px-4 py-2 text-sm font-semibold transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default DirectMessagePanel;
