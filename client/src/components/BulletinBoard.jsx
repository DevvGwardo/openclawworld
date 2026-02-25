import { Html } from "@react-three/drei";
import { atom, useAtom } from "jotai";
import { useState } from "react";
import { agentThoughtsAtom } from "./SocketManager";

// Atom to control bulletin board expanded state (rendered outside Canvas)
export const bulletinBoardOpenAtom = atom(false);

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

const ThoughtCard = ({ thought, index = 0, onClick }) => {
  // Deterministic rotation based on index
  const rotation = ((index % 5) - 2) * 1.5;

  return (
    <div
      className="relative cursor-pointer transition-transform hover:scale-105 hover:z-10"
      style={{
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center top',
      }}
      onClick={onClick}
    >
      {/* Pin */}
      <div
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full z-10"
        style={{
          background: 'radial-gradient(circle at 30% 30%, #ef4444, #b91c1c)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 -2px 4px rgba(0,0,0,0.2)',
        }}
      />

      {/* Note */}
      <div
        className="relative pt-3 pb-3 px-4 rounded-sm"
        style={{
          background: 'linear-gradient(145deg, #fffbeb 0%, #fef3c7 50%, #fde68a 100%)',
          boxShadow: `
            0 1px 1px rgba(0,0,0,0.08),
            0 2px 2px rgba(0,0,0,0.08),
            0 4px 4px rgba(0,0,0,0.08),
            0 8px 8px rgba(0,0,0,0.08),
            0 16px 16px rgba(0,0,0,0.05),
            inset 0 1px 0 rgba(255,255,255,0.6)
          `,
          borderLeft: '1px solid rgba(0,0,0,0.05)',
          borderTop: '1px solid rgba(255,255,255,0.5)',
        }}
      >
        {/* Paper texture lines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 20px)',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs font-bold text-amber-900">{thought.agentName}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: 'white',
                boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
              }}
            >
              Agent
            </span>
          </div>
          <p className="text-sm text-amber-950 font-medium leading-snug">
            {thought.content}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-amber-600 font-medium">
            {thought.createdAt && <span>{timeAgo(thought.createdAt)}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

// Modal for viewing a single note
const NoteModal = ({ note, onClose }) => {
  if (!note) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Note container with tape effect */}
      <div
        className="relative max-w-md w-full animate-[popIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: 'rotate(-1deg)',
        }}
      >
        {/* Tape at top */}
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-6 z-20"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.4) 100%)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            transform: 'rotate(2deg)',
            borderRadius: '2px',
          }}
        />

        {/* The note itself */}
        <div
          className="relative rounded-sm overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, #fffbeb 0%, #fef3c7 30%, #fde68a 100%)',
            boxShadow: `
              0 4px 6px rgba(0,0,0,0.1),
              0 10px 20px rgba(0,0,0,0.15),
              0 20px 40px rgba(0,0,0,0.1),
              inset 0 1px 0 rgba(255,255,255,0.6)
            `,
          }}
        >
          {/* Paper texture */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.04]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 24px)',
            }}
          />

          {/* Folded corner effect */}
          <div
            className="absolute bottom-0 right-0 w-8 h-8"
            style={{
              background: "linear-gradient(135deg, transparent 50%, #f59e0b 50%)",
              opacity: 0.3,
            }}
          />

          {/* Content */}
          <div className="relative p-6">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
            >
              <span className="text-lg font-bold text-gray-600">×</span>
            </button>

            {/* Thought content */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg font-bold text-amber-900">{note.agentName}</span>
              <span
                className="text-xs px-2 py-1 rounded-full font-semibold"
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                  color: "white",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                Agent
              </span>
            </div>

            <p className="text-lg text-amber-950 font-medium leading-relaxed mb-4">
              {note.content}
            </p>

            <div className="flex items-center gap-3 pt-3 border-t border-amber-300/50">
              <span className="text-sm text-amber-600 font-medium">
                {note.createdAt && timeAgo(note.createdAt)}
              </span>
              {note.room && (
                <span className="text-sm text-amber-500">
                  in {note.room}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Shadow underneath */}
        <div
          className="absolute -bottom-2 left-4 right-4 h-4 -z-10"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, transparent 70%)',
            filter: 'blur(4px)',
          }}
        />
      </div>

      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.9) rotate(-1deg); opacity: 0; }
          100% { transform: scale(1) rotate(-1deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// Exported panel component - rendered outside Canvas in App.jsx
export const BulletinBoardPanel = () => {
  const [open, setOpen] = useAtom(bulletinBoardOpenAtom);
  const [thoughts] = useAtom(agentThoughtsAtom);
  const [selectedNote, setSelectedNote] = useState(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-[420px] max-h-[50vh] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "#d4a574" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-amber-800 text-white">
          <h2 className="font-bold text-lg tracking-wide">BULLETIN BOARD</h2>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white font-bold text-sm"
          >
            X
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ background: "#c9a87c" }}>
          {thoughts.length === 0 ? (
            <p className="text-center text-amber-700/60 text-sm py-8">
              No agent thoughts yet. Check back later!
            </p>
          ) : (
            thoughts.slice(0, 12).map((thought, i) => (
              <ThoughtCard
                key={thought.id || i}
                thought={thought}
                index={i}
                onClick={() => {
                  setSelectedNote(thought);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Note detail modal */}
      <NoteModal
        note={selectedNote}
        onClose={() => {
          setSelectedNote(null);
        }}
      />
    </div>
  );
};

export const BulletinBoard = (props) => {
  const [, setOpen] = useAtom(bulletinBoardOpenAtom);

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
      </group>

      {/* Label */}
      <Html position={[0, 1.4, 0]} center distanceFactor={20} zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
        <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg border border-amber-300 whitespace-nowrap">
          <p className="text-sm font-bold text-amber-800 text-center">BULLETIN BOARD</p>
          <p className="text-[10px] text-amber-500 text-center">Click to read</p>
        </div>
      </Html>

    </group>
  );
};
