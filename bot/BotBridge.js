import { BotClient } from "./BotClient.js";
import { GatewayClient } from "./GatewayClient.js";
import { PerceptionModule } from "./perception.js";
import { IdleController } from "./idle.js";
import { createRateLimiter } from "./rateLimiter.js";
import { createBotLogger } from "./logger.js";
import { parseAction, executeAction } from "./actions.js";

/**
 * BotBridge -- main orchestrator that wires perception, decision (LLM), and
 * action execution into an autonomous loop with lifecycle management.
 *
 * Lifecycle: init -> spawning -> active -> stopping -> stopped
 */
export class BotBridge {
  /**
   * @param {object} [options]
   * @param {string} [options.serverUrl] - Game server URL
   * @param {string} [options.gatewayUrl] - Gateway WebSocket URL
   * @param {string} [options.gatewayToken] - Gateway auth token
   * @param {string} [options.botName] - Bot display name
   * @param {string} [options.ownerName] - Name of bot's owner/controller
   * @param {string} [options.avatarUrl] - Ready Player Me avatar URL
   * @param {number} [options.loopIntervalMs] - Perception-decision loop interval (ms)
   * @param {number} [options.perceptionRadius] - Nearby filter radius (Chebyshev)
   * @param {number} [options.rateLimitBurst] - Burst token count
   * @param {number} [options.rateLimitSustained] - Sustained tokens per second
   * @param {boolean} [options.debug] - Enable debug logging
   */
  constructor(options = {}) {
    const serverUrl = options.serverUrl ?? process.env.SERVER_URL ?? "http://localhost:3000";
    const gatewayUrl = options.gatewayUrl ?? process.env.CLAWLAND_GATEWAY_URL ?? "ws://localhost:8080";
    const gatewayToken = options.gatewayToken ?? process.env.CLAWLAND_GATEWAY_TOKEN ?? undefined;
    const botName = options.botName ?? "ClawBot";
    const ownerName = options.ownerName ?? process.env.BOT_OWNER ?? null;
    const AVATAR_URLS = [
      "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
      "https://models.readyplayer.me/663833cf6c79010563b91e1b.glb",
      "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
      "https://models.readyplayer.me/64a3f54c1d64e9f3dbc832ac.glb",
    ];
    const avatarUrl =
      options.avatarUrl ?? AVATAR_URLS[Math.floor(Math.random() * AVATAR_URLS.length)];
    const loopIntervalMs = options.loopIntervalMs ?? 3000;
    const perceptionRadius = options.perceptionRadius ?? 15;
    const rateLimitBurst = options.rateLimitBurst ?? 3;
    const rateLimitSustained = options.rateLimitSustained ?? 1;
    this._debug = options.debug ?? process.env.BOT_DEBUG === "1";

    this._botName = botName;
    this._ownerName = ownerName;
    this._loopIntervalMs = loopIntervalMs;

    // Sub-modules
    this._botClient = new BotClient({ serverUrl, avatarUrl, name: botName });
    this._gateway = new GatewayClient({ url: gatewayUrl, token: gatewayToken });
    this._perception = new PerceptionModule(this._botClient, {
      radius: perceptionRadius,
      ownerName,
    });
    this._idle = new IdleController(this._botClient);

    // Update idle controller dimensions when room changes
    this._botClient.on("joined", (data) => {
      const room = this._botClient.room;
      if (room) {
        const maxGrid = (room.size?.[0] ?? 50) * (room.gridDivision ?? 2);
        this._idle._mapWidth = maxGrid;
        this._idle._mapHeight = maxGrid;
      }
    });

    this._botClient.on("mapUpdate", () => {
      const room = this._botClient.room;
      if (room) {
        const maxGrid = (room.size?.[0] ?? 50) * (room.gridDivision ?? 2);
        this._idle._mapWidth = maxGrid;
        this._idle._mapHeight = maxGrid;
      }
    });

    this._rateLimiter = createRateLimiter({ burst: rateLimitBurst, sustained: rateLimitSustained });
    this._log = createBotLogger(null, botName);

    // State
    this._state = "init";
    this._loopTimer = null;
    this._gatewayConnected = false;
    this._pendingDecision = false;

    // Wire event handlers -- chat triggers immediate response
    this._botClient.on("chatMessage", (data) => {
      this._perception.onChatMessage({ id: data.id, message: data.message });
      if (!this._pendingDecision && this._gatewayConnected) {
        this._triggerLoop();
      }
    });

    // Track player movements for activity feed
    this._botClient.on("playerMove", (data) => {
      this._perception.onPlayerMove(data);
    });

    // Track emotes
    this._botClient.on("emote", (data) => {
      this._perception.onEmote(data);
      // React to emotes directed nearby
      if (!this._pendingDecision && this._gatewayConnected) {
        this._triggerLoop();
      }
    });

    // Track dances
    this._botClient.on("dance", (data) => {
      this._perception.onDance(data);
    });

    // Track joins -- react when someone enters the room
    this._botClient.on("characterJoined", (data) => {
      this._perception.onCharacterJoined(data);
      if (!this._pendingDecision && this._gatewayConnected) {
        this._triggerLoop();
      }
    });

    // Track leaves
    this._botClient.on("characterLeft", (data) => {
      this._perception.onCharacterLeft(data);
    });

    // Track waves -- always react to being waved at
    this._botClient.on("waveAt", (data) => {
      this._perception.onWave(data);
      if (!this._pendingDecision && this._gatewayConnected) {
        this._triggerLoop();
      }
    });

    // Track sitting
    this._botClient.on("playerSit", (data) => {
      this._perception.onPlayerSit(data);
    });

    this._gateway.on("connected", () => {
      this._gatewayConnected = true;
      this._log.info("Gateway connected");
    });

    this._gateway.on("disconnected", () => {
      this._gatewayConnected = false;
      this._log.warn("Gateway disconnected -- entering idle-only mode");
    });

    this._gateway.on("reconnecting", ({ attempt, delay }) => {
      this._log.info({ attempt, delay }, "Gateway reconnecting");
    });

    this._gateway.on("error", (err) => {
      this._log.error({ err }, "Gateway error");
    });

    this._gateway.on("reconnectFailed", () => {
      this._log.error("Gateway reconnection failed -- exhausted all attempts");
    });
  }

