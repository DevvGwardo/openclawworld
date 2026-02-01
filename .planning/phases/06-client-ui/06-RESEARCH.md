# Phase 6: Client UI - Research

**Researched:** 2026-01-31
**Domain:** React Three Fiber UI / 3D chat bubbles / 2D overlay panels
**Confidence:** HIGH

## Summary

This phase adds two chat display features to the existing R3F scene: (1) enhanced 3D chat bubbles floating above avatars with speaker names and bot tags, and (2) a new 2D chat log overlay panel showing the last 20 messages. The existing codebase already has a basic chat bubble implementation in `Avatar.jsx` using `@react-three/drei`'s `<Html>` component with Tailwind CSS, providing a strong foundation to build on.

The primary challenge is **data enrichment**: the current `playerChatMessage` socket event sends only `{ id, message }` without speaker name or bot status. The `characters` atom already holds `name` and `isBot` fields from the server, so the client needs to cross-reference character data with chat message IDs. A new jotai atom for chat message history will serve both the 3D bubbles and the 2D log panel.

**Primary recommendation:** Enhance the existing `Avatar.jsx` bubble with speaker name/bot tag styling, create a shared `chatMessagesAtom` in jotai, and build the 2D chat log as a new HTML overlay component outside the Canvas (alongside the existing `<UI />` component).

## Standard Stack

### Core (Already Installed -- No New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-three/drei` | 9.75.0 | `<Html>` component for 3D-anchored DOM overlays | Already used in Avatar.jsx for chat bubbles |
| `@react-three/fiber` | 8.13.3 | React renderer for three.js | Core scene renderer |
| `three` | 0.153.0 | 3D engine | Underlying engine |
| `jotai` | ^2.2.3 | Atomic state management | Already used for all shared state (characters, rooms, user) |
| `tailwindcss` | ^3.3.3 | Utility-first CSS | Already used for all UI styling |
| `framer-motion` | ^10.16.4 | Animation library | Already used in UI.jsx for transitions |

### Supporting (Already Installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `framer-motion` | ^10.16.4 | Fade-in/fade-out animations | Chat log auto-hide, bubble fade |
| Tailwind `backdrop-blur` | Built-in | Frosted glass effect | Chat bubble background |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| drei `<Html>` for bubbles | drei `<Billboard>` + `<Text>` | Pure 3D text avoids DOM overhead but loses Tailwind styling, frosted glass, and easy HTML layout. Html is already working in the codebase. |
| Jotai atom for chat log | React Context | Jotai is the established pattern in this codebase. No reason to deviate. |
| Tailwind for chat log panel | CSS Modules | Entire codebase uses Tailwind. Consistency wins. |

**Installation:** None required. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
client/src/
├── components/
│   ├── Avatar.jsx           # MODIFY: Enhanced chat bubble with name + [BOT] tag
│   ├── ChatLog.jsx          # NEW: 2D overlay panel (last 20 messages)
│   ├── SocketManager.jsx    # MODIFY: Add chatMessagesAtom, enrich playerChatMessage events
│   ├── UI.jsx               # MODIFY: Render <ChatLog /> in overlay
│   └── ...existing files
```

### Pattern 1: Shared Chat Message Atom (Jotai)

**What:** A single jotai atom stores the chat message history, consumed by both the 3D bubble system and the 2D log panel.

**When to use:** Whenever a `playerChatMessage` socket event arrives.

**Example:**
```jsx
// In SocketManager.jsx
export const chatMessagesAtom = atom([]);

// Message shape:
// {
//   id: string,         // unique message ID (Date.now() + sender ID)
//   senderId: string,   // socket.id of the sender
//   senderName: string, // display name (from characters atom or fallback)
//   isBot: boolean,     // from characters atom
//   message: string,    // chat text
//   timestamp: number,  // Date.now()
// }
```

**Key detail:** The `playerChatMessage` event only sends `{ id, message }` where `id` is the socket ID. The SocketManager must cross-reference the `charactersAtom` to resolve `name` and `isBot` for each message. The character data is already available because it's set on `roomJoined` and updated on `characters` events.

### Pattern 2: drei Html for 3D Chat Bubbles (Billboard Behavior)

**What:** The existing `<Html position-y={2}>` in Avatar.jsx already provides billboard-like behavior (DOM elements overlaid at 3D positions, always facing camera). This is the correct approach.

**When to use:** For any DOM content that should float above 3D objects.

**Example (enhanced bubble):**
```jsx
<Html position-y={2} center>
  <div className="w-60 max-w-full">
    <div className={`... transition-opacity duration-500 ${showChatBubble ? '' : 'opacity-0'}`}>
      <p className="text-xs font-bold text-gray-700">
        {senderName} {isBot && <span className="text-blue-500">[BOT]</span>}
      </p>
      <p className="text-sm text-black">{chatMessage}</p>
    </div>
  </div>
