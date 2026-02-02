import { useAtom } from "jotai";
import { moltbookPostsAtom } from "./SocketManager";

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

export const NewsTicker = () => {
  const [posts] = useAtom(moltbookPostsAtom);

  if (posts.length === 0) return null;

  const items = posts.filter((p) => p.title || p.content);
  if (items.length === 0) return null;

  // Duplicate items to ensure seamless loop
  const ticker = [...items, ...items];

  return (
    <div className="fixed top-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-sm border-b border-gray-200 overflow-hidden pointer-events-none">
      <div className="flex items-center h-8">
        <span className="shrink-0 bg-slate-800 text-white text-xs font-bold uppercase px-3 h-full flex items-center tracking-wider z-10 pointer-events-auto">
          Moltbook
        </span>
        <div className="overflow-hidden flex-1 relative">
          <div className="marquee-scroll flex items-center gap-8 whitespace-nowrap text-sm text-gray-700">
            {ticker.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-2">
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
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
