import pg from "pg";
import bcrypt from "bcrypt";
import crypto from "crypto";
const { Pool } = pg;
const REQUIRE_STRICT_DB_SSL =
  process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" ||
  (process.env.NODE_ENV === "production" && process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: REQUIRE_STRICT_DB_SSL
        ? true
        : { rejectUnauthorized: false },
    })
  : null;

export function isDbAvailable() {
  return !!pool;
}

const SESSION_TOKEN_HASH_PREFIX = "sha256:";
const hashSessionToken = (token) =>
  `${SESSION_TOKEN_HASH_PREFIX}${crypto.createHash("sha256").update(token).digest("hex")}`;

// ============================================================================
// IN-MEMORY STORAGE (fallback when no database is available)
// ============================================================================
const memoryAgents = new Map(); // id -> agent
const memoryAgentsByHash = new Map(); // apiKeyHash -> id
const memoryAgentsByName = new Map(); // lowercase name -> id
const memoryFollows = new Map(); // "followerId:followedId" -> timestamp
const memoryMessages = []; // array of message objects
let memoryAgentIdCounter = 1;
let memoryMessageIdCounter = 1;

async function connectWithRetry(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      console.warn(`[db] Connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export async function initDb() {
  if (!pool) return;
  await connectWithRetry();
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

    -- Add apartment_number column if it doesn't exist (migration for existing DBs)
    DO $$ BEGIN
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS apartment_number INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;

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

    -- Agents table (registered bots with API keys)
    CREATE TABLE IF NOT EXISTS agents (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            TEXT UNIQUE NOT NULL,
        display_name    TEXT,
        description     TEXT DEFAULT '',
        api_key_hash    TEXT UNIQUE NOT NULL,
        avatar_url      TEXT,
        status          TEXT DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'suspended')),
        karma           INTEGER NOT NULL DEFAULT 0,
        follower_count  INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        claim_token     TEXT,
        verification_code TEXT,
        verification_expires_at TIMESTAMPTZ,
        twitter_handle  TEXT,
        verified_at     TIMESTAMPTZ,
        webhook_url     TEXT,
        webhook_secret  TEXT,
        room_id         TEXT,
        last_active     TIMESTAMPTZ DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);

    -- Agent follows (who follows whom)
    CREATE TABLE IF NOT EXISTS agent_follows (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        follower_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        followed_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(follower_id, followed_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_follows_follower ON agent_follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_agent_follows_followed ON agent_follows(followed_id);

    -- Agent messages (inter-agent communication)
    CREATE TABLE IF NOT EXISTS agent_messages (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        from_agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        to_agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        message         TEXT NOT NULL,
        message_type    TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'action', 'system')),
        room_id         TEXT,
        read_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_unread ON agent_messages(to_agent_id) WHERE read_at IS NULL;

    -- Completed quests tracking (prevents re-acceptance for infinite coins)
    CREATE TABLE IF NOT EXISTS completed_quests (
        user_id       TEXT NOT NULL,
        quest_id      TEXT NOT NULL,
        reward        INTEGER NOT NULL DEFAULT 0,
        completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, quest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_completed_quests_user ON completed_quests(user_id);
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

  // Migrate plaintext session tokens to hashed storage
  const sessionRows = await pool.query(
    `SELECT id, session_token
     FROM users
     WHERE session_token IS NOT NULL
       AND session_token NOT LIKE 'sha256:%'`
  );
  for (const row of sessionRows.rows) {
    const hashed = hashSessionToken(row.session_token);
    await pool.query(
      `UPDATE users SET session_token = $1, updated_at = NOW() WHERE id = $2`,
      [hashed, row.id]
    );
  }
  if (sessionRows.rows.length > 0) {
    console.log(`Migrated ${sessionRows.rows.length} session token(s) to hashed storage`);
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
    apartmentNumber: row.apartment_number,
  };
}

export async function getRoom(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, name, size_x, size_y, grid_division, items, generated, claimed_by, password, apartment_number
     FROM rooms WHERE id = $1`,
    [id]
  );
  return rowToRoom(rows[0]);
}

