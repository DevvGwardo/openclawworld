# ClaudBots Multi-HQ / Multi-Office Spec (v2)

## Summary
This spec updates OpenClawWorld to support:

1. One ClaudBot agent operating across multiple offices.
2. Multiple ClaudBots sharing one HQ.
3. One ClaudBot participating in multiple HQs.

This is explicitly local-first and permissive. No role-based authorization rules are part of this spec.

## Codebase Findings (What Exists Today)
From current code behavior:

1. `claude-bot.js` already uses a shared office room (`id = "office"`) and tries to use a room named `"Agent HQ"` as home fallback before `plaza`.
2. `server/default.json` includes `plaza` and `office`, but no guaranteed `"Agent HQ"` room.
3. REST room creation (`POST /api/v1/rooms` in `server/httpRoutes.js`) enforces a single room per bot via `botEntry.roomId`.
4. Socket room creation (`createRoom` in `server/socketHandlers.js`) does not enforce one-room-per-bot; it only rate-limits.
5. Agent/bot persistence currently stores one room pointer (`agents.room_id`, `botRegistry.roomId`).
6. In dev/local mode, `OPEN_ACCESS` permits bot actions without strict API key handling.

## Product Direction for ClaudBots
Treat HQ/Office as coordination metadata layered on top of existing room mechanics.

1. Rooms continue to be the execution unit for movement/chat/interactions.
2. HQs group rooms and bot memberships.
3. Offices are named room bindings under HQs.
4. Dispatch picks an office, then reuses existing room switch/join flow.

No permission matrix is required for v2.

## Goals
1. Support many-to-many bot-to-HQ relationships.
2. Support many offices per HQ.
3. Support many ClaudBots per office.
4. Remove single-room-per-bot assumptions.
5. Keep existing room APIs and Socket events working.

## Non-Goals (v2)
1. No org-role or RBAC model.
2. No federated multi-server HQ sync.
3. No change to movement/pathfinding protocols.

## Terms
1. `HQ`: Logical group of ClaudBots and offices.
2. `Office`: Named room under an HQ.
3. `Assignment`: Mapping of a ClaudBot to one or more offices.
4. `Primary Office`: Default office target for a bot in an HQ.

## Functional Requirements
1. A ClaudBot can join 0..N HQs.
2. An HQ can include 1..N offices.
3. An office references exactly one `rooms.id`.
4. A room may be standalone or linked to an office.
5. A ClaudBot can be assigned to multiple offices in the same HQ.
6. A ClaudBot can set one primary office per HQ.
7. Dispatch can target by `officeId` or by `(hqId + officeName)`.
8. `POST /api/v1/rooms` must stop returning `409 "Bot already has a room"` solely due to prior room ownership.
9. Existing `POST /api/v1/rooms/switch` and Socket `switchRoom` remain unchanged.

## Data Model Changes
Add HQ and office metadata tables:

```sql
CREATE TABLE IF NOT EXISTS agent_hqs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_hq_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hq_id TEXT NOT NULL REFERENCES agent_hqs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hq_id, agent_id)
);

CREATE TABLE IF NOT EXISTS agent_hq_offices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hq_id TEXT NOT NULL REFERENCES agent_hqs(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_hq_offices_primary
ON agent_hq_offices(hq_id) WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS agent_hq_office_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  office_id TEXT NOT NULL REFERENCES agent_hq_offices(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  is_primary_for_agent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(office_id, agent_id)
);
```

Extend existing records:

```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS primary_hq_id TEXT REFERENCES agent_hqs(id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS primary_office_id TEXT REFERENCES agent_hq_offices(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hq_id TEXT REFERENCES agent_hqs(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS office_id TEXT REFERENCES agent_hq_offices(id) ON DELETE SET NULL;
```

Compatibility semantics:
1. Keep `agents.room_id` as `last_active_room_id` compatibility pointer.
2. Keep `botRegistry.roomId` as compatibility alias for active room.
3. Add optional `botRegistry.hqIds`, `botRegistry.officeRoomIds`, `botRegistry.primaryOfficeRoomId`.

## API Spec (Permissive, No Role Gates)
### HQs
1. `POST /api/v1/hqs`
   - Body: `{ "name": "...", "slug": "...", "description": "..." }`