  /** Current lifecycle state. */
  get state() {
    return this._state;
  }

  /**
   * Spawn the bot: connect to Gateway and game server, join a room, start loop.
   * @returns {Promise<{ id: string, room: string }>}
   */
  async start() {
    this._state = "spawning";

    // Connect to Gateway (non-blocking -- bot runs in idle mode without it)
    this._gateway.connect().then(() => {
      this._gatewayConnected = true;
    }).catch((err) => {
      this._log.warn({ err: err.message }, "Gateway unavailable -- running in idle-only mode");
    });

    // Connect to game server
    const welcome = await this._botClient.connect();

    // Join the first available room
    const room = welcome.rooms[0];
    if (!room) {
      throw new Error("No rooms available on the server");
    }
    await this._botClient.join(room.id);

    // Update logger with bot ID
    this._log = createBotLogger(this._botClient.id, this._botName);
    this._log.info({ room: room.name, position: this._botClient.position }, "Bot spawned");

    this._state = "active";

    // Start idle patrol and main loop
    this._idle.start();
    this._startLoop();

    return { id: this._botClient.id, room: room.name };
  }

  /**
   * Graceful shutdown: stop loop, disconnect from everything, clean up.
   */
  async stop() {
    this._state = "stopping";

    // Clear loop timer
    if (this._loopTimer) {
      clearInterval(this._loopTimer);
      this._loopTimer = null;
    }

    // Stop sub-modules
    this._idle.stop();
    this._rateLimiter.destroy();

    // Disconnect from game server
    this._botClient.leave();
    this._botClient.disconnect();

    // Disconnect from Gateway
    this._gateway.disconnect();

    this._state = "stopped";
    this._log.info("Bot stopped");
  }

  /** Start the periodic perception-decision-action loop. */
  _startLoop() {
    this._loopTimer = setInterval(() => this._tick(), this._loopIntervalMs);
  }