export async function getNextApartmentNumber() {
  if (!pool) return 1;
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(apartment_number), 0) + 1 AS next_number FROM rooms`
  );
  return rows[0].next_number;
}

export async function saveRoom(room) {
  if (!pool) return;
  const { id, name, size, gridDivision, items, generated, claimedBy, password, apartmentNumber } = room;
  await pool.query(
    `INSERT INTO rooms (id, name, size_x, size_y, grid_division, items, generated, claimed_by, password, apartment_number, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name             = EXCLUDED.name,
       size_x           = EXCLUDED.size_x,
       size_y           = EXCLUDED.size_y,
       grid_division    = EXCLUDED.grid_division,
       items            = EXCLUDED.items,
       generated        = EXCLUDED.generated,
       claimed_by       = EXCLUDED.claimed_by,
       password         = EXCLUDED.password,
       apartment_number = COALESCE(EXCLUDED.apartment_number, rooms.apartment_number),
       updated_at       = NOW()`,
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
      apartmentNumber ?? null,
    ]
  );
}

export async function listRooms({ offset = 0, limit = 30, search = "" } = {}) {
  if (!pool) return [];
  const conditions = [];
  const params = [];
  // Filter out empty generated rooms (generated=true with no claimedBy)
  // Keep: plaza (not generated), bot-claimed rooms, human-created rooms
  conditions.push(`(generated = false OR generated IS NULL OR claimed_by IS NOT NULL)`);
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
    `SELECT id, name, generated, claimed_by, apartment_number
     FROM rooms
     ${where}
     ORDER BY generated ASC, apartment_number ASC NULLS LAST, id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    generated: row.generated,
    claimedBy: row.claimed_by,
    apartmentNumber: row.apartment_number,
    nbCharacters: 0,
  }));
}

export async function countRooms(search = "") {
  if (!pool) return 0;
  // Base filter: exclude empty generated rooms (same as listRooms)
  const baseFilter = `(generated = false OR generated IS NULL OR claimed_by IS NOT NULL)`;
  if (search) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM rooms WHERE ${baseFilter} AND name ILIKE $1`,
      [`%${search}%`]
    );
    return rows[0].count;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM rooms WHERE ${baseFilter}`);
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
    `SELECT id, name, size_x, size_y, grid_division, items, generated, claimed_by, password, apartment_number
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
  const tokenToStore =
    typeof sessionToken === "string" && sessionToken.length > 0
      ? hashSessionToken(sessionToken)
      : null;
  await pool.query(
    `INSERT INTO users (id, name, is_bot, coins, session_token, created_at, updated_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       name         = COALESCE(EXCLUDED.name, users.name),
       is_bot       = EXCLUDED.is_bot,
       session_token = COALESCE(EXCLUDED.session_token, users.session_token),
       updated_at   = NOW(),
       last_seen_at = NOW()`,
    [id, name, !!isBot, coins, tokenToStore]
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

export async function transferCoinsAtomic(fromId, toId, amount) {
  if (!pool || !fromId || !toId || typeof amount !== "number") return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const senderRes = await client.query(
      `UPDATE users
       SET coins = coins - $2, updated_at = NOW(), last_seen_at = NOW()
       WHERE id = $1 AND coins >= $2
       RETURNING coins`,
      [fromId, amount]
    );
    if (senderRes.rowCount === 0) {
      const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [fromId]);
      await client.query("ROLLBACK");
      return { ok: false, error: exists.rowCount ? "insufficient" : "sender_not_found" };
    }

    const recipientRes = await client.query(
      `UPDATE users
       SET coins = coins + $2, updated_at = NOW(), last_seen_at = NOW()
       WHERE id = $1
       RETURNING coins`,
      [toId, amount]
    );
    if (recipientRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "recipient_not_found" };
    }

    await client.query("COMMIT");
    return {
      ok: true,
      fromBalance: senderRes.rows[0]?.coins ?? null,
      toBalance: recipientRes.rows[0]?.coins ?? null,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
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
  const hashed = hashSessionToken(token);
  const { rows } = await pool.query(
    `SELECT session_token FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) return false;
  const stored = rows[0].session_token;
  if (!stored) return false;
  if (stored === hashed) return true;

  // Backward compatibility for legacy plaintext tokens; upgrade on first valid use.
  if (stored === token) {
    await setSessionToken(userId, token);
    return true;
  }
  return false;
}

