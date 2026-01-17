/**
 * Scheduler with jitter support
 */

import type { SchedulerConfig } from '../types/index.js';

/**
 * Scheduler interface
 */
export interface Scheduler {
  start(callback: () => Promise<void>): void;
  stop(): void;
  updateInterval(intervalMs: number): void;
}

/**
 * Jitter scheduler implementation (no backoff)
 */
export class JitterScheduler implements Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private currentCallback: (() => Promise<void>) | null = null;
  private isCallbackRunning: boolean = false; // Prevent concurrent executions

  constructor(private config: SchedulerConfig) {}

  /**
   * Start the scheduler with a callback
   */
  start(callback: () => Promise<void>): void {
    this.isRunning = true;
    this.currentCallback = callback;
    this.scheduleNext(callback);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Update the polling interval dynamically
   * Only reschedules if callback is not currently running
   */
  updateInterval(intervalMs: number): void {
    // Update the base interval
    this.config.baseIntervalMs = intervalMs;

    // Only reschedule if not currently running a callback
    if (this.isRunning && this.timer && !this.isCallbackRunning) {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.currentCallback) {
        this.scheduleNext(this.currentCallback);
      }
    }
    // If callback is running, it will use the new interval when it completes
  }

  /**
   * Schedule next execution with jitter
   */
  private scheduleNext(callback: () => Promise<void>): void {
    if (!this.isRunning) {
      return;
    }

    const delay = this.calculateDelay();

    this.timer = setTimeout(async () => {
      // Prevent concurrent execution
      if (this.isCallbackRunning) {
        console.warn('[Scheduler] Callback already running, skipping duplicate execution');
        // Reschedule for later
        if (this.isRunning) {
          this.scheduleNext(callback);
        }
        return;
      }

      this.isCallbackRunning = true;
      try {
        await callback();
      } catch (error) {
        console.error('[Scheduler] Callback error:', error);
      } finally {
        this.isCallbackRunning = false;
      }

      // Schedule next run
      if (this.isRunning) {
        this.scheduleNext(callback);
      }
    }, delay);
  }

  /**
   * Calculate delay with jitter only (no backoff)
   */
  private calculateDelay(): number {
    const { baseIntervalMs, jitterRatio } = this.config;

    // Apply jitter: delay * (1 ± jitterRatio)
    const jitterRange = baseIntervalMs * jitterRatio;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitter to +jitter
    const delay = Math.floor(baseIntervalMs + jitter);

    return Math.max(delay, 1000); // Minimum 1 second
  }
}

/**
 * Create a new scheduler
 */
export function createScheduler(config: SchedulerConfig): Scheduler {
  return new JitterScheduler(config);
}
