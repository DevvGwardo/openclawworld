import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export const activityEventsAtom = atom([]);

const MAX_VISIBLE = 6;
const EXPIRE_MS = 6000;

const typeConfig = {
  spawn: { icon: "→", color: "text-green-400", label: "joined" },
  despawn: { icon: "←", color: "text-red-400", label: "left" },
  room_enter: { icon: "🚪", color: "text-amber-400", label: "entered" },
  item_placed: { icon: "📦", color: "text-blue-400", label: "placed" },
  building: { icon: "🔨", color: "text-orange-400", label: "" },
  done: { icon: "✅", color: "text-green-400", label: "" },
};

export const ActivityFeed = () => {
  const [events] = useAtom(activityEventsAtom);
  const [visible, setVisible] = useState([]);

  useEffect(() => {
    const now = Date.now();
    const fresh = events
      .filter((e) => now - e.timestamp < EXPIRE_MS)
      .slice(-MAX_VISIBLE);
    setVisible(fresh);
  }, [events]);

  // Tick to expire old events
  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => {
        const now = Date.now();
        return prev.filter((e) => now - e.timestamp < EXPIRE_MS);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (visible.length === 0) return null;

  return (
    <div className="fixed top-14 left-4 z-[5] pointer-events-none w-72">
      <AnimatePresence mode="popLayout">
        {visible.map((event) => {
          const config = typeConfig[event.type] || typeConfig.spawn;
          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="mb-1.5"
            >
              <div className="bg-gray-900/80 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-white/10">
                <span className="text-sm flex-shrink-0">{config.icon}</span>
                <p className="text-xs text-white/90 truncate">
                  <span className="font-semibold text-white">
                    {event.name}
                  </span>
                  {event.isBot && (
                    <span className="text-blue-300 ml-1 text-[10px]">BOT</span>
                  )}
                  <span className={`ml-1 ${config.color}`}>
                    {event.detail || config.label}
                  </span>
                </p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
