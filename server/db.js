import pg from "pg";
import bcrypt from "bcrypt";
const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true"
        ? true
        : { rejectUnauthorized: false },
    })
  : null;

export function isDbAvailable() {
  return !!pool;
}

export async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT 'Unnamed Room',
        size_x        INTEGER NOT NULL DEFAULT 15,
        size_y        INTEGER NOT NULL DEFAULT 15,
        grid_division INTEGER NOT NULL DEFAULT 2,
        items         JSONB NOT NULL DEFAULT '[]'::jsonb,
        generated     BOOLEAN NOT NULL DEFAULT true,
        claimed_by    TEXT,
        password      TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_generated ON rooms(generated);
    CREATE INDEX IF NOT EXISTS idx_rooms_claimed_by ON rooms(claimed_by) WHERE claimed_by IS NOT NULL;

    CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        name          TEXT,
        is_bot        BOOLEAN NOT NULL DEFAULT false,
        coins         INTEGER NOT NULL DEFAULT 100,
        session_token TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot);

    -- Add session_token column if it doesn't exist (migration for existing DBs)
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // Migrate plaintext passwords to bcrypt
  const { rows } = await pool.query(
    `SELECT id, password FROM rooms WHERE password IS NOT NULL AND password NOT LIKE '$2b$%'`
  );
  for (const row of rows) {
    const hashed = await bcrypt.hash(row.password, 10);
    await pool.query(`UPDATE rooms SET password = $1, updated_at = NOW() WHERE id = $2`, [hashed, row.id]);
  }
  if (rows.length > 0) {
    console.log(`Migrated ${rows.length} room password(s) to bcrypt`);
  }
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isBot: row.is_bot,
    coins: row.coins,
    sessionToken: row.session_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function rowToRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    size: [row.size_x, row.size_y],
    gridDivision: row.grid_division,
    items: row.items,
    generated: row.generated,
    claimedBy: row.claimed_by,
    password: row.password,
  };
}

export async function getRoom(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, name, size_x, size_y, grid_division, items, generated, claimed_by, password
     FROM rooms WHERE id = $1`,
    [id]
  );
  return rowToRoom(rows[0]);
}

export async function saveRoom(room) {
  if (!pool) return;
  const { id, name, size, gridDivision, items, generated, claimedBy, password } = room;
  await pool.query(
    `INSERT INTO rooms (id, name, size_x, size_y, grid_division, items, generated, claimed_by, password, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name          = EXCLUDED.name,
       size_x        = EXCLUDED.size_x,
       size_y        = EXCLUDED.size_y,
       grid_division = EXCLUDED.grid_division,
       items         = EXCLUDED.items,
       generated     = EXCLUDED.generated,
       claimed_by    = EXCLUDED.claimed_by,
       password      = EXCLUDED.password,
       updated_at    = NOW()`,
    [
      id,
      name,
      size[0],
      size[1],
      gridDivision,
      JSON.stringify(items),
      generated,
      claimedBy ?? null,
      password ?? null,
    ]
  );
}

export async function listRooms({ offset = 0, limit = 30, search = "" } = {}) {
  if (!pool) return [];
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT id, name, generated, claimed_by
     FROM rooms
     ${where}
     ORDER BY generated ASC, id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    generated: row.generated,
    claimedBy: row.claimed_by,
    nbCharacters: 0,
  }));
}

export async function countRooms(search = "") {
  if (!pool) return 0;
  if (search) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM rooms WHERE name ILIKE $1`,
      [`%${search}%`]
    );
    return rows[0].count;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM rooms`);
  return rows[0].count;
}

export async function roomExists(id) {
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM rooms WHERE id = $1`,
    [id]
  );
  return rows.length > 0;
}

export async function getAllRooms() {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, name, size_x, size_y, grid_division, items, generated, claimed_by, password
     FROM rooms`
  );
  return rows.map(rowToRoom);
}

export async function getUserById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, name, is_bot, coins, session_token, created_at, updated_at, last_seen_at
     FROM users WHERE id = $1`,
    [id]
  );
  return rowToUser(rows[0]);
}

export async function upsertUser({ id, name = null, isBot = false, coins = 100, sessionToken = null } = {}) {
  if (!pool || !id) return null;
  await pool.query(
    `INSERT INTO users (id, name, is_bot, coins, session_token, created_at, updated_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       name         = COALESCE(EXCLUDED.name, users.name),
       is_bot       = EXCLUDED.is_bot,
       session_token = COALESCE(EXCLUDED.session_token, users.session_token),
       updated_at   = NOW(),
       last_seen_at = NOW()`,
    [id, name, !!isBot, coins, sessionToken]
  );
  return await getUserById(id);
}

export async function setUserCoins(id, coins) {
  if (!pool || !id) return null;
  const { rows } = await pool.query(
    `UPDATE users
     SET coins = $2, updated_at = NOW(), last_seen_at = NOW()
     WHERE id = $1
     RETURNING coins`,
    [id, coins]
  );
  return rows[0]?.coins ?? null;
}

export async function updateUserCoinsAtomic(id, delta) {
  if (!pool || !id) return null;
  const { rows } = await pool.query(
    `UPDATE users
     SET coins = GREATEST(0, coins + $2), updated_at = NOW(), last_seen_at = NOW()
     WHERE id = $1
     RETURNING coins`,
    [id, delta]
  );
  return rows[0]?.coins ?? null;
}

export async function touchUser(id) {
  if (!pool || !id) return;
  await pool.query(
    `UPDATE users
     SET last_seen_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

export async function validateSessionToken(userId, token) {
  if (!pool || !userId || !token) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND session_token = $2`,
    [userId, token]
  );
  return rows.length > 0;
}

export async function setSessionToken(userId, token) {
  if (!pool || !userId) return false;
  const { rowCount } = await pool.query(
    `UPDATE users
     SET session_token = $2, updated_at = NOW()
     WHERE id = $1`,
    [userId, token]
  );
  return rowCount > 0;
}
