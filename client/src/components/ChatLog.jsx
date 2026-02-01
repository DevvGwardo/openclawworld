import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chatMessagesAtom } from "./SocketManager";

export const ChatLog = () => {
  const [messages] = useAtom(chatMessagesAtom);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0) {
      setVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 8000);
    }
    return () => clearTimeout(hideTimer.current);
  }, [messages.length]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <AnimatePresence>
      {visible && messages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.3 }}
          className="fixed top-10 right-2 bottom-20 w-52 sm:right-4 sm:bottom-24 sm:w-72 z-20 pointer-events-none"
        >
          <div
            ref={scrollRef}
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            className="h-full bg-gray-900/90 rounded-xl p-3 overflow-y-auto pointer-events-auto
              [&::-webkit-scrollbar]:hidden"
            onWheel={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Chat
            </p>
            <div className="flex flex-col gap-1.5">
              {messages.map((msg) => (
                <div key={msg.id} className="text-sm leading-snug">
                  <span className={`font-bold ${msg.isBot ? "text-blue-300" : "text-white"}`}>
                    {msg.senderName}
                    {msg.isBot && (
                      <span className="text-blue-400 ml-1 text-xs font-semibold">[BOT]</span>
                    )}
                  </span>
                  <span className="text-gray-300 ml-1.5">{msg.message}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