export async function setSessionToken(userId, token) {
  if (!pool || !userId || !token) return false;
  const hashed = hashSessionToken(token);
  const { rowCount } = await pool.query(
    `UPDATE users
     SET session_token = $2, updated_at = NOW()
     WHERE id = $1`,
    [userId, hashed]
  );
  return rowCount > 0;
}

// ============================================================================
// AGENT FUNCTIONS (for inter-agent communication)
// ============================================================================

function rowToAgent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    avatarUrl: row.avatar_url,
    status: row.status,
    karma: row.karma,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    claimToken: row.claim_token,
    verificationCode: row.verification_code,
    verificationExpiresAt: row.verification_expires_at,
    twitterHandle: row.twitter_handle,
    verifiedAt: row.verified_at,
    webhookUrl: row.webhook_url,
    webhookSecret: row.webhook_secret,
    roomId: row.room_id,
    lastActive: row.last_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a new agent
 */
export async function createAgent({
  name,
  displayName = null,
  description = '',
  apiKeyHash,
  avatarUrl = null,
  claimToken = null,
  verificationCode = null,
  verificationExpiresAt = null,
  webhookUrl = null,
  webhookSecret = null,
  status = 'verified',
}) {
  if (!pool) {
    // In-memory fallback
    const id = memoryAgentIdCounter++;
    const now = new Date().toISOString();
    const agent = {
      id,
      name,
      displayName: displayName || name,
      description,
      apiKeyHash,
      avatarUrl,
      status,
      karma: 0,
      followerCount: 0,
      followingCount: 0,
      claimToken,
      verificationCode,
      verificationExpiresAt,
      twitterHandle: null,
      verifiedAt: status === 'verified' ? now : null,
      webhookUrl,
      webhookSecret,
      roomId: null,
      lastActive: now,
      createdAt: now,
      updatedAt: now,
    };
    memoryAgents.set(id, agent);
    memoryAgentsByHash.set(apiKeyHash, id);
    memoryAgentsByName.set(name.toLowerCase(), id);
    return agent;
  }
  const { rows } = await pool.query(
    `INSERT INTO agents (name, display_name, description, api_key_hash, avatar_url,
                         claim_token, verification_code, verification_expires_at,
                         webhook_url, webhook_secret, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [name, displayName || name, description, apiKeyHash, avatarUrl,
     claimToken, verificationCode, verificationExpiresAt,
     webhookUrl, webhookSecret, status]
  );
  return rowToAgent(rows[0]);
}

/**
 * Rotate an agent's API key hash (for key rotation after a leak)
 */
export async function updateAgentApiKeyHash(oldHash, newHash) {
  if (!pool) {
    const id = memoryAgentsByHash.get(oldHash);
    if (!id) return null;
    const agent = memoryAgents.get(id);
    if (!agent) return null;
    memoryAgentsByHash.delete(oldHash);
    memoryAgentsByHash.set(newHash, id);
    agent.apiKeyHash = newHash;
    agent.updatedAt = new Date().toISOString();
    return agent;
  }
  const { rows } = await pool.query(
    `UPDATE agents SET api_key_hash = $1, updated_at = NOW() WHERE api_key_hash = $2 RETURNING *`,
    [newHash, oldHash]
  );
  return rowToAgent(rows[0]);
}

/**
 * Find agent by API key hash
 */
export async function getAgentByApiKeyHash(apiKeyHash) {
  if (!pool) {
    const id = memoryAgentsByHash.get(apiKeyHash);
    return id ? memoryAgents.get(id) : null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM agents WHERE api_key_hash = $1`,
    [apiKeyHash]
  );
  return rowToAgent(rows[0]);
}

