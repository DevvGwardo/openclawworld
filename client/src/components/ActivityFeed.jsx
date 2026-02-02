import { atom, useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export const activityEventsAtom = atom([]);

const MAX_VISIBLE = 6;
const EXPIRE_MS = 6000;

const typeConfig = {
  spawn: { color: "text-green-600", label: "joined" },
  despawn: { color: "text-red-500", label: "left" },
  room_enter: { color: "text-amber-600", label: "entered" },
  item_placed: { color: "text-blue-600", label: "placed" },
  building: { color: "text-orange-600", label: "" },
  done: { color: "text-green-600", label: "" },
  wave_at: { color: "text-yellow-600", label: "waved" },
  quest_completed: { color: "text-amber-600", label: "" },
  purchase: { color: "text-indigo-600", label: "" },
  build_started: { color: "text-orange-600", label: "" },
};

const MarqueeText = ({ children, className }) => {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let startTime = null;
    const PAUSE = 1000; // ms pause at each end
    const SPEED = 80; // px per second

    const tick = (now) => {
      const overflow = inner.scrollWidth - outer.clientWidth;
      if (overflow <= 2) {
        inner.style.transform = "";
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (startTime === null) startTime = now;
      const travelTime = (overflow / SPEED) * 1000;
      const cycleTime = travelTime + PAUSE * 2;
      const elapsed = (now - startTime) % cycleTime;

      let offset = 0;
      if (elapsed < PAUSE) {
        offset = 0;
      } else if (elapsed < PAUSE + travelTime) {
        offset = ((elapsed - PAUSE) / travelTime) * overflow;
      } else {
        offset = overflow;
      }

      inner.style.transform = `translate3d(${-offset}px, 0, 0)`;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [children]);

  return (
    <div ref={outerRef} className={`overflow-hidden ${className || ""}`}>
      <span
        ref={innerRef}
        className="inline-block whitespace-nowrap"
        style={{ willChange: "transform" }}
      >
        {children}
      </span>
    </div>
  );
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
              <div className="bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-gray-200 shadow-sm min-w-0">
                <span className="text-sm flex-shrink-0">🦀</span>
                <MarqueeText className="flex-1 min-w-0 text-xs text-gray-700">
                  <span className="font-semibold text-gray-900">
                    {event.name}
                  </span>
                  {event.isBot && (
                    <span className="text-blue-500 ml-1 text-[10px]">BOT</span>
                  )}
                  <span className={`ml-1 ${config.color}`}>
                    {event.detail || config.label}
                  </span>
                </MarqueeText>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
