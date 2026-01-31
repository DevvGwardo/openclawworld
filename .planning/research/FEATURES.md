# Feature Landscape: 3D Social Sandbox with AI Bot Inhabitants

**Domain:** Persistent 3D social world with autonomous LLM-powered AI bots
**Researched:** 2026-01-31
**Scope:** v1 target of 1 bot + 1 human, browser-based, Socket.IO transport
**Overall confidence:** MEDIUM-HIGH

---

## Table Stakes

Features users expect. Missing any of these and the "bot feels alive" premise falls apart.

### Bot Perception (What the Bot Knows)

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| **World state snapshot** | Bot must know what exists in the room: furniture, objects, other avatars, their positions | Low | Already have room items and avatar positions. Bot receives this via Socket.IO world-state event. Serialize as structured text for the LLM prompt. |
| **Nearby entity awareness** | Bot should know who/what is near it (within a radius), not just the whole room | Low | Simple distance filter on world state. Stanford Smallville uses spatial proximity as the primary perception trigger. |
| **Event perception** | Bot must "hear" chat messages, see emotes, notice arrivals/departures | Medium | Subscribe bot's Socket.IO client to chat, emote, join/leave events. Feed these as "observations" to the LLM. This is the input half of the perception-action loop. |
| **Self-awareness** | Bot knows its own position, name, current action, and identity | Low | Bot client tracks its own state. Include in every LLM prompt as "You are [name], currently at [position], doing [action]." |

### Bot Actions (What the Bot Can Do)

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| **Movement (pathfinding)** | Bot must walk around the room, not teleport | Low | Grid-based pathfinding already exists in the codebase. Bot emits movement commands through Socket.IO. |
| **Chat messages** | Bot must be able to speak in the room chat | Low | Emit chat event through Socket.IO. This is the most basic and most impactful action -- conversation is where LLMs shine. |
| **Emotes/animations** | Bot should dance, wave, sit -- use existing emote system | Low | Already have dance emotes. Bot selects from available emote list. Include emote names in LLM action schema. |
| **Idle behavior** | Bot does something when not interacting: wanders, sits on furniture, looks around | Medium | Crucial for "alive" feeling. Without idle behavior, bot stands frozen between interactions. Implement as a default behavior loop with randomized choices. |

### Bot Decision Loop (The Core Loop)

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| **Perception-reasoning-action cycle** | The fundamental tick: perceive world -> reason via LLM -> emit action | High | This IS the product. Stanford Smallville and a16z AI Town both center on this loop. Implementation: periodic tick (every 5-15 seconds) sends world state + recent events to LLM, gets back structured action. |
| **Structured action output** | LLM returns machine-parseable actions, not free text | Medium | Use function calling or JSON schema. Actions like `{ "type": "move", "target": "couch" }` or `{ "type": "say", "message": "Hello!" }`. Gigax uses this exact pattern with `<say>`, `<jump>`, `<attack>` action tags. |
| **Action validation** | Server validates bot actions before applying them | Medium | Bot should not walk through walls or use nonexistent emotes. Server-side validation prevents LLM hallucinations from breaking world state. |

### Chat System

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| **Room-wide text chat** | Everyone in the room sees messages from both humans and bots | Low | Standard multiplayer chat. Already implied by existing chat messages in codebase. |
| **Message attribution** | Each message shows who sent it (name + avatar) | Low | Standard chat UI. Bot messages appear the same as human messages in the chat log. |
| **Chat history in context** | Bot can reference recent conversation | Medium | Include last N messages in the LLM prompt as conversation context. Critical for coherent dialogue -- without it, bot has amnesia between ticks. |

### Visual Identity

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| **Bot has an avatar** | Bot must be visually present in the 3D world, not just a chat entity | Low | Use Ready Player Me avatar (already in stack). Bot gets a pre-configured avatar URL. |
| **Bot vs human indicator** | Users must know who is a bot | Low | Industry consensus: use a disclosure badge (small icon/tag). ShapeofAI UX patterns explicitly recommend this. A subtle "AI" badge or bot icon next to name. Do NOT hide that it is a bot. |
| **Nameplate** | Floating name above avatar | Low | Standard for social worlds. Bot nameplate includes the AI badge. |

---

## Differentiators

Features that make the experience feel magical. Not expected, but create the "wow this bot feels alive" moment.

### Personality and Character

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Distinct personality via system prompt** | Bot has a unique voice, opinions, mannerisms -- feels like a character, not generic AI | Low | Define personality in the system prompt: name, backstory, speech style, interests. This is where OpenClaw bots differentiate from generic chatbots. Stanford Smallville proved short bios create emergent personality. |
| **Emotional state** | Bot's mood shifts based on interactions (happy when complimented, bored when alone) | Medium | Track a simple emotion vector (happy/sad/energetic/calm). Feed into system prompt. Inworld AI's Character Engine uses emotional states as a core feature. Changes bot's action choices and speech tone. |
| **Contextual reactions** | Bot reacts to what happens, not just what's said. Someone enters? Bot turns to look. Furniture moved? Bot comments on it. | Medium | Map world events to reaction triggers. "A new person entered" -> bot might wave and say hello. This makes bot feel aware, not just responsive to direct address. |

