# Phase 6: Client UI - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Make bot and human speech visible in the 3D scene. Two deliverables: (1) 3D chat bubbles floating above avatars that fade after ~5 seconds, and (2) a 2D overlay panel showing the last 20 chat messages with speaker names. Display only — no chat input field in this phase.

</domain>

<decisions>
## Implementation Decisions

### Chat Bubble Style
- Semi-transparent frosted glass background with dark text
- Speaker's name displayed in small bold text at the top of each bubble, above the message
- Shape and specific design at Claude's discretion (pick what fits the existing R3F scene art style)
- Text scaling at Claude's discretion (billboard vs world-scale — optimize for readability)

### Chat Log Panel
- Right sidebar position — tall panel on the right side of the screen
- Auto-hide behavior: panel appears when new messages arrive, fades out after inactivity
- Solid dark opaque background for readability — distinct from the semi-transparent bubbles
- Display only — no text input field (human chat input is out of scope for this phase)
- Shows last 20 messages with speaker names

### Bot vs Human Distinction
- Bots are clearly marked with a `[BOT]` text tag after their name
- `[BOT]` tag appears in both 3D chat bubbles and the 2D chat log panel
- Messages interleaved chronologically regardless of sender type — natural conversation flow
- Whether bot bubbles get a different color tint is at Claude's discretion

### Claude's Discretion
- Bubble shape (rounded rectangle, pill, etc.)
- Text scaling approach (billboard vs world-scale)
- Bot bubble color tint vs same as human
- Loading skeleton / transition animations
- Exact spacing, typography, and font sizes
- Bubble fade-out timing and animation style
- Auto-hide delay for the chat log panel
- Error state handling

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-client-ui*
*Context gathered: 2026-01-31*