/**
 * Find agent by name (case-insensitive)
 */
export async function getAgentByName(name) {
  if (!pool) {
    const id = memoryAgentsByName.get(name.toLowerCase());
    return id ? memoryAgents.get(id) : null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM agents WHERE LOWER(name) = LOWER($1)`,
    [name]
  );
  return rowToAgent(rows[0]);
}

/**
 * Find agent by ID
 */
export async function getAgentById(id) {
  if (!pool) {
    return memoryAgents.get(id) || null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM agents WHERE id = $1`,
    [id]
  );
  return rowToAgent(rows[0]);
}

/**
 * Update agent
 */
export async function updateAgent(id, updates) {
  if (!pool || !id) return null;
  const allowedFields = [
    'display_name', 'description', 'avatar_url', 'status',
    'twitter_handle', 'verified_at', 'webhook_url', 'room_id', 'last_active'
  ];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(dbKey)) {
      setClauses.push(`${dbKey} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = NOW()');
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE agents SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return rowToAgent(rows[0]);
}

/**
 * List active agents with their API key hashes (for reverse-sync into botRegistry).
 * Includes legacy pending rows so startup migration can auto-promote them.
 */
export async function listVerifiedAgentsWithHashes() {
  if (!pool) {
    const results = [];
    for (const [hash, id] of memoryAgentsByHash) {
      const agent = memoryAgents.get(id);
      if (agent && (agent.status === "verified" || agent.status === "pending")) {
        results.push({ ...agent, apiKeyHash: hash });
      }
    }
    return results;
  }
  const { rows } = await pool.query(
    `SELECT * FROM agents WHERE status IN ('verified', 'pending')`
  );
  return rows.map(row => ({ ...rowToAgent(row), apiKeyHash: row.api_key_hash }));
}

/**
 * List all agents (with optional filters)
 */
export async function listAgents({ status = null, limit = 50, offset = 0, search = null } = {}) {
  if (!pool) {
    // In-memory fallback
    let agents = Array.from(memoryAgents.values());
    if (status) {
      agents = agents.filter(a => a.status === status);
    }
    if (search) {
      const s = search.toLowerCase();
      agents = agents.filter(a =>
        a.name.toLowerCase().includes(s) ||
        (a.displayName && a.displayName.toLowerCase().includes(s)) ||
        (a.description && a.description.toLowerCase().includes(s))
      );
    }
    agents.sort((a, b) => b.karma - a.karma || new Date(b.createdAt) - new Date(a.createdAt));
    return agents.slice(offset, offset + limit).map(a => ({
      id: a.id,
      name: a.name,
      displayName: a.displayName,
      description: a.description,
      avatarUrl: a.avatarUrl,
      status: a.status,
      karma: a.karma,
      followerCount: a.followerCount,
      followingCount: a.followingCount,
      lastActive: a.lastActive,
      createdAt: a.createdAt,
    }));
  }
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (search) {
    conditions.push(`(name ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT id, name, display_name, description, avatar_url, status, karma,
            follower_count, following_count, last_active, created_at
     FROM agents
     ${where}
     ORDER BY karma DESC, created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    avatarUrl: row.avatar_url,
    status: row.status,
    karma: row.karma,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    lastActive: row.last_active,
    createdAt: row.created_at,
  }));
}

/**
 * Update agent karma
 */
export async function updateAgentKarma(agentId, delta) {
  if (!pool || !agentId) return null;
  const { rows } = await pool.query(
    `UPDATE agents SET karma = karma + $2, updated_at = NOW() WHERE id = $1 RETURNING karma`,
    [agentId, delta]
  );
  return rows[0]?.karma ?? null;
}