</Html>
```

**Note:** The drei `<Html>` component with `center` prop handles billboard behavior automatically. It projects a 3D position to 2D screen coordinates and renders a DOM element there. No need for custom billboard logic.

### Pattern 3: 2D Overlay Outside Canvas

**What:** The chat log panel is a standard React component rendered outside the `<Canvas>` element, as a sibling to the existing `<UI />` component.

**When to use:** For any 2D HUD/overlay that doesn't need to exist in 3D space.

**Example:**
```jsx
// In App.jsx
<>
  <Canvas>...</Canvas>
  {loaded && <UI />}
  {loaded && <ChatLog />}  // Or render ChatLog inside UI
</>
```

The existing `<UI />` component is already rendered outside the Canvas with `fixed` positioning. The chat log panel follows the same pattern.

### Pattern 4: Auto-Hide with Activity Timer

**What:** The chat log panel shows on new message arrival and hides after a period of inactivity.

**When to use:** For the chat log panel auto-hide behavior.

**Example:**
```jsx
const [visible, setVisible] = useState(false);
const hideTimerRef = useRef(null);

useEffect(() => {
  if (messages.length > 0) {
    setVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 8000);
  }
  return () => clearTimeout(hideTimerRef.current);
}, [messages.length]);
```

### Anti-Patterns to Avoid

- **Do not use `<Text>` or `<Billboard>` from drei for chat bubbles:** The existing `<Html>` approach works well, supports Tailwind styling, and is already proven in the codebase. Switching to pure 3D text would be a step backward in visual quality for this use case.
- **Do not listen to `playerChatMessage` in multiple places independently:** Use a single listener in SocketManager that writes to the shared atom. Both Avatar and ChatLog read from the same source.
- **Do not store unbounded message history:** Cap at 20 messages (or slightly more for buffer). Shift old messages out when new ones arrive.
- **Do not add a chat input field:** This is explicitly out of scope. The existing chat input in UI.jsx already handles sending.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 3D-anchored HTML overlays | Custom screen projection math | drei `<Html>` component | Already handles projection, z-sorting, occlusion. Proven in Avatar.jsx. |
| Billboard behavior | Manual quaternion copying from camera | drei `<Html>` (inherent) | `<Html>` always faces camera by default. |
| Fade animations | Manual CSS transitions with timeouts | framer-motion `<AnimatePresence>` + `<motion.div>` | Already in the project, handles enter/exit animations cleanly. |
| Timer-based visibility | Raw setTimeout tracking | useRef + useEffect pattern | Standard React pattern, no library needed, but be careful with cleanup. |

**Key insight:** This phase requires zero new npm dependencies. Everything needed is already installed and in use. The main work is composing existing tools in new ways.

## Common Pitfalls

### Pitfall 1: playerChatMessage Missing Character Data

**What goes wrong:** The `playerChatMessage` socket event sends `{ id, message }` where `id` is the sender's socket.id. It does NOT include `name` or `isBot`. If you try to display speaker names directly from the chat event, you'll get socket IDs instead of names.

**Why it happens:** The server broadcasts chat messages with minimal data. Character metadata (name, isBot) is sent separately via the `characters` event.

**How to avoid:** In the SocketManager's `playerChatMessage` handler, look up the sender in the current `characters` array to resolve name and isBot. Fall back to a truncated socket ID if the character is not found.

**Warning signs:** Chat bubbles showing socket IDs like "wK3d7f..." instead of player names.

### Pitfall 2: Avatar.jsx Doesn't Receive Character Metadata

**What goes wrong:** The `<Avatar>` component receives `id`, `avatarUrl`, and `position` as props from Room.jsx, but does NOT currently receive `name` or `isBot`. The chat bubble enhancement needs these values.

**Why it happens:** Room.jsx maps over `characters` but only passes a subset of fields to Avatar.

**How to avoid:** Either: (a) pass `name` and `isBot` as additional props to Avatar from Room.jsx, or (b) have Avatar look up its character data from the `chatMessagesAtom` by filtering on its `id` prop.

**Warning signs:** `name` is undefined inside Avatar component.

### Pitfall 3: Chat Message Race Condition

**What goes wrong:** A `playerChatMessage` event may arrive before the `characters` event has populated the characters list (e.g., right after joining a room), resulting in unresolved sender names.

**Why it happens:** Socket events are async and don't guarantee ordering between different event types.

**How to avoid:** Use a fallback display name when character lookup fails. "Player" or a truncated socket ID both work. The name will resolve correctly for subsequent messages once characters are loaded.

**Warning signs:** First message after joining shows "Unknown" while later messages show correct names.

### Pitfall 4: Memory Leak from Uncleaned Timeouts

**What goes wrong:** The chat bubble fade timeout (3500ms in current code, ~5000ms target) and chat log auto-hide timeout can leak if the component unmounts before the timeout fires.

**Why it happens:** setTimeout callbacks run even after component unmount unless explicitly cleared.

**How to avoid:** Store timeout IDs in refs and clear them in useEffect cleanup functions. The existing code in Avatar.jsx uses a closure variable for this, which works but should be migrated to useRef for React best practices.

**Warning signs:** Console warnings about state updates on unmounted components.

### Pitfall 5: drei Html z-index Conflicts

**What goes wrong:** The `<Html>` component from drei renders DOM elements in a container that can conflict with other fixed-position UI overlays (the existing UI.jsx already warns about this with its `z-[999999999]` comment).

**Why it happens:** drei's Html uses a portal to render DOM elements alongside the Canvas, and their z-ordering can clash with other absolute/fixed positioned elements.

**How to avoid:** Give the 2D chat log panel an explicit z-index that is below the avatar creator overlay but above the drei Html elements. Use `z-10` or `z-20` for the chat log. Avoid fighting with drei's internal z-management for bubbles.

**Warning signs:** Chat log panel appearing behind 3D elements or vice versa.

## Code Examples

### Example 1: Enhanced Chat Message Atom in SocketManager

```jsx
// SocketManager.jsx additions
export const chatMessagesAtom = atom([]);

