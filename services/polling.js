/**
 * ApexLens - Polling Service
 * Continuously monitors Salesforce for new Apex logs
 */

export class PollingService {
  constructor(api, intervalMs = 5000) {
    this.api = api;
    this.intervalMs = intervalMs;
    this.timerId = null;
    this.lastTimestamp = new Date().toISOString();
    this.seenIds = new Set();
    this.running = false;
    this._onNewLogs = null;
    this._onError = null;
    this.consecutiveErrors = 0;
    this.MAX_ERRORS = 5;
  }

  onNewLogs(callback) { this._onNewLogs = callback; }
  onError(callback) { this._onError = callback; }

  start() {
    if (this.running) return;
    this.running = true;
    this.poll(); // Immediate first poll
    this.timerId = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  setInterval(ms) {
    this.intervalMs = ms;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  async poll() {
    if (!this.running) return;
    try {
      const logs = await this.api.getLogsSince(
        new Date(Date.parse(this.lastTimestamp) - 2000).toISOString() // 2s overlap to avoid missing
      );

      const newLogs = logs.filter(log => !this.seenIds.has(log.Id));

      if (newLogs.length > 0) {
        newLogs.forEach(log => this.seenIds.add(log.Id));
        this.lastTimestamp = newLogs[0].LastModifiedDate; // most recent first
        this._onNewLogs && this._onNewLogs(newLogs);
      }

      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.MAX_ERRORS) {
        this.stop();
        this._onError && this._onError(err);
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      interval: this.intervalMs,
      seenCount: this.seenIds.size,
      lastPoll: this.lastTimestamp,
      errors: this.consecutiveErrors
    };
  }
}