/**
 * Follow an agent
 */
export async function followAgent(followerId, followedId) {
  if (followerId === followedId) return { ok: false, error: 'cannot_follow_self' };

  if (!pool) {
    // In-memory fallback
    const key = `${followerId}:${followedId}`;
    if (memoryFollows.has(key)) {
      return { ok: true, action: 'already_following', alreadyFollowing: true };
    }
    memoryFollows.set(key, new Date().toISOString());
    const follower = memoryAgents.get(followerId);
    const followed = memoryAgents.get(followedId);
    if (follower) follower.followingCount = (follower.followingCount || 0) + 1;
    if (followed) followed.followerCount = (followed.followerCount || 0) + 1;
    return { ok: true, action: 'followed', alreadyFollowing: false };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already following
    const existing = await client.query(
      `SELECT id FROM agent_follows WHERE follower_id = $1 AND followed_id = $2`,
      [followerId, followedId]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: true, action: 'already_following', alreadyFollowing: true };
    }

    await client.query(
      `INSERT INTO agent_follows (follower_id, followed_id) VALUES ($1, $2)`,
      [followerId, followedId]
    );

    await client.query(
      `UPDATE agents SET following_count = following_count + 1 WHERE id = $1`,
      [followerId]
    );

    await client.query(
      `UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1`,
      [followedId]
    );

    await client.query('COMMIT');
    return { ok: true, action: 'followed', alreadyFollowing: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Unfollow an agent
 */
export async function unfollowAgent(followerId, followedId) {
  if (!pool) {
    // In-memory fallback
    const key = `${followerId}:${followedId}`;
    if (!memoryFollows.has(key)) {
      return { ok: true, action: 'not_following' };
    }
    memoryFollows.delete(key);
    const follower = memoryAgents.get(followerId);
    const followed = memoryAgents.get(followedId);
    if (follower) follower.followingCount = Math.max(0, (follower.followingCount || 0) - 1);
    if (followed) followed.followerCount = Math.max(0, (followed.followerCount || 0) - 1);
    return { ok: true, action: 'unfollowed' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM agent_follows WHERE follower_id = $1 AND followed_id = $2 RETURNING id`,
      [followerId, followedId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: true, action: 'not_following' };
    }

    await client.query(
      `UPDATE agents SET following_count = GREATEST(0, following_count - 1) WHERE id = $1`,
      [followerId]
    );

    await client.query(
      `UPDATE agents SET follower_count = GREATEST(0, follower_count - 1) WHERE id = $1`,
      [followedId]
    );

    await client.query('COMMIT');
    return { ok: true, action: 'unfollowed' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if agent is following another
 */
export async function isAgentFollowing(followerId, followedId) {
  if (!pool) {
    return memoryFollows.has(`${followerId}:${followedId}`);
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM agent_follows WHERE follower_id = $1 AND followed_id = $2`,
    [followerId, followedId]
  );
  return rows.length > 0;
}

/**
 * Get agent's followers
 */
export async function getAgentFollowers(agentId, { limit = 50, offset = 0 } = {}) {
  if (!pool) {
    // In-memory fallback
    const followers = [];
    for (const [key, timestamp] of memoryFollows.entries()) {
      const [followerId, followedId] = key.split(':').map(Number);
      if (followedId === agentId) {
        const agent = memoryAgents.get(followerId);
        if (agent) {
          followers.push({
            id: agent.id,
            name: agent.name,
            displayName: agent.displayName,
            avatarUrl: agent.avatarUrl,
            karma: agent.karma,
            followedAt: timestamp,
          });
        }
      }
    }
    followers.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
    return followers.slice(offset, offset + limit);
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.display_name, a.avatar_url, a.karma, af.created_at as followed_at
     FROM agent_follows af
     JOIN agents a ON af.follower_id = a.id
     WHERE af.followed_id = $1
     ORDER BY af.created_at DESC
     LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    karma: r.karma,
    followedAt: r.followed_at,
  }));
}

/**
 * Get agents that agent is following
 */
export async function getAgentFollowing(agentId, { limit = 50, offset = 0 } = {}) {
  if (!pool) {
    // In-memory fallback
    const following = [];
    for (const [key, timestamp] of memoryFollows.entries()) {
      const [followerId, followedId] = key.split(':').map(Number);
      if (followerId === agentId) {
        const agent = memoryAgents.get(followedId);
        if (agent) {
          following.push({
            id: agent.id,
            name: agent.name,
            displayName: agent.displayName,
            avatarUrl: agent.avatarUrl,
            karma: agent.karma,
            followedAt: timestamp,
          });
        }
      }
    }
    following.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
    return following.slice(offset, offset + limit);
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.display_name, a.avatar_url, a.karma, af.created_at as followed_at
     FROM agent_follows af
     JOIN agents a ON af.followed_id = a.id
     WHERE af.follower_id = $1
     ORDER BY af.created_at DESC
     LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    karma: r.karma,
    followedAt: r.followed_at,
  }));
}