### Memory

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Short-term conversation memory** | Bot remembers what was discussed in the current session | Low | Include recent chat history in LLM context window. Already listed as table stakes for chat coherence, but ALSO a differentiator when done well (bot references something said 5 minutes ago). |
| **Cross-session memory** | Bot remembers the human from yesterday | High | Requires persistent storage of interaction summaries keyed by user. Stanford's memory stream + retrieval model. Massive differentiator but complex. **Defer to post-v1.** |
| **Reflection/summarization** | Bot periodically summarizes experiences into higher-level beliefs | High | Stanford Smallville's reflection mechanism. "I had a nice conversation with Alex about music" stored as a memory. **Defer to post-v1.** |

### Autonomous Goal-Directed Behavior

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Daily routine / schedule** | Bot has a loose routine: "morning I like to sit by the window, afternoon I explore" | Medium | Give bot a schedule in its system prompt. Decision loop checks time-of-day and adjusts behavior. Creates rhythmic, lifelike patterns. |
| **Self-initiated interaction** | Bot approaches a human to start a conversation, not just responds | Medium | If bot perceives a human nearby and hasn't talked recently, initiate. This is the single biggest "alive" signal -- proactive behavior. |
| **Object interaction** | Bot sits on chairs, stands near the jukebox, examines paintings | Medium | Map furniture/objects to interaction possibilities. Bot chooses contextually. "I'll sit on the couch" requires knowing couch position and pathfinding to it. |

### Polish and Feel

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Typing indicator for bot** | When bot is "thinking" (LLM processing), show typing dots in chat | Low | Bridges the 1-3 second LLM latency gap. Makes the pause feel intentional, like the bot is composing a thought. Standard chat UX pattern. |
| **Gradual movement** | Bot walks at human pace, pauses, changes direction naturally | Low | Don't rush pathfinding. Add slight randomness to movement speed and pauses. Humanizes traversal. |
| **Look-at behavior** | Bot's avatar faces the person it's talking to | Medium | Rotate avatar toward conversation partner. Subtle but powerful social signal. |
| **Action variety** | Bot doesn't repeat the same action. Varied idle behaviors, different greetings. | Low | LLM naturally provides variety. Ensure the action schema has enough options and the system prompt encourages variety. |

---

## Anti-Features

Features to deliberately NOT build for v1. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Voice/audio for bots** | Adds massive complexity (TTS, audio streaming, lip sync), marginal v1 value | Text chat only. Voice is a v2+ feature after the core loop proves out. |
| **Multi-bot social dynamics** | Bots talking to each other is fascinating (Inworld supports 2-5 agent conversations) but doubles LLM costs and complexity | v1 is 1 bot + 1 human. Prove the single-bot loop first. Multi-bot is a clear v2 milestone. |
| **Complex memory/reflection** | Stanford's full memory stream + retrieval + reflection is a research project in itself | v1 uses conversation context window only. No persistent memory store. Add memory in a later phase. |
| **Player-customizable bot personalities** | UI for personality editing is a product in itself | Hardcode 1-3 bot personalities in system prompts. Customization comes later. |
| **Procedural world generation** | Generating rooms/environments dynamically adds huge scope | Use hand-crafted or pre-built rooms. The bot behavior is the innovation, not the world. |
| **Complex NPC quests/objectives** | Traditional game AI with quest systems, dialogue trees, branching narratives | The bot IS the content. Open-ended conversation and behavior replaces scripted quests. |
| **Real-time vision (bot "sees" the 3D render)** | Multimodal LLM processing of screenshots is slow, expensive, and unnecessary | Bot perceives via structured data (JSON world state), not visual input. Much faster and cheaper. |
| **Behavior trees / FSM for bot logic** | Traditional game AI patterns add complexity without leveraging LLM strengths | Let the LLM be the decision engine. The action schema IS the behavior tree. FSMs are for when you need deterministic, fast AI -- LLMs give you flexible, creative AI. |
| **Anti-cheat / bot detection resistance** | Making bots undetectable from humans | Opposite approach: clearly label bots as AI. Transparency is a feature, deception is a liability. |
| **Persistent world state changes by bots** | Bots rearranging furniture, creating objects | v1 bots observe and interact with the world as-is. World mutation by bots is post-v1. |

---

## Feature Dependencies

