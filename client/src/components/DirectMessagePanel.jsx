import { atom, useAtom } from "jotai";
import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { socket, directMessagesAtom, coinsAtom, activeQuestsAtom } from "./SocketManager";
import soundManager from "../audio/SoundManager";

// Which bot's DM panel is open (null = closed)
export const dmPanelTargetAtom = atom(null);

const DirectMessagePanel = () => {
  const [target, setTarget] = useAtom(dmPanelTargetAtom);
  const [directMessages] = useAtom(directMessagesAtom);
  const [coins] = useAtom(coinsAtom);
  const [activeQuests] = useAtom(activeQuestsAtom);
  const [activeTab, setActiveTab] = useState("chat");
  const [message, setMessage] = useState("");
  const [availableQuests, setAvailableQuests] = useState([]);
  const [shopItems, setShopItems] = useState([]);
  const messagesEndRef = useRef(null);

  const messages = target ? (directMessages[target.id] || []) : [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Fetch quests when quests tab is opened
  useEffect(() => {
    if (!target || activeTab !== "quests") return;
    socket.emit("getQuests", target.id);
    const handler = (data) => {
      if (data.botId === target.id) setAvailableQuests(data.quests || []);
    };
    socket.on("questsAvailable", handler);
    return () => socket.off("questsAvailable", handler);
  }, [target?.id, activeTab]);

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

  const sendMessage = () => {
    if (!message.trim() || !target) return;
    socket.emit("directMessage", { targetId: target.id, message: message.trim() });
    setMessage("");
    soundManager.play("chat_send");
  };

  const acceptQuest = (questId) => {
    if (!target) return;
    socket.emit("acceptQuest", { botId: target.id, questId });
    soundManager.play("quest_accept");
  };

  const buyItem = (itemName) => {
    if (!target) return;
    socket.emit("buyFromBot", { botId: target.id, itemName });
  };

  if (!target) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="dm-panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-80 sm:w-96 z-30 flex flex-col bg-white/95 backdrop-blur-md border-l border-gray-200 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
            {(target.name || "B")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{target.name}</p>
            <p className="text-xs text-blue-500">Bot</p>
          </div>
          <button
            onClick={() => { soundManager.play("menu_close"); setTarget(null); }}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {["chat", "quests", "shop"].map((tab) => (
            <button
              key={tab}
              onClick={() => { soundManager.play("tab_switch"); setActiveTab(tab); }}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeTab === tab
                  ? "text-slate-800 border-b-2 border-slate-800"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Chat Tab */}
          {activeTab === "chat" && (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.length === 0 && (
                  <p className="text-center text-gray-400 text-xs mt-8">Start a conversation with {target.name}</p>
                )}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.incoming ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                        msg.incoming
                          ? "bg-gray-100 text-gray-800"
                          : "bg-slate-800 text-white"
                      }`}
                    >
                      <p className="break-words">{msg.message}</p>
                      <p className={`text-[10px] mt-1 ${msg.incoming ? "text-gray-400" : "text-gray-300"}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Quests Tab */}
          {activeTab === "quests" && (
            <div className="p-3 space-y-3">
              {availableQuests.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-8">This bot has no quests available</p>
              )}
              {availableQuests.map((quest) => {
                const isActive = activeQuests.some(q => q.id === quest.id);
                return (
                  <div key={quest.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <p className="font-semibold text-gray-900 text-sm">{quest.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{quest.description}</p>
                    {quest.required_items?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase">Required items:</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {quest.required_items.map((item, i) => (
                            <span key={i} className="text-xs bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-600">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-semibold text-amber-600">+{quest.reward_coins} coins</span>
                      <button
                        onClick={() => acceptQuest(quest.id)}
                        disabled={isActive}
                        className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${
                          isActive
                            ? "bg-green-100 text-green-600 cursor-default"
                            : "bg-slate-800 text-white hover:bg-slate-900"
                        }`}
                      >
                        {isActive ? "Active" : "Accept"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Shop Tab */}
          {activeTab === "shop" && (
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
        {activeTab === "chat" && (
          <div className="p-3 border-t border-gray-100">
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
    </AnimatePresence>
  );
};

export default DirectMessagePanel;
