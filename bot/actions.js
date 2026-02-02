import { z } from "zod";

const MoveAction = z.object({
  type: z.literal("move"),
  target: z.array(z.number().int().min(0).max(99)).length(2),
});

const SayAction = z.object({
  type: z.literal("say"),
  message: z.string().min(1).max(200),
});

const WhisperAction = z.object({
  type: z.literal("whisper"),
  targetId: z.string().min(1),
  message: z.string().min(1).max(500),
});

const EmoteAction = z.object({
  type: z.literal("emote"),
  name: z.enum(["wave", "dance", "sit", "nod"]),
});

const LookAction = z.object({
  type: z.literal("look"),
  target: z.string().min(1),
});

const PlaceAction = z.object({
  type: z.literal("place"),
  itemName: z.string().min(1),
  gridPosition: z.array(z.number().int().min(0).max(99)).length(2),
  rotation: z.number().int().min(0).max(3).optional().default(0),
});

const EnterRoomAction = z.object({
  type: z.literal("enterRoom"),
  roomId: z.string().min(1),
});

const ClaimApartmentAction = z.object({
  type: z.literal("claimApartment"),
  roomId: z.string().min(1),
});

const ObserveAction = z.object({
  type: z.literal("observe"),
  thought: z.string().max(200).optional(),
});

const InteractAction = z.object({
  type: z.literal("interact"),
  itemName: z.string().min(1),
});

const CancelInteractionAction = z.object({
  type: z.literal("cancelInteraction"),
});

export const ActionSchema = z.discriminatedUnion("type", [
  MoveAction,
  SayAction,
  WhisperAction,
  EmoteAction,
  LookAction,
  PlaceAction,
  EnterRoomAction,
  ClaimApartmentAction,
  ObserveAction,
  InteractAction,
  CancelInteractionAction,
]);

const noopLogger = {
  info() {},
  warn() {},
  debug() {},
};

/**
 * Parse a raw LLM response into a validated action.
 * @param {string|object} raw - JSON string or parsed object
 * @returns {{ ok: true, action: object } | { ok: false, error: string }}
 */
export function parseAction(raw) {
  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Invalid JSON" };
    }
  }

  if (Array.isArray(parsed)) {
    parsed = parsed[0];
  }

  const result = ActionSchema.safeParse(parsed);

  if (result.success) {
    return { ok: true, action: result.data };
  }

  return {
    ok: false,
    error: result.error.issues[0]?.message ?? "Validation failed",
  };
}

/**
 * Execute a validated action against a BotClient.
 * @param {object} action - Validated action from parseAction
 * @param {object} botClient - BotClient instance
 * @param {object} [logger] - Pino-compatible logger
 * @returns {Promise<{ ok: true, type: string } | { ok: false, error: string }>}
 */
export async function executeAction(action, botClient, logger) {
  const log = logger || noopLogger;

  try {
    switch (action.type) {
      case "move":
        botClient.move(action.target);
        log.info({ type: "move", target: action.target });
        break;

      case "say":
        botClient.say(action.message);
        log.info({ type: "say", message: action.message });
        break;

      case "whisper":
        botClient.whisper(action.targetId, action.message);
        log.info({ type: "whisper", targetId: action.targetId, message: action.message });
        break;

      case "emote":
        if (action.name === "dance") {
          botClient.dance();
        } else {
          botClient.emote(action.name);
        }
        log.info({ type: "emote", name: action.name });
        break;

      case "look":
        log.debug(
          { type: "look", target: action.target },
          "look action logged (no server support)",
        );
        break;

      case "place":
        botClient.placeItem(action.itemName, action.gridPosition, action.rotation ?? 0);
        log.info({ type: "place", item: action.itemName, pos: action.gridPosition, rot: action.rotation });
        break;

      case "enterRoom":
        await botClient.switchRoom(action.roomId);
        log.info({ type: "enterRoom", roomId: action.roomId });
        break;

      case "claimApartment": {
        const result = await botClient.claimApartment(action.roomId);
        log.info({ type: "claimApartment", roomId: action.roomId, result });
        break;
      }

      case "observe": {
        const observation = await botClient.observe();
        log.info({ type: "observe", thought: action.thought ?? "", characters: observation.characters.length }, "observing surroundings");
        return { ok: true, type: action.type, data: observation };
      }

      case "interact":
        botClient.interact(action.itemName);
        log.info({ type: "interact", itemName: action.itemName });
        break;

      case "cancelInteraction":
        botClient.cancelInteraction();
        log.info({ type: "cancelInteraction" });
        break;
    }

    return { ok: true, type: action.type };
  } catch (err) {
    log.warn({ type: action.type, error: err.message }, "action execution failed");
    return { ok: false, error: err.message };
  }
}
