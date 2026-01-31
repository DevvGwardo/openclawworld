# Phase 2: Server Modifications - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the game server bot-aware: add isBot flag to character data, handle expanded emote events (wave, sit, nod beyond existing dance), and expose a health endpoint. This phase modifies the server only — no bot client, no Gateway, no UI changes.

</domain>

<decisions>
## Implementation Decisions

### Event protocol
- Use **namespaced event names** (colon-separated): `emote:play`, `character:update`, etc.
- New events follow the pattern `domain:action` to stay organized as the event surface grows

### Claude's Discretion
- **Bot join mechanism**: Whether bots use the same join event with isBot in payload or a separate `bot:join` event — decide based on how the existing join flow works in the template
- **Emote validation**: Whether the server validates emotes against an allowed list or passes any string through — decide based on what fits the architecture best
- **Event source marking**: Whether bot-originated events carry an isBot flag in each payload or clients look up the character record — decide based on what's cleanest for downstream consumers
- **Health endpoint shape**: Response format, status codes, and what data to include (server uptime, connected players, room count, etc.)
- **Bot identity & extra data**: What additional fields bots carry beyond isBot flag

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User's main preference was namespaced events for organization.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-server-modifications*
*Context gathered: 2026-01-31*