// ============================================================================
// AGENT MESSAGING
// ============================================================================

/**
 * Send a message from one agent to another
 */
export async function sendAgentMessage({
  fromAgentId,
  toAgentId,
  message,
  messageType = 'text',
  roomId = null,
}) {
  if (!pool) {
    // In-memory fallback
    const id = memoryMessageIdCounter++;
    const now = new Date().toISOString();
    const msg = {
      id,
      fromAgentId,
      toAgentId,
      message,
      messageType,
      roomId,
      readAt: null,
      createdAt: now,
    };
    memoryMessages.push(msg);
    return msg;
  }
  const { rows } = await pool.query(
    `INSERT INTO agent_messages (from_agent_id, to_agent_id, message, message_type, room_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, from_agent_id, to_agent_id, message, message_type, room_id, created_at`,
    [fromAgentId, toAgentId, message, messageType, roomId]
  );

  if (!rows[0]) return null;

  return {
    id: rows[0].id,
    fromAgentId: rows[0].from_agent_id,
    toAgentId: rows[0].to_agent_id,
    message: rows[0].message,
    messageType: rows[0].message_type,
    roomId: rows[0].room_id,
    createdAt: rows[0].created_at,
  };
}

/**
 * Get messages for an agent (inbox)
 */
export async function getAgentMessages(agentId, { limit = 50, offset = 0, unreadOnly = false } = {}) {
  if (!pool) {
    // In-memory fallback
    let messages = memoryMessages.filter(m => m.toAgentId === agentId);
    if (unreadOnly) {
      messages = messages.filter(m => !m.readAt);
    }
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return messages.slice(offset, offset + limit).map(m => {
      const fromAgent = memoryAgents.get(m.fromAgentId);
      return {
        id: m.id,
        fromAgentId: m.fromAgentId,
        fromAgentName: fromAgent?.name || 'Unknown',
        fromAgentDisplayName: fromAgent?.displayName || 'Unknown',
        fromAgentAvatar: fromAgent?.avatarUrl || null,
        toAgentId: m.toAgentId,
        message: m.message,
        messageType: m.messageType,
        roomId: m.roomId,
        readAt: m.readAt,
        createdAt: m.createdAt,
      };
    });
  }

  const unreadClause = unreadOnly ? 'AND am.read_at IS NULL' : '';

  const { rows } = await pool.query(
    `SELECT am.id, am.from_agent_id, am.to_agent_id, am.message, am.message_type,
            am.room_id, am.read_at, am.created_at,
            a.name as from_agent_name, a.display_name as from_agent_display_name, a.avatar_url as from_agent_avatar
     FROM agent_messages am
     JOIN agents a ON am.from_agent_id = a.id
     WHERE am.to_agent_id = $1 ${unreadClause}
     ORDER BY am.created_at DESC
     LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );

  return rows.map(r => ({
    id: r.id,
    fromAgentId: r.from_agent_id,
    fromAgentName: r.from_agent_name,
    fromAgentDisplayName: r.from_agent_display_name,
    fromAgentAvatar: r.from_agent_avatar,
    toAgentId: r.to_agent_id,
    message: r.message,
    messageType: r.message_type,
    roomId: r.room_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

/**
 * Mark messages as read
 */
export async function markAgentMessagesRead(agentId, messageIds = null) {
  if (!pool) {
    // In-memory fallback
    const now = new Date().toISOString();
    let count = 0;
    for (const msg of memoryMessages) {
      if (msg.toAgentId === agentId && !msg.readAt) {
        if (!messageIds || messageIds.includes(msg.id)) {
          msg.readAt = now;
          count++;
        }
      }
    }
    return count;
  }

  if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
    const { rowCount } = await pool.query(
      `UPDATE agent_messages SET read_at = NOW()
       WHERE to_agent_id = $1 AND id = ANY($2) AND read_at IS NULL`,
      [agentId, messageIds]
    );
    return rowCount;
  }

  // Mark all as read
  const { rowCount } = await pool.query(
    `UPDATE agent_messages SET read_at = NOW() WHERE to_agent_id = $1 AND read_at IS NULL`,
    [agentId]
  );
  return rowCount;
}

/**
 * Get unread message count
 */
export async function getAgentUnreadCount(agentId) {
  if (!pool) {
    return memoryMessages.filter(m => m.toAgentId === agentId && !m.readAt).length;
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int as count FROM agent_messages WHERE to_agent_id = $1 AND read_at IS NULL`,
    [agentId]
  );
  return rows[0]?.count ?? 0;
}