```
Bot Avatar (visual presence)
  |
  v
World State Snapshot (bot perceives room)
  |
  v
Event Perception (bot receives events) -----> Chat History in Context
  |                                                |
  v                                                v
Perception-Reasoning-Action Loop  <----------  Structured Action Output
  |          |           |
  v          v           v
Movement   Chat      Emotes/Idle
  |          |
  v          v
Pathfinding  Message Attribution
              |
              v
         Bot Indicator Badge

--- Differentiators build on top ---

Perception-Reasoning-Action Loop
  |
  +---> Personality (system prompt) ---> Emotional State
  |
  +---> Self-Initiated Interaction
  |
  +---> Object Interaction ---> Daily Routine
  |
  +---> Typing Indicator (polish)
  |
  +---> Look-At Behavior (polish)
```

**Critical path for v1:** World State -> Event Perception -> Decision Loop -> Structured Actions -> Movement + Chat + Emotes

Everything else layers on top of this core loop.

---

## MVP Recommendation

For MVP (v1: 1 bot + 1 human), prioritize in this order:

### Phase 1: Prove the Loop
1. **Bot connects as headless Socket.IO client** -- receives world state
2. **Perception-reasoning-action cycle** -- periodic tick sends state to LLM, gets action back
3. **Structured action output** -- LLM returns JSON actions
4. **Chat messages** -- bot can speak (the highest-impact, lowest-complexity action)
5. **Movement via pathfinding** -- bot walks to locations

This phase proves: "A bot can perceive, think, and act in the world."

### Phase 2: Make It Feel Alive
6. **Personality via system prompt** -- bot has character
7. **Idle behavior** -- bot does things when nobody's talking to it
8. **Emotes** -- bot dances, waves, sits
9. **Bot indicator badge** -- clearly mark as AI
10. **Typing indicator** -- bridge LLM latency
11. **Event perception** -- bot reacts to arrivals, departures

This phase proves: "The bot feels like it belongs in this world."

### Phase 3: Delight
12. **Self-initiated interaction** -- bot approaches humans
13. **Object interaction** -- bot uses furniture contextually
14. **Emotional state** -- mood shifts based on interactions
15. **Contextual reactions** -- bot notices and comments on world changes
16. **Look-at behavior** -- avatar faces conversation partner

This phase proves: "The bot feels alive."

### Defer to Post-v1
- Cross-session memory / persistent memory store
- Reflection and summarization
- Multi-bot interactions
- Voice/audio
- Player-customizable personalities
- World mutation by bots

---

## Complexity Budget

| Complexity | Count | Items |
|------------|-------|-------|
| Low | 14 | World state, self-awareness, chat, emotes, avatar, badge, nameplate, personality prompt, short-term memory, typing indicator, gradual movement, action variety, message attribution, nearby awareness |
| Medium | 10 | Event perception, idle behavior, structured output, action validation, chat history context, emotional state, contextual reactions, daily routine, self-initiated interaction, object interaction, look-at |
| High | 3 | Core decision loop (high but unavoidable), cross-session memory (defer), reflection (defer) |

The v1 feature set is achievable because most items are Low complexity and the single High-complexity item (the decision loop) is the core product.

---

## Sources

### Primary (HIGH confidence)
- [Stanford Generative Agents Paper](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763) -- Foundational architecture: memory stream, retrieval, reflection, planning
- [a16z AI Town (GitHub)](https://github.com/a16z-infra/ai-town) -- Open source reference implementation of generative agents in a virtual town
- [Convex AI Town Character Identities](https://stack.convex.dev/building-ai-town-character-ids) -- How personality is defined through memory/description text
- [Inworld AI Platform](https://inworld.ai/) -- Production AI NPC platform with perception, memory, goals, multi-agent
- [Inworld Multi-Agent Feature](https://inworld.ai/blog/multi-agent-feature-npc-to-npc) -- NPC-to-NPC conversation architecture
- [OpenAI Latency Optimization Guide](https://platform.openai.com/docs/guides/latency-optimization) -- Streaming, model selection, prompt optimization for LLM response times
- [ShapeofAI Avatar UX Patterns](https://www.shapeof.ai/patterns/avatar) -- Disclosure badges for AI vs human distinction

### Secondary (MEDIUM confidence)
- [Gigax NPC Playground (Hugging Face)](https://huggingface.co/blog/npc-gigax-cubzh) -- LLM-powered NPC action schema with function calling in 3D environments
- [Google DeepMind SIMA 2](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/) -- Generalist AI agent for 3D virtual worlds
- [NVIDIA ACE / AI NPCs in Gaming 2025](https://techlife.blog/posts/ai-npcs-gaming-2025/) -- Industry trends for autonomous game characters
- [Interconnected: NPCs as UI](https://interconnected.org/home/2022/05/09/npcs) -- Bot characters as ambient presence in social 3D spaces
- [AI NPC Game Design Patterns](https://whimsygames.co/blog/crafting-dynamic-npcs-with-ai-game-development-guide/) -- FSM, behavior trees, pathfinding patterns for NPC behavior

### Tertiary (LOW confidence -- WebSearch only, unverified)
- Various community discussions on bot indicators in multiplayer games (SMITE forums, NeoGAF)
- Blog posts on LLM rate limiting strategies for real-time applications