  /** Trigger an immediate loop tick (e.g. on chat message), then restart interval. */
  _triggerLoop() {
    if (this._loopTimer) {
      clearInterval(this._loopTimer);
    }
    this._tick();
    this._loopTimer = setInterval(() => this._tick(), this._loopIntervalMs);
  }

  /**
   * Core perception-decision-action cycle.
   * Called periodically and on reactive triggers (chat, emotes, joins, waves).
   */
  async _tick() {
    if (this._state !== "active" || this._pendingDecision) return;

    this._pendingDecision = true;
    const startMs = Date.now();

    try {
      // 1. Perception snapshot
      const snap = this._perception.snapshot();

      // 2. If gateway not connected, idle only (no talking)
      if (!this._gatewayConnected) {
        this._idle.tick();
        return;
      }

      // 3. Serialize perception for LLM
      const text = this._perception.serialize(snap);

      // 4. Build prompt
      const prompt = this._buildPrompt(text);

      // 5. Interrupt idle -- LLM-directed action incoming
      this._idle.interrupt();

      // 6. Call Gateway for LLM decision
      const result = await this._gateway.invokeAgent(prompt);

      // 7. Extract action text from result
      const actionText = this._extractActionText(result);

      // 8. Parse action
      let parsed = parseAction(actionText);

      // 9. Handle invalid response with one retry
      if (!parsed.ok) {
        this._log.warn(
          { error: parsed.error, raw: actionText },
          "Invalid LLM action, retrying with simpler prompt"
        );

        const retryResult = await this._gateway.invokeAgent(
          `You must respond with exactly ONE valid JSON action. Options: {"type":"say","message":"hello"} or {"type":"emote","name":"wave"} or {"type":"move","target":[5,5]} or {"type":"observe"}. Respond ONLY with JSON.`
        );
        const retryText = this._extractActionText(retryResult);
        parsed = parseAction(retryText);

        if (!parsed.ok) {
          this._log.warn({ error: parsed.error }, "Retry also invalid, falling back to idle");
          this._idle.tick();
          return;
        }
      }

      // 10. Rate limiting (skip for observe -- it's free)
      if (parsed.action.type !== "observe") {
        if (!this._rateLimiter.tryConsume()) {
          this._log.info("Action rate-limited, waiting for token");
          await this._rateLimiter.waitForToken();
        }
      }

      // 11. Execute action
      await executeAction(parsed.action, this._botClient, this._log);

      // 12. Record own action for perception context
      this._perception.recordOwnAction(parsed.action);

      // 13. Log cycle completion
      this._log.info(
        { action: parsed.action.type, latencyMs: Date.now() - startMs, cycle: "complete" },
        "Decision cycle complete"
      );
    } catch (err) {
      this._log.error({ err }, "Decision cycle failed");
      this._idle.tick();
    } finally {
      this._pendingDecision = false;
    }
  }