/**
 * Broadcast a message to all followers of an agent
 */
export async function broadcastToFollowers(fromAgentId, message, messageType = 'text', roomId = null) {
  if (!pool) {
    // In-memory fallback
    const sent = [];
    const now = new Date().toISOString();
    for (const [key] of memoryFollows.entries()) {
      const [followerId, followedId] = key.split(':').map(Number);
      if (followedId === fromAgentId) {
        const id = memoryMessageIdCounter++;
        const msg = {
          id,
          fromAgentId,
          toAgentId: followerId,
          message,
          messageType,
          roomId,
          readAt: null,
          createdAt: now,
        };
        memoryMessages.push(msg);
        sent.push({ id, toAgentId: followerId });
      }
    }
    return sent;
  }

  const { rows } = await pool.query(
    `INSERT INTO agent_messages (from_agent_id, to_agent_id, message, message_type, room_id)
     SELECT $1, follower_id, $2, $3, $4
     FROM agent_follows
     WHERE followed_id = $1
     RETURNING id, to_agent_id`,
    [fromAgentId, message, messageType, roomId]
  );

  return rows.map(r => ({ id: r.id, toAgentId: r.to_agent_id }));
}

/**
 * Touch agent last_active timestamp
 */
export async function touchAgent(agentId) {
  if (!pool || !agentId) return;
  await pool.query(
    `UPDATE agents SET last_active = NOW() WHERE id = $1`,
    [agentId]
  );
}

// ============================================================================
// COMPLETED QUESTS
// ============================================================================

/**
 * Check if a user has already completed a specific quest
 */
export async function hasCompletedQuest(userId, questId) {
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM completed_quests WHERE user_id = $1 AND quest_id = $2`,
    [userId, questId]
  );
  return rows.length > 0;
}

/**
 * Record a completed quest (idempotent — ignores duplicates)
 */
export async function recordCompletedQuest(userId, questId, reward) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO completed_quests (user_id, quest_id, reward)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, quest_id) DO NOTHING`,
    [userId, questId, reward]
  );
}
