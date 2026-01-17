/**
 * Core type definitions for Naver Booking Ping system
 */

/**
 * Booking detection status
 */
export type BookingStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN';

/**
 * Check rule definition
 */
export interface CheckRule {
  name: string;
  selector: string;
  priority: number; // 1=high, 2=medium, 3=low
}

/**
 * Monitoring target
 */
export interface Target {
  id: string;
  name: string;
  urlInput: string;
  urlFinalLast: string | null;
  enabled: boolean;
  policy: string; // Rule set: "ABC", "C", etc.
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Target state tracking
 */
export interface TargetState {
  targetId: string;
  lastStatus: BookingStatus;
  lastChangedAt: Date;
  lastOpenAt: Date | null;
  consecutiveFailures: number;
  updatedAt?: Date;
}

/**
 * Check result from detector
 */
export interface CheckResult {
  status: BookingStatus;
  evidence: string[]; // Matched rule names
  finalUrl: string;
  error?: Error;
  debug?: {
    title: string;
    bookingLinks: number;
    bookingButtons: number;
  };
}

/**
 * Notification message
 */
export interface NotificationMessage {
  title: string;
  body: string;
  clickUrl: string;
}

/**
 * Check log entry
 */
export interface CheckLog {
  id: string;
  targetId: string;
  checkedAt: Date;
  status: BookingStatus;
  evidence: string; // JSON stringified array
  error?: string;
  createdAt?: Date;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  baseIntervalMs: number;
  jitterRatio: number;
}

/**
 * Ntfy configuration
 */
export interface NtfyConfig {
  serverUrl: string;
  topic: string;
  priority: 'default' | 'low' | 'high' | 'urgent';
  tags: string[];
  heartbeatTopic?: string;
}

/**
 * Browser configuration
 */
export interface BrowserConfig {
  headless: boolean;
  userAgent: string;
  timeoutMs: number;
  viewport?: { width: number; height: number };
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  path: string;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  file: string;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  ntfy: NtfyConfig;
  scheduler: SchedulerConfig;
  browser: BrowserConfig;
  database: DatabaseConfig;
  logging: LoggingConfig;
  targets?: Omit<Target, 'id'>[];
}
