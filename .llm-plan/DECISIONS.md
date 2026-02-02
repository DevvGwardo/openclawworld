## User Room ID Format
**Locked:** 2026-02-02
**Context:** Need to avoid collisions with existing room-N (generated) and bot-room-* (API) patterns
**Constraint:** All user-created rooms MUST use the ID format `user-room-{timestamp}-{random}`
**Source Plan:** User & Bot Room Creation

## Bot Room Limit in Bot Registry
**Locked:** 2026-02-02
**Context:** Need a single authoritative place to enforce 1-room-per-bot limit
**Constraint:** Bot room ownership MUST be tracked via a `roomId` field in the bot registry (bot-registry.json), not in the rooms table
**Source Plan:** User & Bot Room Creation

## Rate Limiting for Room Creation
**Locked:** 2026-02-02
**Context:** No user authentication system exists; need abuse prevention without adding auth
**Constraint:** Room creation MUST be rate-limited (1 per 30s per socket) instead of requiring user authentication
**Source Plan:** User & Bot Room Creation

## User-Created Rooms Are Not Generated
**Locked:** 2026-02-02
**Context:** Need to distinguish user-created rooms from auto-generated template rooms in browser and queries
**Constraint:** User-created rooms MUST have `generated: false` in the database and cache
**Source Plan:** User & Bot Room Creation
