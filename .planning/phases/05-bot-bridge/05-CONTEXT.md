# Phase 5: Bot Bridge - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the perception-decision-action loop so one bot autonomously perceives the world, decides via LLM, and acts in the game room. Bot joins, observes nearby players, sends perception to Gateway, receives structured action JSON, and executes it. Includes idle behavior, validation, rate limiting, and structured logging. Personality and multi-bot coexistence are Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Perception scope
- Nearby only — bot perceives players/objects within a radius, not the whole room
- Rich context per player: position, name, recent chat, current emote/animation state, whether moving or idle
- Chat history bounded by time: last 60 seconds of messages (natural decay)
- Bot self-memory: last 5 of its own actions included in perception (prevents repetitive behavior)

### Idle behavior
- Patrol with random waypoints — bot picks random valid positions and walks between them
- While waiting for LLM response, bot continues patrol (response interrupts when it arrives)
- Idle-to-engaged transition: Claude's discretion (pick what feels natural)

### Action vocabulary
- Four actions available to LLM: move, say, emote, look (face a player without walking over)
- Target selection: LLM decides who to interact with (all nearby players included in perception)
- Single vs multi-action per response: Claude's discretion (pick what works with rate limiter)
- Loop timing: hybrid — fixed interval baseline + immediate trigger on direct interactions (someone talks to the bot)

### Failure & fallback
- Invalid LLM JSON: retry once, then fall back to patrol
- Gateway down/disconnected: pure idle patrol, no talking, until Gateway reconnects
- Rate-limited actions: queue and execute later (bot catches up)
- Failure visibility: debug flag (environment variable) enables visible error indicators, off by default. Failures always logged server-side.

### Claude's Discretion
- Perception radius distance
- Exact serialization format for perception text
- Token budget management
- Single vs multi-action responses
- Idle-to-engaged transition style
- Loop interval timing (baseline rate)
- Rate limiter burst/sustained values (roadmap specifies burst 3, sustained 1/sec)
- Pino logger configuration

</decisions>

<specifics>
## Specific Ideas

- Bot should feel alive even when LLM is slow — patrol continues seamlessly during response wait
- "Look at" action adds expressiveness without requiring movement — bot can acknowledge a player from a distance
- Self-memory of last 5 actions is key to avoiding repetitive "hello, hello, hello" loops

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-bot-bridge*
*Context gathered: 2026-01-31*
