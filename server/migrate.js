import fs from "fs";
import { initDb, saveRoom, getRoom } from "./db.js";

const PLAZA_SIZE = [150, 150];
const PLAZA_GRID_DIVISION = 2;
const GENERATED_ROOM_COUNT = 100;

async function migrate() {
  console.log("[migrate] Initializing database...");
  await initDb();

  // Load rooms from JSON
  let rawJson;
  if (fs.existsSync("rooms.json")) {
    rawJson = fs.readFileSync("rooms.json", "utf-8");
    console.log("[migrate] Loaded rooms.json");
  } else if (fs.existsSync("default.json")) {
    rawJson = fs.readFileSync("default.json", "utf-8");
    console.log("[migrate] rooms.json not found, loaded default.json");
  } else {
    console.log("[migrate] No rooms.json or default.json found. Creating empty generated rooms only.");
    rawJson = "[]";
  }

  const rooms = JSON.parse(rawJson);
  console.log(`[migrate] Parsed ${rooms.length} rooms from JSON`);

  const importedIds = new Set();
  let importedCount = 0;

  for (const room of rooms) {
    const isPlaza = room.id === "plaza";
    const isGenerated = room.generated === true;

    const roomData = {
      id: room.id,
      name: room.name || (isPlaza ? "Town Square" : `Room ${room.id}`),
      size: isPlaza ? PLAZA_SIZE : (room.size || [15, 15]),
      gridDivision: room.gridDivision ?? (isPlaza ? PLAZA_GRID_DIVISION : 2),
      items: room.items || [],
      generated: isPlaza ? false : isGenerated,
      claimedBy: room.claimedBy ?? null,
      password: room.password || null,
    };

    await saveRoom(roomData);
    importedIds.add(room.id);
    importedCount++;

    if (importedCount % 10 === 0) {
      console.log(`[migrate] Imported ${importedCount}/${rooms.length} rooms...`);
    }
  }

  console.log(`[migrate] Imported ${importedCount} rooms from JSON`);

  // Ensure room-1 through room-100 exist
  let createdCount = 0;
  for (let i = 1; i <= GENERATED_ROOM_COUNT; i++) {
    const roomId = `room-${i}`;
    if (importedIds.has(roomId)) continue;

    const existing = await getRoom(roomId);
    if (existing) continue;

    await saveRoom({
      id: roomId,
      name: `Room ${i}`,
      size: [15, 15],
      gridDivision: 2,
      items: [],
      generated: true,
      claimedBy: null,
      password: null,
    });
    createdCount++;
  }

  if (createdCount > 0) {
    console.log(`[migrate] Created ${createdCount} empty generated rooms`);
  }

  console.log(`[migrate] Done. Total: ${importedCount} imported + ${createdCount} created.`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
