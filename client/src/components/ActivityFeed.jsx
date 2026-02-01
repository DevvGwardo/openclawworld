import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export const activityEventsAtom = atom([]);

const MAX_VISIBLE = 6;
const EXPIRE_MS = 6000;

const typeConfig = {
  spawn: { icon: "→", color: "text-green-600", label: "joined" },
  despawn: { icon: "←", color: "text-red-500", label: "left" },
  room_enter: { icon: "🚪", color: "text-amber-600", label: "entered" },
  item_placed: { icon: "📦", color: "text-blue-600", label: "placed" },
  building: { icon: "🔨", color: "text-orange-600", label: "" },
  done: { icon: "✅", color: "text-green-600", label: "" },
  wave_at: { icon: "👋", color: "text-yellow-600", label: "waved" },
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
    <div className="fixed top-14 left-2 sm:left-4 z-[5] pointer-events-none w-48 sm:w-72">
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
              <div className="bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-gray-200 shadow-sm">
                <span className="text-sm flex-shrink-0">{config.icon}</span>
                <p className="text-xs text-gray-700 truncate">
                  <span className="font-semibold text-gray-900">
                    {event.name}
                  </span>
                  {event.isBot && (
                    <span className="text-blue-500 ml-1 text-[10px]">BOT</span>
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
