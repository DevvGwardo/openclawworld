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
 * WebSocket client for the Molt's Land Gateway.
 * Handles challenge-based Ed25519 auth handshake, request/response RPC,
 * automatic reconnection with exponential backoff, and ping/pong heartbeat.
 * Includes connection pooling and health monitoring for improved performance.
 */
export class GatewayClient extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.url] - Gateway WebSocket URL
   * @param {string} [options.token] - Auth token
   * @param {string} [options.identityPath] - Path to .device-keys.json
   * @param {number} [options.heartbeatIntervalMs=15000] - Heartbeat ping interval
   * @param {number} [options.connectionTimeoutMs=10000] - Connection timeout
   * @param {number} [options.maxPoolSize=5] - Maximum connections in pool
   * @param {number} [options.maxIdleTimeMs=300000] - Max idle time before pool cleanup
   * @param {boolean} [options.enableHealthCheck=true] - Enable health monitoring
   * @param {number} [options.healthCheckIntervalMs=30000] - Health check interval
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

    // Connection pooling
    this._connectionPool = [];
    this._maxPoolSize = options.maxPoolSize ?? 5;
    this._maxIdleTimeMs = options.maxIdleTimeMs ?? 300000;
    this._poolCleanupInterval = null;
    this._connectionTimeoutMs = options.connectionTimeoutMs ?? 10000;

    // Health monitoring
    this._enableHealthCheck = options.enableHealthCheck ?? true;
    this._healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30000;
    this._healthCheckInterval = null;
    this._lastHealthCheck = null;
    this._connectionStats = {
      created: 0,
      reused: 0,
      closed: 0,
      failed: 0,
      responseTime: [],
    };

    // Reconnection state
    this._reconnectAttempt = 0;
    this._maxReconnectAttempts = 10;
    this._autoReconnect = true;
    this._reconnectTimer = null;
    this._backoff = {
      initial: 1000,
      max: 30000,
      factor: 2,
      jitter: 0.2,
    };

    // Heartbeat state
    this._alive = false;
    this._heartbeatInterval = null;
    this._heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;

    this._identity = loadOrCreateIdentity(this._identityPath);
    
    // Start pool management
    this._startPoolCleanup();
    if (this._enableHealthCheck) {
      this._startHealthMonitoring();
    }
  }

  /** @returns {boolean} Whether the client is connected and authenticated */
  get connected() {
    return this._state === "connected";
  }

  /** @returns {object} Connection statistics for monitoring */
  get connectionStats() {
    return {
      ...this._connectionStats,
      poolSize: this._connectionPool.length,
      isConnected: this.connected,
      currentState: this._state,
    };
  }

  /**
   * Get a healthy connection from the pool or create a new one
   * @returns {Promise<WebSocket>} Healthy WebSocket connection
   */
  async _getConnection() {
    // First, try to find a healthy connection in the pool
    const now = Date.now();
    const healthyConnection = this._connectionPool.find(conn => {
      return conn.readyState === WebSocket.OPEN && 
             conn._gatewayHealthy &&
             (now - conn._lastUsed) < this._maxIdleTimeMs;
    });

    if (healthyConnection) {
      healthyConnection._lastUsed = now;
      this._connectionStats.reused++;
      return healthyConnection;
    }

    // Clean up unhealthy connections
    this._cleanupPool();

    // Create new connection if pool isn't full
    if (this._connectionPool.length < this._maxPoolSize) {
      const newConnection = await this._createNewConnection();
      this._connectionPool.push(newConnection);
      this._connectionStats.created++;
      return newConnection;
    }

    // Wait for an existing connection to become available
    return this._waitForConnection();
  }

  /**
   * Create a new WebSocket connection to the Gateway
   * @returns {Promise<WebSocket>} New WebSocket connection
   */
  async _createNewConnection() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._url);
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error("Connection timeout"));
      }, this._connectionTimeoutMs);

      ws.on("open", () => {
        clearTimeout(timeout);
        ws._gatewayHealthy = true;
        ws._lastUsed = Date.now();
        ws._createdAt = Date.now();
        resolve(ws);
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        this._connectionStats.failed++;
        reject(err);
      });

      ws.on("close", () => {
        ws._gatewayHealthy = false;
        this._connectionStats.closed++;
      });

      // Health monitoring for pooled connections
      ws.on("pong", () => {
        ws._lastPong = Date.now();
        ws._gatewayHealthy = true;
      });

      ws.on("ping", () => {
        ws.pong();
      });
    });
  }

  /**
   * Wait for an available connection in the pool
   * @returns {Promise<WebSocket>} Available WebSocket connection
   */
  async _waitForConnection() {
    return new Promise((resolve, reject) => {
      const checkInterval = 100;
      const maxWait = this._connectionTimeoutMs;
      let waited = 0;

      const interval = setInterval(() => {
        const available = this._connectionPool.find(conn => 
          conn.readyState === WebSocket.OPEN && conn._gatewayHealthy
        );

        if (available) {
          clearInterval(interval);
          available._lastUsed = Date.now();
          this._connectionStats.reused++;
          resolve(available);
        }

        waited += checkInterval;
        if (waited >= maxWait) {
          clearInterval(interval);
          reject(new Error("Timeout waiting for available connection"));
        }
      }, checkInterval);
    });
  }

  /**
   * Clean up unhealthy connections from the pool
   */
  _cleanupPool() {
    const now = Date.now();
    this._connectionPool = this._connectionPool.filter(conn => {
      const isHealthy = conn.readyState === WebSocket.OPEN && 
                       conn._gatewayHealthy &&
                       (now - conn._lastUsed) < this._maxIdleTimeMs;
      
      if (!isHealthy) {
        conn.terminate();
        return false;
      }
      return true;
    });
  }

  /**
   * Start periodic pool cleanup
   */
  _startPoolCleanup() {
    if (this._poolCleanupInterval) return;
    
    this._poolCleanupInterval = setInterval(() => {
      this._cleanupPool();
    }, 60000); // Clean every minute
  }

  /**
   * Start health monitoring for pooled connections
   */
  _startHealthMonitoring() {
    if (this._healthCheckInterval) return;

    this._healthCheckInterval = setInterval(() => {
      this._performHealthCheck();
    }, this._healthCheckIntervalMs);
  }

  /**
   * Perform health check on pooled connections
   */
  _performHealthCheck() {
    const now = Date.now();
    this._lastHealthCheck = now;

    this._connectionPool.forEach(conn => {
      if (conn.readyState === WebSocket.OPEN) {
        // Check if connection responded to last ping
        if (conn._lastPong && (now - conn._lastPong) > this._heartbeatIntervalMs * 2) {
          conn._gatewayHealthy = false;
          conn.terminate();
        } else {
          // Send health check ping
          conn.ping();
        }
      } else {
        conn._gatewayHealthy = false;
      }
    });

    this._cleanupPool();
  }

  /**
   * Open a WebSocket connection and complete the auth handshake.
   * Uses connection pooling for improved performance.
   * @returns {Promise<void>} Resolves when hello-ok is received.
   */
  async connect() {
    // Re-enable auto-reconnect for fresh connections
    this._autoReconnect = true;

    // If already connecting/connected, return existing promise
    if (this._state !== "disconnected") {
      return this._connectPromise ?? Promise.resolve();
    }

    // Clean up previous WebSocket if exists
    this._cleanupWs();

    const isReconnect = this._reconnectAttempt > 0;

    this._connectPromise = new Promise(async (resolve, reject) => {
      // Only store resolve/reject for initial connect (not reconnects)
      if (!isReconnect) {
        this._connectResolve = resolve;
        this._connectReject = reject;
      }

      try {
        // Try to get a connection from pool or create new one
        this._ws = await this._getConnection();
        
        // Remove from pool if it was pooled
        this._connectionPool = this._connectionPool.filter(conn => conn !== this._ws);

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

        // Start authentication flow
        this._state = "awaiting_challenge";
        this._ws.on("open", () => {
          // Already opened via _getConnection/_createNewConnection
        });

        // For reconnects, resolve immediately (the reconnect flow is event-driven)
        if (isReconnect) {
          resolve();
        }
      } catch (err) {
        if (!isReconnect) {
          reject(err);
        }
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
   * Send an RPC request to the Gateway with connection pooling optimization.
   * @param {string} method
   * @param {object} [params={}]
   * @returns {Promise<any>} Resolves with the response payload.
   */
  async request(method, params = {}) {
    const id = String(this._nextId++);
    const startTime = Date.now();

    if (this._state !== "connected") {
      return new Promise((resolve, reject) => {
        this._queue.push({ id, method, params, resolve, reject, startTime });
      });
    }

    try {
      const result = await this._sendRequest(id, method, params);
      const responseTime = Date.now() - startTime;
      this._connectionStats.responseTime.push(responseTime);
      
      // Keep only last 100 response times for metrics
      if (this._connectionStats.responseTime.length > 100) {
        this._connectionStats.responseTime = this._connectionStats.responseTime.slice(-100);
      }
      
      return result;
    } catch (error) {
      throw error;
    }
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

    // Clear pool management intervals
    if (this._poolCleanupInterval) {
      clearInterval(this._poolCleanupInterval);
      this._poolCleanupInterval = null;
    }

    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }

    // Clean up connection pool
    this._connectionPool.forEach(conn => {
      if (conn.readyState === WebSocket.OPEN) {
        conn.close(1000);
      }
    });
    this._connectionPool = [];

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

  /**
   * Get connection health metrics
   * @returns {object} Health metrics including average response time and success rate
   */
  getHealthMetrics() {
    const responseTimes = this._connectionStats.responseTime;
    const avgResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;

    const totalAttempts = this._connectionStats.created + this._connectionStats.reused;
    const failureRate = totalAttempts > 0 
      ? this._connectionStats.failed / totalAttempts 
      : 0;

    return {
      poolSize: this._connectionPool.length,
      avgResponseTime: Math.round(avgResponseTime),
      failureRate: Math.round(failureRate * 100),
      totalConnections: this._connectionStats.created,
      reusedConnections: this._connectionStats.reused,
      closedConnections: this._connectionStats.closed,
      failedConnections: this._connectionStats.failed,
      lastHealthCheck: this._lastHealthCheck,
      isConnected: this.connected,
    };
  }
}