// Inside SocketManager component, add to the useEffect:
function onPlayerChatMessage(value) {
  // value = { id: socketId, message: string }
  const chars = charactersAtom.init; // Need current characters
  // Better: use a ref or subscribe pattern
  setMessages((prev) => {
    const newMessages = [...prev, {
      id: `${Date.now()}-${value.id}`,
      senderId: value.id,
      message: value.message,
      timestamp: Date.now(),
    }];
    // Keep only last 20
    return newMessages.slice(-20);
  });
}
```

**Important note:** Jotai atoms can't easily be read inside event handlers without `useAtomValue`. A practical approach is to store a ref to the current characters array and read from that ref in the event handler.

### Example 2: Chat Bubble with Speaker Name

```jsx
// In Avatar.jsx -- enhanced bubble markup
<Html position-y={2} center>
  <div className="w-60 max-w-full pointer-events-none">
    <div
      className={`text-center break-words p-2 px-4 rounded-xl
        bg-white/40 backdrop-blur-sm border border-white/20
        transition-opacity duration-500
        ${showChatBubble ? 'opacity-100' : 'opacity-0'}`}
    >
      <p className="text-[10px] font-bold text-gray-600 mb-0.5">
        {name} {isBot && <span className="text-blue-400 font-semibold">[BOT]</span>}
      </p>
      <p className="text-sm text-black leading-snug">{chatMessage}</p>
    </div>
  </div>
