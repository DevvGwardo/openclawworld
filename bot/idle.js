/**
 * IdleController -- autonomous patrol behavior for when the bot has no LLM task.
 * Generates random waypoints and moves the bot around the map.
 */
export class IdleController {
  /**
   * @param {object} botClient - BotClient instance (reads .position, calls .move())
   * @param {object} [options]
   * @param {number} [options.mapWidth=15] - Grid width
   * @param {number} [options.mapHeight=15] - Grid height
   * @param {number} [options.patrolIntervalMs=5000] - Re-tick interval for stuck detection
   * @param {number} [options.arrivalThreshold=1] - Chebyshev distance to consider "arrived"
   */
  constructor(botClient, options = {}) {
    this._botClient = botClient;
    this._mapWidth = options.mapWidth ?? 15;
    this._mapHeight = options.mapHeight ?? 15;
    this._patrolIntervalMs = options.patrolIntervalMs ?? 5000;
    this._arrivalThreshold = options.arrivalThreshold ?? 1;

    this._currentWaypoint = null;
    this._patrolTimer = null;
    this._active = false;
  }

  /** Whether idle patrol is currently active. */
  get isActive() {
    return this._active;
  }

  /** Activate idle patrol. Picks first waypoint and starts timer. */
  start() {
    this._active = true;
    this._currentWaypoint = null;
    this.tick();
    this._startTimer();
  }

  /** Deactivate idle patrol. Clears timer. */
  stop() {
    this._active = false;
    this._currentWaypoint = null;
    this._clearTimer();
  }

  /**
   * Called each loop iteration. Checks arrival and issues new move if needed.
   */
  tick() {
    if (!this._active) return;

    const pos = this._botClient.position;
    if (!pos) return;

    if (this._currentWaypoint && !this._hasArrived(pos, this._currentWaypoint)) {
      // Still walking toward waypoint
      return;
    }

    // Arrived or no waypoint -- pick a new one
    this._currentWaypoint = this._pickWaypoint(pos);
    this._botClient.move(this._currentWaypoint);
  }

  /**
   * Called when an LLM response arrives. Clears current waypoint so patrol
   * picks a fresh one on next tick. Does NOT deactivate patrol.
   */
  interrupt() {
    this._currentWaypoint = null;
    this._clearTimer();
    this._startTimer();
  }

  /**
   * Pick a random waypoint avoiding edges and at least 3 units from current position.
   * @param {number[]} currentPos
   * @returns {number[]}
   */
  _pickWaypoint(currentPos) {
    const minX = 1;
    const maxX = this._mapWidth - 2;
    const minY = 1;
    const maxY = this._mapHeight - 2;

    for (let i = 0; i < 5; i++) {
      const x = minX + Math.floor(Math.random() * (maxX - minX + 1));
      const y = minY + Math.floor(Math.random() * (maxY - minY + 1));
      const dist = Math.max(
        Math.abs(x - currentPos[0]),
        Math.abs(y - currentPos[1]),
      );
      if (dist >= 3) {
        return [x, y];
      }
    }

    // Fallback: any valid position
    const x = minX + Math.floor(Math.random() * (maxX - minX + 1));
    const y = minY + Math.floor(Math.random() * (maxY - minY + 1));
    return [x, y];
  }

  /**
   * Check if position is within arrivalThreshold of target (Chebyshev distance).
   * @param {number[]} pos
   * @param {number[]} target
   * @returns {boolean}
   */
  _hasArrived(pos, target) {
    const dist = Math.max(
      Math.abs(pos[0] - target[0]),
      Math.abs(pos[1] - target[1]),
    );
    return dist <= this._arrivalThreshold;
  }

  _startTimer() {
    this._clearTimer();
    this._patrolTimer = setInterval(() => this.tick(), this._patrolIntervalMs);
  }

  _clearTimer() {
    if (this._patrolTimer) {
      clearInterval(this._patrolTimer);
      this._patrolTimer = null;
    }
  }
}