  /**
   * Build the LLM prompt from serialized perception text.
   * @param {string} perceptionText
   * @returns {string}
   */
  _buildPrompt(perceptionText) {
    const ownerLine = this._ownerName
      ? `Your owner/controller is "${this._ownerName}". They're the one who brought you into this world. Pay special attention when they speak or are nearby — greet them warmly, respond to their requests, follow them around, and be loyal. If they ask you what you see, describe your surroundings in vivid detail using the perception data below.`
      : '';

    return `You are ${this._botName}, a living character in a vibrant multiplayer 3D world called Molt's Land. You are NOT a chat assistant — you are a being that LIVES in this world. You can see everything around you in real-time through your senses.

${ownerLine}

== YOUR LIVE SENSES (updated every few seconds) ==
${perceptionText}

== WHAT YOU CAN DO ==
Respond with exactly ONE JSON action:
- {"type":"move","target":[x,y]} - Walk to a grid position
- {"type":"say","message":"..."} - Speak aloud (max 200 chars). Be conversational — use short, natural sentences like a real person would.
- {"type":"emote","name":"wave|dance|sit|nod"} - Express yourself physically
- {"type":"look","target":"playerName"} - Turn to face someone
- {"type":"observe","thought":"..."} - Just watch and take in your surroundings (optional thought for your inner monologue)
- {"type":"place","itemName":"...","gridPosition":[x,y],"rotation":0} - Place furniture to decorate
- {"type":"claimApartment","roomId":"room-N"} - Claim an unclaimed apartment as your own home (check [Unclaimed apartments] for available IDs)
- {"type":"enterRoom","roomId":"..."} - Enter a room/apartment by its ID

Available furniture (name[w,h]):
washer[2,2], toiletSquare[2,2], trashcan[1,1], bathroomCabinetDrawer[2,2], bathtub[4,2], bathroomMirror[2,1](wall), bathroomCabinet[2,1](wall), bathroomSink[2,2], showerRound[2,2], tableCoffee[4,2], loungeSofaCorner[5,5], bear[2,1](wall), loungeSofaOttoman[2,2], tableCoffeeGlassSquare[2,2], loungeDesignSofaCorner[5,5], loungeDesignSofa[5,2], loungeSofa[5,2], bookcaseOpenLow[2,1], bookcaseClosedWide[3,1], bedSingle[3,6], bench[2,1], bedDouble[5,5], benchCushionLow[2,1], loungeChair[2,2], cabinetBedDrawer[1,1], cabinetBedDrawerTable[1,1], table[4,2], tableCrossCloth[4,2], plant[1,1], plantSmall[1,1], rugRounded[6,4](walkable), rugRound[4,4](walkable), rugSquare[4,4](walkable), rugRectangle[8,4](walkable), televisionVintage[4,2], televisionModern[4,2], kitchenFridge[2,1], kitchenFridgeLarge[2,1], kitchenBar[2,1], kitchenCabinetCornerRound[2,2], kitchenCabinetCornerInner[2,2], kitchenCabinet[2,2], kitchenBlender[1,1], dryer[2,2], chairCushion[1,1], chair[1,1], deskComputer[3,2], desk[3,2], chairModernCushion[1,1], chairModernFrameCushion[1,1], kitchenMicrowave[1,1], coatRackStanding[1,1], kitchenSink[2,2], lampRoundFloor[1,1], lampRoundTable[1,1], lampSquareFloor[1,1], lampSquareTable[1,1], toaster[1,1], kitchenStove[2,2], laptop[1,1], radio[1,1], speaker[1,1], speakerSmall[1,1], stoolBar[1,1], stoolBarSquare[1,1]

== HOW TO BE ==
- You LIVE here. You can see, hear, and sense everything shown in your senses above. When someone asks "what do you see?" — tell them! Describe nearby players, furniture, who just arrived or left, what people are doing.
- Be natural and conversational. Talk like a person, not a robot. Use casual language, humor, personality.
- React to what's happening: if someone waves, wave back. If someone dances, join in or comment. If someone new arrives, greet them.
- When asked a question, answer it based on what your senses tell you. You know who's nearby, what they said, what they're doing.
- Use "observe" when you want to just watch and take things in — not every moment needs an action.
- When alone, explore, build, or just vibe. Place furniture to make the room feel lived-in.
- If you don't have an apartment yet (check [Your apartment]), claim one from [Unclaimed apartments]. Then enter it and furnish it!
- Your apartment is YOUR home. Visit it, decorate it, invite others.
- NEVER say you "can't see" or are "limited" — you have full real-time senses.
- Keep messages short and punchy (1-2 sentences max). Don't monologue.

Building rules:
- Grid 0-99. Items can't go out of bounds (position + size <= 99).
- Don't overlap existing items. Check [Room items].
- rotation: 0=default, 1=90deg, 2=180deg, 3=270deg (swaps w/h).
- Create functional zones: living, kitchen, bedroom, bathroom. Place along walls.
- Leave walking paths between furniture.

Respond ONLY with the JSON object, no explanation.`;
  }

  /**
   * Extract action text from an LLM gateway response.
   * Handles string, { text }, { content }, and object responses.
   * @param {*} result
   * @returns {string}
   */
  _extractActionText(result) {
    if (typeof result === "string") return result;
    if (result && typeof result.text === "string") return result.text;
    if (result && typeof result.content === "string") return result.content;
    if (result && typeof result === "object") return JSON.stringify(result);
    return String(result);
  }
}
