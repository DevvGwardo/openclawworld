import { useAtom } from "jotai";
import { useRef, useEffect, useCallback, useState } from "react";
import { charactersAtom, mapAtom, userAtom, socket, selfLivePosition } from "./SocketManager";
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

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 150;
const PADDING = 8;
const DOT_RADIUS_SELF = 4;
const DOT_RADIUS_OTHER = 2.5;
const DOT_RADIUS_BOT = 2;
const HIT_RADIUS = 8; // px radius for hover hit-testing
const DEST_MARKER_SIZE = 4; // half-size of the destination X marker

export const Minimap = () => {
  const canvasRef = useRef(null);
  const [characters] = useAtom(charactersAtom);
  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const [buildMode] = useAtom(buildModeAtom);
  const [shopMode] = useAtom(shopModeAtom);
  const [collapsed, setCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState(null); // { name, isBot, x, y }

  // Destination marker: grid coords of where the player clicked to move
  const destinationRef = useRef(null); // [gridX, gridY] or null

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

  // Pulse animation for self dot
  const pulseRef = useRef(0);

  // Mapping helpers stored in ref so click/hover handlers can use them
  const mappingRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, mapW: 0, mapH: 0 });

  // Size the canvas once on mount and when DPR changes (e.g. moving between displays)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
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
      canvas.width = MINIMAP_WIDTH * dpr;
      canvas.height = MINIMAP_HEIGHT * dpr;
      dprRef.current = dpr;
    }

    if (!map || !map.size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const w = MINIMAP_WIDTH;
    const h = MINIMAP_HEIGHT;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mapW = map.size[0];
    const mapH = map.size[1];
    const isPlaza = mapW > 30;
    const gd = map.gridDivision || 1;

    // Scale factor: map world coords -> minimap pixels (with padding)
    const drawW = w - PADDING * 2;
    const drawH = h - PADDING * 2;
    const scale = Math.min(drawW / mapW, drawH / mapH);
    const offsetX = PADDING + (drawW - mapW * scale) / 2;
    const offsetY = PADDING + (drawH - mapH * scale) / 2;

    // Store mapping for click/hover handlers
    mappingRef.current = { scale, offsetX, offsetY, mapW, mapH };

    const toScreen = (wx, wz) => [
      offsetX + wx * scale,
      offsetY + wz * scale,
    ];

    // Background — match site theme (white/slate)
    ctx.fillStyle = "rgba(248, 250, 252, 0.95)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 10);
    ctx.fill();

    // Room boundary
    const [rx, ry] = toScreen(0, 0);
    const rw = mapW * scale;
    const rh = mapH * scale;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);

    // Ground fill
    ctx.fillStyle = "rgba(226, 232, 240, 0.6)";
    ctx.fillRect(rx, ry, rw, rh);

    // Building footprints (plaza rooms only)
    if (isPlaza) {
      const footprints = getBuildingFootprints(map.size);
      footprints.forEach((fp) => {
        const [bx, by] = toScreen(fp.x, fp.z);
        const bw = fp.w * scale;
        const bh = fp.d * scale;
        ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "rgba(100, 116, 139, 0.4)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Label for named buildings
        if (fp.label && scale > 1.5) {
          ctx.fillStyle = "rgba(71, 85, 105, 0.7)";
          ctx.font = "6px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(fp.label, bx + bw / 2, by + bh / 2 + 2);
        }
      });
    }

    // Items (furniture) — small subtle dots
    if (map.items && map.items.length > 0) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
      map.items.forEach((item) => {
        if (!item.gridPosition) return;
        const wx = item.gridPosition[0] / gd;
        const wz = item.gridPosition[1] / gd;
        const [sx, sy] = toScreen(wx, wz);
        ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1);
      });
    }

    // --- Destination marker (X where the player clicked) ---
    const dest = destinationRef.current;
    if (dest) {
      const dwx = dest[0] / gd;
      const dwz = dest[1] / gd;
      const [dx, dy] = toScreen(dwx, dwz);

      // Pulsing ring around destination
      const destPulse = (Math.sin(pulseRef.current * 1.5) + 1) / 2;
      const destRingRadius = DEST_MARKER_SIZE + 2 + destPulse * 3;
      ctx.beginPath();
      ctx.arc(dx, dy, destRingRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(99, 102, 241, ${0.3 - destPulse * 0.2})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // X marker
      ctx.strokeStyle = "rgba(99, 102, 241, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx - DEST_MARKER_SIZE, dy - DEST_MARKER_SIZE);
      ctx.lineTo(dx + DEST_MARKER_SIZE, dy + DEST_MARKER_SIZE);
      ctx.moveTo(dx + DEST_MARKER_SIZE, dy - DEST_MARKER_SIZE);
      ctx.lineTo(dx - DEST_MARKER_SIZE, dy + DEST_MARKER_SIZE);
      ctx.stroke();

      // Small filled dot at center
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(99, 102, 241, 0.9)";
      ctx.fill();
    }

    // Characters
    if (!characters || characters.length === 0) return;

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
      const color = c.isBot ? "rgba(251, 146, 60, 0.85)" : "rgba(56, 139, 253, 0.9)";

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // Self — use live interpolated position from Avatar, fall back to atom position
    const livePos = selfLivePosition.current;
    const selfPos = livePos || (self && self.position);
    if (selfPos) {
      const wx = selfPos[0] / gd;
      const wz = selfPos[1] / gd;
      const [sx, sy] = toScreen(wx, wz);

      // Animated pulse ring
      const pulse = (Math.sin(pulseRef.current) + 1) / 2; // 0..1
      const pulseRadius = DOT_RADIUS_SELF + 3 + pulse * 4;
      const pulseAlpha = 0.25 - pulse * 0.2;
      ctx.beginPath();
      ctx.arc(sx, sy, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 197, 94, ${pulseAlpha})`;
      ctx.fill();

      // Static glow
      ctx.beginPath();
      ctx.arc(sx, sy, DOT_RADIUS_SELF + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(34, 197, 94, 0.2)";
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(sx, sy, DOT_RADIUS_SELF, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Clear destination marker when player arrives close to it
      if (dest) {
        const ddx = selfPos[0] - dest[0];
        const ddz = selfPos[1] - dest[1];
        const arrivalDist = Math.sqrt(ddx * ddx + ddz * ddz);
        if (arrivalDist < gd * 2) {
          destinationRef.current = null;
        }
      }
    }
  }, []);

  // Continuous animation loop for pulse effect
  useEffect(() => {
    if (collapsed) return;
    let running = true;
    const animate = () => {
      if (!running) return;
      pulseRef.current += 0.06;
      draw();
      requestAnimationFrame(animate);
    };
    const id = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(id);
    };
  }, [collapsed, draw]);

  // Redraw when atom data changes
  useEffect(() => {
    if (collapsed) return;
    draw();
  }, [characters, map, user, collapsed, draw]);

  // Convert canvas pixel coords to world coords
  const canvasToWorld = useCallback((canvasX, canvasY) => {
    const { scale, offsetX, offsetY } = mappingRef.current;
    if (scale === 0) return null;
    const wx = (canvasX - offsetX) / scale;
    const wz = (canvasY - offsetY) / scale;
    return { wx, wz };
  }, []);

  // Get canvas-relative mouse position
  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * MINIMAP_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT,
    };
  }, []);

  // Click-to-move handler
  const handleCanvasClick = useCallback((e) => {
    if (e.button !== 0) return; // left click only
    const pos = getCanvasPos(e);
    if (!pos) return;

    const world = canvasToWorld(pos.x, pos.y);
    if (!world) return;

    const { characters, map, user } = dataRef.current;
    if (!map || !user) return;

    const gd = map.gridDivision || 1;
    const { mapW, mapH } = mappingRef.current;

    // Clamp to map bounds
    const clampedX = Math.max(0, Math.min(world.wx, mapW));
    const clampedZ = Math.max(0, Math.min(world.wz, mapH));

    // Convert to grid coordinates
    const targetGrid = [
      Math.floor(clampedX * gd),
      Math.floor(clampedZ * gd),
    ];

    // Get current position — prefer live position from Avatar
    const livePos = selfLivePosition.current;
    const self = characters.find((c) => c.id === user);
    const fromGrid = livePos || (self && self.position);
    if (!fromGrid) return;

    // Store destination for the marker
    destinationRef.current = targetGrid;

    socket.emit("move", [fromGrid[0], fromGrid[1]], targetGrid);
  }, [canvasToWorld, getCanvasPos]);

  // Hover handler for tooltips
  const handleCanvasMove = useCallback((e) => {
    const pos = getCanvasPos(e);
    if (!pos) return;

    const { characters, map, user } = dataRef.current;
    if (!characters || !map) {
      setTooltip(null);
      return;
    }

    const gd = map.gridDivision || 1;
    const { scale, offsetX, offsetY } = mappingRef.current;

    // Hit-test against all characters
    let closest = null;
    let closestDist = HIT_RADIUS;

    characters.forEach((c) => {
      if (!c.position) return;
      // For self, use live position
      const position = (c.id === user && selfLivePosition.current)
        ? selfLivePosition.current
        : c.position;
      const wx = position[0] / gd;
      const wz = position[1] / gd;
      const sx = offsetX + wx * scale;
      const sy = offsetY + wz * scale;
      const dx = pos.x - sx;
      const dy = pos.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = c;
      }
    });

    if (closest) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      setTooltip({
        name: closest.name || closest.id?.slice(0, 8),
        isBot: closest.isBot,
        isSelf: closest.id === user,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    } else {
      setTooltip(null);
    }
  }, [getCanvasPos]);

  const handleCanvasLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  // Hide during build/shop modes
  if (buildMode || shopMode) return null;

  // Counts for header
  const playerCount = characters.filter((c) => !c.isBot && c.id !== user).length;
  const botCount = characters.filter((c) => c.isBot).length;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed top-2 left-3 z-[15] w-8 h-8 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-white transition-all flex items-center justify-center text-xs shadow-sm"
        title="Show minimap"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="fixed top-2 left-3 z-[15] select-none"
      style={{ width: MINIMAP_WIDTH }}
    >
      <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Map</span>
            <span className="text-[9px] text-slate-400">
              {playerCount + botCount + 1}
            </span>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="w-4 h-4 rounded text-gray-300 hover:text-gray-500 transition-colors flex items-center justify-center text-[9px] leading-none"
            title="Hide minimap"
          >
            ✕
          </button>
        </div>
        {/* Canvas */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseLeave={handleCanvasLeave}
            style={{
              width: MINIMAP_WIDTH,
              height: MINIMAP_HEIGHT,
              display: "block",
              cursor: "crosshair",
            }}
          />
          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute pointer-events-none px-1.5 py-0.5 rounded bg-gray-800/90 text-white text-[9px] whitespace-nowrap shadow-sm"
              style={{
                left: Math.min(tooltip.x + 10, MINIMAP_WIDTH - 60),
                top: Math.max(tooltip.y - 20, 0),
              }}
            >
              {tooltip.name}
              {tooltip.isBot && <span className="ml-1 text-blue-300">BOT</span>}
              {tooltip.isSelf && <span className="ml-1 text-green-300">You</span>}
            </div>
          )}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-3 px-2 py-1.5 border-t border-gray-100">
          <span className="flex items-center gap-1 text-[9px] text-slate-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
            You
          </span>
          <span className="flex items-center gap-1 text-[9px] text-slate-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
            Players
          </span>
          <span className="flex items-center gap-1 text-[9px] text-slate-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
            Bots
          </span>
        </div>
      </div>
    </div>
  );
};
