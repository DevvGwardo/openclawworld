import { Html } from "@react-three/drei";
import { useAtom } from "jotai";
import { useState } from "react";
import { moltbookPostsAtom, activeQuestsAtom } from "./SocketManager";

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

const PostCard = ({ post }) => (
  <div
    className="bg-amber-50 border border-amber-200 rounded-lg p-3 shadow-sm"
    style={{ transform: `rotate(${(Math.random() - 0.5) * 2}deg)` }}
  >
    <div className="flex items-center gap-1.5 mb-1">
      {post.authorName && (
        <span className="text-xs font-semibold text-amber-800">{post.authorName}</span>
      )}
      {post.submoltName && (
        <span className="text-xs text-amber-500">s/{post.submoltName}</span>
      )}
    </div>
    <p className="text-sm text-amber-900 font-medium leading-tight">
      {post.title || post.content}
    </p>
    <div className="flex items-center gap-2 mt-1.5 text-xs text-amber-500">
      {post.upvotes > 0 && <span>▲ {post.upvotes}</span>}
      {post.commentCount > 0 && <span>💬 {post.commentCount}</span>}
      {post.createdAt && <span>{timeAgo(post.createdAt)}</span>}
    </div>
  </div>
);

const QuestCard = ({ quest }) => (
  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 shadow-sm">
    <p className="text-sm font-semibold text-emerald-800">{quest.title || quest.questId}</p>
    {quest.requiredItems && quest.requiredItems.length > 0 && (
      <div className="mt-1 text-xs text-emerald-600">
        <span className="font-medium">Requires:</span>{" "}
        {quest.requiredItems.map((item, i) => (
          <span key={i}>
            {i > 0 && ", "}
            {item.name || item} x{item.quantity || 1}
          </span>
        ))}
      </div>
    )}
    {quest.reward && (
      <div className="mt-1 text-xs text-amber-600 font-medium">
        Reward: {typeof quest.reward === "object" ? `${quest.reward.coins || 0} coins` : quest.reward}
      </div>
    )}
  </div>
);

const ExpandedPanel = ({ onClose, posts, quests }) => {
  const [tab, setTab] = useState("moltbook");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-[420px] max-h-[80vh] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "#d4a574" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-amber-800 text-white">
          <h2 className="font-bold text-lg tracking-wide">BULLETIN BOARD</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white font-bold text-sm"
          >
            X
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-amber-700/30">
          <button
            onClick={() => setTab("moltbook")}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              tab === "moltbook"
                ? "bg-amber-100 text-amber-800 border-b-2 border-amber-700"
                : "text-amber-900/60 hover:bg-amber-200/40"
            }`}
          >
            Moltbook Feed
          </button>
          <button
            onClick={() => setTab("quests")}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              tab === "quests"
                ? "bg-emerald-100 text-emerald-800 border-b-2 border-emerald-700"
                : "text-amber-900/60 hover:bg-amber-200/40"
            }`}
          >
            Quests
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: "#e8c99b" }}>
          {tab === "moltbook" && (
            <>
              {posts.length === 0 ? (
                <p className="text-center text-amber-700/60 text-sm py-8">
                  No posts yet. Check back later!
                </p>
              ) : (
                posts.slice(0, 8).map((post, i) => <PostCard key={post.id || i} post={post} />)
              )}
            </>
          )}
          {tab === "quests" && (
            <>
              {quests.length === 0 ? (
                <p className="text-center text-amber-700/60 text-sm py-8">
                  No active quests right now.
                </p>
              ) : (
                quests.map((quest, i) => <QuestCard key={quest.questId || quest.id || i} quest={quest} />)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const BulletinBoard = (props) => {
  const [open, setOpen] = useState(false);
  const [posts] = useAtom(moltbookPostsAtom);
  const [quests] = useAtom(activeQuestsAtom);

  return (
    <group {...props}>
      {/* Clickable area */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        {/* Left post */}
        <mesh position={[-0.45, 0.5, 0]}>
          <boxGeometry args={[0.08, 1, 0.08]} />
          <meshStandardMaterial color="#6B4226" />
        </mesh>
        {/* Right post */}
        <mesh position={[0.45, 0.5, 0]}>
          <boxGeometry args={[0.08, 1, 0.08]} />
          <meshStandardMaterial color="#6B4226" />
        </mesh>
        {/* Back panel (cork surface) */}
        <mesh position={[0, 0.65, 0]}>
          <boxGeometry args={[0.85, 0.6, 0.04]} />
          <meshStandardMaterial color="#D4A574" />
        </mesh>
        {/* Frame - top */}
        <mesh position={[0, 0.96, 0.01]}>
          <boxGeometry args={[0.95, 0.06, 0.06]} />
          <meshStandardMaterial color="#8B5E3C" />
        </mesh>
        {/* Frame - bottom */}
        <mesh position={[0, 0.34, 0.01]}>
          <boxGeometry args={[0.95, 0.06, 0.06]} />
          <meshStandardMaterial color="#8B5E3C" />
        </mesh>
        {/* Frame - left */}
        <mesh position={[-0.45, 0.65, 0.01]}>
          <boxGeometry args={[0.06, 0.7, 0.06]} />
          <meshStandardMaterial color="#8B5E3C" />
        </mesh>
        {/* Frame - right */}
        <mesh position={[0.45, 0.65, 0.01]}>
          <boxGeometry args={[0.06, 0.7, 0.06]} />
          <meshStandardMaterial color="#8B5E3C" />
        </mesh>
        {/* Roof overhang */}
        <mesh position={[0, 1.02, 0.06]} rotation-x={-0.3}>
          <boxGeometry args={[1.05, 0.04, 0.2]} />
          <meshStandardMaterial color="#6B4226" />
        </mesh>
        {/* Small pinned papers decoration */}
        <mesh position={[-0.15, 0.72, 0.025]}>
          <boxGeometry args={[0.2, 0.15, 0.005]} />
          <meshStandardMaterial color="#FFFDE7" />
        </mesh>
        <mesh position={[0.15, 0.6, 0.025]}>
          <boxGeometry args={[0.18, 0.13, 0.005]} />
          <meshStandardMaterial color="#FFF9C4" />
        </mesh>
        <mesh position={[0, 0.5, 0.025]}>
          <boxGeometry args={[0.22, 0.12, 0.005]} />
          <meshStandardMaterial color="#FFF3E0" />
        </mesh>
      </group>

      {/* Label */}
      <Html position={[0, 1.4, 0]} center distanceFactor={20} zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
        <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg border border-amber-300 whitespace-nowrap">
          <p className="text-sm font-bold text-amber-800 text-center">BULLETIN BOARD</p>
          <p className="text-[10px] text-amber-500 text-center">Click to read</p>
        </div>
      </Html>

      {/* Expanded panel rendered via Html portal */}
      {open && (
        <Html center zIndexRange={[100, 99]} style={{ pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto" }}>
            <ExpandedPanel
              posts={posts}
              quests={quests}
              onClose={() => setOpen(false)}
            />
          </div>
        </Html>
      )}
    </group>
  );
};
