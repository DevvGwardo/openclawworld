import { useAtom } from "jotai";
import { useRef, useEffect, useCallback, useState } from "react";
import { charactersAtom, mapAtom, userAtom } from "./SocketManager";
import { buildModeAtom, shopModeAtom } from "./UI";

// Building footprints for plaza rooms (duplicated from server/shared/roomConstants.js)
const getBuildingFootprints = (sz) => [
  { x: sz[0] / 2 - 6, z: 0, w: 12, d: 10, label: "Town Hall" },
  { x: 0, z: sz[1] / 2 - 5, w: 8, d: 10, label: "Apartments" },
  { x: sz[0] - 8, z: sz[1] / 2 - 5, w: 8, d: 10, label: "Shop" },
  { x: 7, z: 7, w: 8, d: 8 },
  { x: sz[0] - 15, z: 7, w: 8, d: 8 },
  { x: sz[0] / 2 + 11, z: 1, w: 6, d: 6 },
  { x: 0, z: 0, w: 5, d: 5 },
  { x: sz[0] - 5, z: 0, w: 5, d: 5 },
  { x: 0, z: sz[1] - 5, w: 5, d: 5 },
  { x: sz[0] - 5, z: sz[1] - 5, w: 5, d: 5 },
];

const MINIMAP_SIZE = 160;
const PADDING = 8;
const DOT_RADIUS_SELF = 4;
const DOT_RADIUS_OTHER = 2.5;
const DOT_RADIUS_BOT = 2;

export const Minimap = () => {
  const canvasRef = useRef(null);
  const [characters] = useAtom(charactersAtom);
  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const [buildMode] = useAtom(buildModeAtom);
  const [shopMode] = useAtom(shopModeAtom);
  const [collapsed, setCollapsed] = useState(false);

  // Cache refs so the animation loop doesn't depend on atom re-renders
  const dataRef = useRef({ characters: [], map: null, user: null });
  useEffect(() => {
    dataRef.current.characters = characters;
  }, [characters]);
  useEffect(() => {
    dataRef.current.map = map;
  }, [map]);
  useEffect(() => {
    dataRef.current.user = user;
  }, [user]);

  // Size the canvas once on mount and when DPR changes (e.g. moving between displays)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_SIZE * dpr;
    canvas.height = MINIMAP_SIZE * dpr;
    dprRef.current = dpr;
  }, [collapsed]); // re-run after un-collapsing so the canvas element is fresh

  const dprRef = useRef(window.devicePixelRatio || 1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { characters, map, user } = dataRef.current;

    // Handle DPR changes (e.g. dragging window between monitors)
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== dprRef.current) {
      canvas.width = MINIMAP_SIZE * dpr;
      canvas.height = MINIMAP_SIZE * dpr;
      dprRef.current = dpr;
    }

    if (!map || !map.size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const w = MINIMAP_SIZE;
    const h = MINIMAP_SIZE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mapW = map.size[0];
    const mapH = map.size[1];
    const isPlaza = mapW > 30;

    // Scale factor: map world coords -> minimap pixels (with padding)
    const drawW = w - PADDING * 2;
    const drawH = h - PADDING * 2;
    const scale = Math.min(drawW / mapW, drawH / mapH);
    const offsetX = PADDING + (drawW - mapW * scale) / 2;
    const offsetY = PADDING + (drawH - mapH * scale) / 2;

    const toScreen = (wx, wz) => [
      offsetX + wx * scale,
      offsetY + wz * scale,
    ];

    // Background
    ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();

    // Room boundary
    const [rx, ry] = toScreen(0, 0);
    const rw = mapW * scale;
    const rh = mapH * scale;
    ctx.strokeStyle = "rgba(100, 140, 200, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);

    // Ground fill
    ctx.fillStyle = "rgba(40, 60, 40, 0.3)";
    ctx.fillRect(rx, ry, rw, rh);

    // Building footprints (plaza rooms only)
    if (isPlaza) {
      const footprints = getBuildingFootprints(map.size);
      footprints.forEach((fp) => {
        const [bx, by] = toScreen(fp.x, fp.z);
        const bw = fp.w * scale;
        const bh = fp.d * scale;
        ctx.fillStyle = "rgba(80, 90, 110, 0.6)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "rgba(120, 140, 170, 0.5)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Label for named buildings
        if (fp.label && scale > 1.5) {
          ctx.fillStyle = "rgba(180, 195, 220, 0.7)";
          ctx.font = "6px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(fp.label, bx + bw / 2, by + bh / 2 + 2);
        }
      });
    }

    // Items (furniture) — small subtle dots
    if (map.items && map.items.length > 0) {
      const gd = map.gridDivision || 1;
      ctx.fillStyle = "rgba(100, 100, 80, 0.35)";
      map.items.forEach((item) => {
        if (!item.gridPosition) return;
        const wx = item.gridPosition[0] / gd;
        const wz = item.gridPosition[1] / gd;
        const [sx, sy] = toScreen(wx, wz);
        ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1);
      });
    }

    // Characters
    if (!characters || characters.length === 0) return;

    const gd = map.gridDivision || 1;

    // Draw others first, then self on top
    const self = characters.find((c) => c.id === user);
    const others = characters.filter((c) => c.id !== user);

    // Other characters
    others.forEach((c) => {
      if (!c.position) return;
      const wx = c.position[0] / gd;
      const wz = c.position[1] / gd;
      const [sx, sy] = toScreen(wx, wz);
      const r = c.isBot ? DOT_RADIUS_BOT : DOT_RADIUS_OTHER;
      const color = c.isBot ? "rgba(255, 120, 80, 0.8)" : "rgba(60, 160, 255, 0.9)";

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // Self (with glow)
    if (self && self.position) {
      const wx = self.position[0] / gd;
      const wz = self.position[1] / gd;
      const [sx, sy] = toScreen(wx, wz);

      // Glow
      ctx.beginPath();
      ctx.arc(sx, sy, DOT_RADIUS_SELF + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(80, 255, 120, 0.15)";
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(sx, sy, DOT_RADIUS_SELF, 0, Math.PI * 2);
      ctx.fillStyle = "#50ff78";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, []);

  // Redraw when atom data changes (or when un-collapsed)
  useEffect(() => {
    if (collapsed) return;
    // Use rAF to batch with the browser paint cycle
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [characters, map, user, collapsed, draw]);

  // Hide during build/shop modes
  if (buildMode || shopMode) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-[15] w-8 h-8 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white/60 hover:text-white/90 hover:bg-black/80 transition-all flex items-center justify-center text-xs"
        title="Show minimap"
      >
        M
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-[15] select-none"
      style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: MINIMAP_SIZE,
          height: MINIMAP_SIZE,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        }}
      />
      {/* Collapse button */}
      <button
        onClick={() => setCollapsed(true)}
        className="absolute top-1 right-1 w-5 h-5 rounded bg-black/40 hover:bg-black/70 text-white/40 hover:text-white/80 transition-all flex items-center justify-center text-[9px] leading-none"
        title="Hide minimap"
      >
        ✕
      </button>
      {/* Legend */}
      <div className="absolute bottom-1 left-2 right-2 flex gap-3 text-[8px] text-white/40 leading-none pointer-events-none">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#50ff78]" />
          You
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3ca0ff]" />
          Players
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff7850]" />
          Bots
        </span>
      </div>
    </div>
  );
};
