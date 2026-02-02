import { useAtom } from "jotai";
import { useRef, useState, useEffect } from "react";
import { moltbookPostsAtom } from "./SocketManager";

const PIXELS_PER_SECOND = 450;

const timeAgo = (dateStr) => {
  if (!dateStr) return "";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const TickerItem = ({ p }) => (
  <span className="inline-flex items-center gap-2">
    <span className="text-slate-400">&#9679;</span>
    {p.authorName && (
      <span className="font-medium text-slate-600">{p.authorName}</span>
    )}
    {p.submoltName && (
      <span className="text-slate-400">
        {p.authorName ? " in " : ""}s/{p.submoltName}
      </span>
    )}
    {(p.authorName || p.submoltName) && (
      <span className="text-slate-300">—</span>
    )}
    <span>{p.title || p.content}</span>
    {(p.upvotes > 0 || p.commentCount > 0) && (
      <span className="text-xs text-slate-400">
        {p.upvotes > 0 && `▲${p.upvotes}`}
        {p.commentCount > 0 && ` 💬${p.commentCount}`}
      </span>
    )}
    {p.createdAt && (
      <span className="text-xs text-slate-300">{timeAgo(p.createdAt)}</span>
    )}
  </span>
);

export const NewsTicker = () => {
  const [posts] = useAtom(moltbookPostsAtom);
  const trackRef = useRef(null);
  const offsetRef = useRef(0);
  const prevTimeRef = useRef(null);
  const rafRef = useRef(null);
  const halfWidthRef = useRef(0);
  const pendingRef = useRef(null);
  const [displayedItems, setDisplayedItems] = useState([]);

  // Buffer new posts — they get picked up at the next loop seam
  useEffect(() => {
    const items = posts.filter((p) => p.title || p.content);
    if (items.length === 0) return;

    if (displayedItems.length === 0) {
      setDisplayedItems(items);
    } else {
      pendingRef.current = items;
    }
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measure half-width whenever displayed items change
  useEffect(() => {
    if (!trackRef.current) return;
    requestAnimationFrame(() => {
      if (trackRef.current) {
        halfWidthRef.current = trackRef.current.scrollWidth / 2;
      }
    });
  }, [displayedItems]);

  // rAF scroll loop
  useEffect(() => {
    if (displayedItems.length === 0) return;

    const tick = (now) => {
      if (prevTimeRef.current === null) {
        prevTimeRef.current = now;
      }
      const dt = (now - prevTimeRef.current) / 1000;
      prevTimeRef.current = now;

      offsetRef.current += dt * PIXELS_PER_SECOND;

      const half = halfWidthRef.current;
      if (half > 0 && offsetRef.current >= half) {
        offsetRef.current -= half;

        // Swap in pending items at the seamless loop point
        if (pendingRef.current) {
          setDisplayedItems(pendingRef.current);
          pendingRef.current = null;
        }
      }

      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      prevTimeRef.current = null;
    };
  }, [displayedItems]);

  if (displayedItems.length === 0) return null;

  const ticker = [...displayedItems, ...displayedItems];

  return (
    <div className="fixed top-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-sm border-b border-gray-200 overflow-hidden pointer-events-none">
      <div className="flex items-center h-8">
        <span className="shrink-0 bg-slate-800 text-white text-xs font-bold uppercase px-3 h-full flex items-center tracking-wider z-10 pointer-events-auto">
          Moltbook
        </span>
        <div className="overflow-hidden flex-1 relative">
          <div
            ref={trackRef}
            className="flex items-center gap-8 whitespace-nowrap text-sm text-gray-700"
            style={{ willChange: "transform" }}
          >
            {ticker.map((p, i) => (
              <TickerItem key={i} p={p} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