</Html>
```

### Example 3: 2D Chat Log Panel Component

```jsx
// ChatLog.jsx
import { useAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import { chatMessagesAtom } from "./SocketManager";

export const ChatLog = () => {
  const [messages] = useAtom(chatMessagesAtom);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef(null);

  useEffect(() => {
    if (messages.length > 0) {
      setVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 8000);
    }
    return () => clearTimeout(hideTimer.current);
  }, [messages.length]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="fixed top-4 right-4 bottom-20 w-72 z-10
            bg-gray-900/90 rounded-xl p-3 overflow-y-auto
            pointer-events-auto"
        >
          <div className="flex flex-col gap-1.5">
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <span className="font-bold text-white">
                  {msg.senderName}
                  {msg.isBot && (
                    <span className="text-blue-400 ml-1 text-xs">[BOT]</span>
                  )}
                </span>
                <span className="text-gray-300 ml-1.5">{msg.message}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

### Example 4: Passing Name and isBot to Avatar from Room.jsx

```jsx
// In Room.jsx, the characters.map section:
<Avatar
  id={character.id}
  position={gridToVector3(character.position)}
  avatarUrl={character.avatarUrl}
  name={character.name}      // ADD
  isBot={character.isBot}    // ADD
/>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| drei `<Text>` for 3D labels | drei `<Html>` for rich DOM overlays in 3D | drei v9+ | Allows full CSS/Tailwind styling in 3D-anchored content |
| React Context for shared state | Jotai atoms | Project inception | Simpler API, better performance for frequent updates |
| CSS animations for enter/exit | framer-motion `AnimatePresence` | Project inception | Declarative enter/exit animations without manual lifecycle management |

**Deprecated/outdated:**
- Nothing relevant to deprecation. The project's drei 9.75 / R3F 8.13 / three 0.153 stack is stable and all APIs used here are current.

## Open Questions

1. **Character Name Resolution Timing**
   - What we know: Characters array is populated on `roomJoined` and updated on `characters` events. Chat messages reference sender by socket ID.
   - What's unclear: Whether there's a guaranteed ordering that ensures characters are populated before the first chat message arrives.
   - Recommendation: Implement a fallback name (e.g., "Player" or truncated socket ID) for the edge case where character data hasn't arrived yet. This is a minor UX issue, not a blocker.

2. **Bubble Fade Duration**
   - What we know: Current implementation uses 3500ms. Phase requirements say ~5 seconds.
   - What's unclear: Whether 5 seconds is a hard requirement or a suggestion.
   - Recommendation: Use 5000ms to match the spec. The existing 3500ms is easy to change.

3. **Chat Log Scroll Behavior**
   - What we know: Panel shows last 20 messages.
   - What's unclear: Whether new messages should auto-scroll to bottom, or if the panel should just show newest-at-bottom with overflow scroll.
   - Recommendation: Auto-scroll to bottom on new messages. Use a ref to the bottom of the message list and call `scrollIntoView` when messages update.

## Sources

### Primary (HIGH confidence)

- **Codebase analysis** - Direct reading of all relevant source files:
  - `/Users/devgwardo/openclawworld/client/src/components/Avatar.jsx` - Existing chat bubble implementation
  - `/Users/devgwardo/openclawworld/client/src/components/SocketManager.jsx` - Socket event handling and jotai atoms
  - `/Users/devgwardo/openclawworld/client/src/components/UI.jsx` - Existing 2D overlay, chat input
  - `/Users/devgwardo/openclawworld/client/src/components/Room.jsx` - Character rendering, Avatar prop passing
  - `/Users/devgwardo/openclawworld/client/src/components/Experience.jsx` - Scene structure, camera setup
  - `/Users/devgwardo/openclawworld/client/src/App.jsx` - App structure, Canvas/UI composition
  - `/Users/devgwardo/openclawworld/server/index.js` - Server-side chat event, character data model
  - `/Users/devgwardo/openclawworld/bot/BotClient.js` - Bot socket events, isBot flag
  - `/Users/devgwardo/openclawworld/client/package.json` - Dependency versions

- **Installed packages** - Version verification via node_modules:
  - @react-three/drei 9.75.0
  - @react-three/fiber 8.13.3
  - three 0.153.0

### Secondary (MEDIUM confidence)

- drei `<Html>` component behavior verified through existing working usage in Avatar.jsx (line 144-153)
- Jotai atom patterns verified through existing usage in SocketManager.jsx and UI.jsx
- framer-motion AnimatePresence pattern verified through existing usage in UI.jsx

### Tertiary (LOW confidence)

- None. All findings are based on direct codebase analysis of installed and working code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and in active use. Zero new dependencies.
- Architecture: HIGH - Patterns directly derived from existing codebase conventions (jotai atoms, drei Html, Tailwind, framer-motion).
- Pitfalls: HIGH - Identified through direct source code analysis of data flow gaps (playerChatMessage missing name/isBot, Avatar not receiving name prop).

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (stable stack, no expected breaking changes)
