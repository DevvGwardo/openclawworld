import { useAtom } from "jotai";
import { moltbookPostsAtom } from "./SocketManager";

export const NewsTicker = () => {
  const [posts] = useAtom(moltbookPostsAtom);

  if (posts.length === 0) return null;

  const items = posts.map((p) => p.title || p.content).filter(Boolean);
  if (items.length === 0) return null;

  // Duplicate items to ensure seamless loop
  const ticker = [...items, ...items];

  return (
    <div className="fixed top-0 left-0 right-0 z-30 bg-gray-900/90 border-b border-gray-700/50 overflow-hidden pointer-events-none">
      <div className="flex items-center h-8">
        <span className="shrink-0 bg-blue-600 text-white text-xs font-bold uppercase px-3 h-full flex items-center tracking-wider z-10 pointer-events-auto">
          Moltbook
        </span>
        <div className="overflow-hidden flex-1 relative">
          <div className="marquee-scroll flex items-center gap-8 whitespace-nowrap text-sm text-gray-200">
            {ticker.map((text, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                <span className="text-blue-400">&#9679;</span>
                <span>{text}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
