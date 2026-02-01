import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import WebSocket from "ws";
import {
  loadOrCreateIdentity,
  buildAuthPayload,
  signPayload,
  saveDeviceToken,
} from "./DeviceIdentity.js";

/**
 * WebSocket client for the Claw Land Gateway.
 * Handles challenge-based Ed25519 auth handshake, request/response RPC,
 * automatic reconnection with exponential backoff, and ping/pong heartbeat.
 */
export class GatewayClient extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.url] - Gateway WebSocket URL
   * @param {string} [options.token] - Auth token
   * @param {string} [options.identityPath] - Path to .device-keys.json
   * @param {number} [options.heartbeatIntervalMs=15000] - Heartbeat ping interval
   */
  constructor(options = {}) {
    super();
    this._url = options.url ?? process.env.CLAWLAND_GATEWAY_URL ?? "ws://localhost:8080";
    this._token = options.token ?? process.env.CLAWLAND_GATEWAY_TOKEN ?? undefined;
    this._identityPath =
      options.identityPath ?? new URL(".device-keys.json", import.meta.url).pathname;

    this._state = "disconnected";
    this._pending = new Map();
    this._queue = [];
    this._nextId = 1;
    this._ws = null;
    this._connectPromise = null;

    // Reconnection state
    this._reconnectAttempt = 0;
    this._maxReconnectAttempts = 10;
    this._autoReconnect = true;
    this._reconnectTimer = null;
    this._backoff = {
      initial: 1000,
      max: 30000,
      factor: 2,
      jitter: 0.2, // 0-20% random jitter
    };

    // Heartbeat state
    this._alive = false;
    this._heartbeatInterval = null;
    this._heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;

    this._identity = loadOrCreateIdentity(this._identityPath);
  }

  /** @returns {boolean} Whether the client is connected and authenticated */
  get connected() {
    return this._state === "connected";
  }

  /**
   * Open a WebSocket connection and complete the auth handshake.
   * @returns {Promise<void>} Resolves when hello-ok is received.
   */
  connect() {
    // Re-enable auto-reconnect for fresh connections
    this._autoReconnect = true;

    // If already connecting/connected, return existing promise
    if (this._state !== "disconnected") {
      return this._connectPromise ?? Promise.resolve();
    }

    // Clean up previous WebSocket if exists
    this._cleanupWs();

    const isReconnect = this._reconnectAttempt > 0;

    this._connectPromise = new Promise((resolve, reject) => {
      // Only store resolve/reject for initial connect (not reconnects)
      if (!isReconnect) {
        this._connectResolve = resolve;
        this._connectReject = reject;
      }

      this._ws = new WebSocket(this._url);

      this._ws.on("open", () => {
        this._state = "awaiting_challenge";
      });

      this._ws.on("message", (raw) => {
        this._handleMessage(raw);
      });

      this._ws.on("pong", () => {
        this._alive = true;
      });

      this._ws.on("close", (code, reason) => {
        const wasConnecting = this._state !== "connected" && this._state !== "disconnected";
        this._state = "disconnected";

        // Clear heartbeat
        this._clearHeartbeat();

        // Reject all pending requests so callers do not hang
        this._rejectAllPending("WebSocket closed");

        this.emit("disconnected", { code, reason: reason?.toString() });

        if (wasConnecting && !isReconnect) {
          reject(new Error(`WebSocket closed during auth (code ${code})`));
        }

        // Auto-reconnect on non-intentional close
        if (code !== 1000 && this._autoReconnect) {
          this._scheduleReconnect();
        }
      });

      this._ws.on("error", (err) => {
        this.emit("error", err);
        if (this._state !== "connected" && !isReconnect) {
          reject(err);
        }
      });

      // For reconnects, resolve immediately (the reconnect flow is event-driven)
      if (isReconnect) {
        resolve();
      }
    });

    return this._connectPromise;
  }

  /**
   * Remove listeners and terminate previous WebSocket if still open.
   */
  _cleanupWs() {
    if (this._ws) {
      this._ws.removeAllListeners();
      if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
        this._ws.terminate();
      }
      this._ws = null;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  _scheduleReconnect() {
    if (!this._autoReconnect) return;

    if (this._reconnectAttempt >= this._maxReconnectAttempts) {
      this.emit("reconnectFailed");
      return;
    }

    const { initial, max, factor, jitter } = this._backoff;
    const baseDelay = Math.min(initial * Math.pow(factor, this._reconnectAttempt), max);
    const jitterMs = Math.floor(baseDelay * jitter * Math.random());
    const delay = baseDelay + jitterMs;

    this._reconnectAttempt++;
    this.emit("reconnecting", { attempt: this._reconnectAttempt, delay });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Start the ping/pong heartbeat interval.
   * Called after successful authentication (hello-ok).
   */
  _startHeartbeat() {
    this._clearHeartbeat();
    this._alive = true;

    this._heartbeatInterval = setInterval(() => {
      if (!this._alive) {
        // Peer did not respond to last ping -- connection is stale
        this._ws.terminate(); // triggers close event -> reconnect
        return;
      }
      this._alive = false;
      this._ws.ping();
    }, this._heartbeatIntervalMs);
  }

  /**
   * Clear the heartbeat interval.
   */
  _clearHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  /**
   * Route an incoming message based on the current auth state.
   * @param {Buffer|string} raw
   */
  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      this.emit("error", new Error("Failed to parse Gateway message"));
      return;
    }

    switch (this._state) {
      case "awaiting_challenge":
        if (msg.type === "event" && msg.event === "connect.challenge") {
          this._respondToChallenge(msg.payload);
        }
        break;

      case "awaiting_hello":
        if (msg.type === "res" && msg.id === "0") {
          if (msg.ok) {
            // Save device token if provided
            const deviceToken = msg.payload?.auth?.deviceToken;
            if (deviceToken && deviceToken !== this._identity.deviceToken) {
              this._identity.deviceToken = deviceToken;
              saveDeviceToken(this._identityPath, this._identity);
            }
            this._state = "connected";

            // Reset reconnect counter on successful auth
            this._reconnectAttempt = 0;

            // Start heartbeat monitoring
            this._startHeartbeat();

            this.emit("connected", msg.payload);
            this._flushQueue();
            this._connectResolve?.();
          } else {
            const errMsg = msg.error?.message ?? "Auth rejected by Gateway";
            this._connectReject?.(new Error(errMsg));
          }
        }
        break;

      case "connected":
        if (msg.type === "res") {
          this._handleResponse(msg);
        } else if (msg.type === "event") {
          this.emit(msg.event, msg.payload);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Sign the challenge nonce and send the connect request.
   * @param {{ nonce: string, ts: number }} param0
   */
  _respondToChallenge({ nonce, ts }) {
    const publicKeyPem = this._identity.publicKey.export({
      type: "spki",
      format: "pem",
    });

    const clientId = "gateway-client";
    const clientMode = "backend";
    const role = "operator";
    const signedAt = Date.now();

    // Build the structured payload the Gateway expects to verify
    const payload = buildAuthPayload({
      deviceId: this._identity.fingerprint,
      clientId,
      clientMode,
      role,
      scopes: [],
      signedAtMs: signedAt,
      token: this._token ?? null,
      nonce,
    });

    const signature = signPayload(payload, this._identity.privateKey);

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: "0.1.0",
        platform: process.platform,
        mode: clientMode,
      },
      role,
      auth: {
        token: this._token,
      },
      device: {
        id: this._identity.fingerprint,
        publicKey: publicKeyPem,
        signature,
        signedAt,
        nonce,
      },
    };

    const frame = {
      type: "req",
      id: "0",
      method: "connect",
      params,
    };

    this._ws.send(JSON.stringify(frame));
    this._state = "awaiting_hello";
  }

  /**
   * Send an RPC request to the Gateway.
   * @param {string} method
   * @param {object} [params={}]
   * @returns {Promise<any>} Resolves with the response payload.
   */
  request(method, params = {}) {
    const id = String(this._nextId++);

    if (this._state !== "connected") {
      return new Promise((resolve, reject) => {
        this._queue.push({ id, method, params, resolve, reject });
      });
    }

    return this._sendRequest(id, method, params);
  }

  /**
   * Internal: send a request frame and track in the pending map.
   * @returns {Promise<any>}
   */
  _sendRequest(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${id} (${method}) timed out after 30s`));
      }, 30_000);

      this._pending.set(id, { resolve, reject, timer });

      this._ws.send(
        JSON.stringify({ type: "req", id, method, params })
      );
    });
  }

  /**
   * Route a response to its pending request.
   * @param {{ id: string, ok: boolean, payload?: any, error?: { message: string } }} msg
   */
  _handleResponse(msg) {
    const entry = this._pending.get(msg.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this._pending.delete(msg.id);

    if (msg.ok) {
      entry.resolve(msg.payload);
    } else {
      entry.reject(new Error(msg.error?.message ?? "Request failed"));
    }
  }

  /**
   * Send all queued requests that were waiting for authentication.
   */
  _flushQueue() {
    const queued = this._queue.splice(0);
    for (const { id, method, params, resolve, reject } of queued) {
      this._sendRequest(id, method, params).then(resolve, reject);
    }
  }

  /**
   * Two-step agent invocation: agent + agent.wait.
   * @param {string} prompt - Message to send to the LLM
   * @param {object} [options]
   * @param {number} [options.timeoutMs=60000] - How long to wait for agent completion
   * @returns {Promise<any>} The agent result payload
   */
  async invokeAgent(prompt, options = {}) {
    const idempotencyKey = crypto.randomUUID();
    const { runId } = await this.request("agent", {
      message: prompt,
      idempotencyKey,
      ...options,
    });
    const result = await this.request("agent.wait", {
      runId,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    return result;
  }

  /**
   * Gracefully disconnect from the Gateway.
   * Disables auto-reconnect before closing to prevent reconnection loops.
   */
  disconnect() {
    this._autoReconnect = false;

    // Cancel any scheduled reconnect
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Clear heartbeat
    this._clearHeartbeat();

    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.close(1000);
    }

    this._state = "disconnected";
    this._rejectAllPending("Client disconnected");
    this._reconnectAttempt = 0;
  }

  /**
   * Reject all pending requests with the given reason.
   * @param {string} reason
   */
  _rejectAllPending(reason) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this._pending.clear();

    const queued = this._queue.splice(0);
    for (const { reject } of queued) {
      reject(new Error(reason));
    }
  }
}