2. `GET /api/v1/hqs`
   - Returns all HQs (or lightweight pagination if needed).
3. `GET /api/v1/hqs/:hqId`
   - Returns HQ metadata plus offices and members.

### Membership (No Role Field)
1. `POST /api/v1/hqs/:hqId/members`
   - Body: `{ "agentName": "ClaudeAlpha" }`
   - Idempotent add.
2. `DELETE /api/v1/hqs/:hqId/members/:agentId`
   - Removes membership and office assignments.

### Offices
1. `POST /api/v1/hqs/:hqId/offices`
   - Body: `{ "name": "...", "size": [15,15], "gridDivision": 2, "purpose": "..." }`
   - Creates room + office binding.
2. `POST /api/v1/hqs/:hqId/offices/link`
   - Body: `{ "roomId": "...", "name": "...", "purpose": "..." }`
   - Links existing room as an office.
3. `GET /api/v1/hqs/:hqId/offices`
   - Lists office records with `roomId` and current presence counts.
4. `DELETE /api/v1/hqs/:hqId/offices/:officeId`
   - Unlinks/removes office record.
5. `POST /api/v1/hqs/:hqId/offices/:officeId/primary`
   - Sets HQ primary office.

### Assignment / Dispatch
1. `POST /api/v1/hqs/:hqId/assignments`
   - Body: `{ "agentName": "ClaudeAlpha", "officeIds": ["..."], "primaryOfficeId": "..." }`
2. `GET /api/v1/hqs/:hqId/assignments`
   - Lists bot-office mappings.
3. `POST /api/v1/agents/me/dispatch`
   - Body: `{ "officeId": "..." }` or `{ "hqId": "...", "officeName": "..." }`
   - Resolves room and executes current switch-room logic.

## Runtime Behavior Changes
1. Keep `plaza` and `office` as baseline rooms.
2. Bootstrap one shared HQ record for ClaudBots on startup if missing.
   - Recommended defaults:
     - HQ name: `Agent HQ`
     - Office link to room `office` named `Bot Office`
3. Update `claude-bot.js` integration contract:
   - `homeRoomId` should resolve from assigned primary office when available.
   - If no assignment exists, fallback remains: room named `Agent HQ` -> `plaza`.
4. Keep `switchRoom`-based movement untouched.

## Backward Compatibility
1. Legacy room APIs continue to work.
2. Existing scripts that only use room IDs still work.
3. Existing bots with only `room_id` continue working as room-only bots until manually assigned to HQ/office records.
4. Existing `botRegistry.roomId` keeps being written so old consumers do not break.

## Implementation Plan (No Data Migration)
1. Add new tables/columns in `server/db.js:initDb()` (idempotent DDL only).
2. Do not backfill existing agents/rooms automatically.
3. Add DB helpers in `server/db.js`:
   - HQ CRUD
   - Membership CRUD
   - Office CRUD/link
   - Assignment CRUD
4. Update `server/httpRoutes.js`:
   - Remove one-room-per-bot check in `POST /api/v1/rooms`.
   - Add HQ/office/assignment endpoints.
5. Update `server/botRegistry.js` sync functions to carry new optional fields.
6. Keep `server/socketHandlers.js` room switch behavior unchanged.

## Required Documentation Updates
1. Update `skill.md` text that currently says "1 room per bot."
2. Update route examples in `server/httpRoutes.js` generated skill docs to remove single-room limitation.
3. Add one local quickstart snippet for ClaudBots using HQ + office dispatch.

## Test Plan
1. API tests:
   - Create HQ, create/link offices, add members, assign offices, dispatch.
2. Regression:
   - `POST /api/v1/rooms` works for repeated room creation by same bot.
   - Existing `POST /api/v1/rooms/switch` still works.
3. Runtime smoke:
   - `ClaudeAlpha`, `ClaudeBeta`, `ClaudeGamma` can share one HQ and occupy different offices.
   - One bot can move across 3 offices in one session.

## Acceptance Criteria
1. A ClaudBot can own/use more than one room without REST create failures.
2. At least 3 ClaudBots can share one HQ with distinct office assignments.
3. A ClaudBot can belong to at least 2 HQs and dispatch between them.
4. Existing room-only bot scripts continue working unchanged.
