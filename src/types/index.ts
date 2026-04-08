/**
 * Core type definitions for Naver Booking Ping system
 */

/**
 * Monitor status
 */
export type BookingStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN';

/**
 * Supported monitoring target kinds
 */
export type TargetKind = 'naver-booking' | 'flight-price';

/**
 * Supported flight providers
 */
export type FlightProvider = 'skyscanner';

/**
 * Check rule definition
 */
export interface CheckRule {
  name: string;
  selector: string;
  priority: number; // 1=high, 2=medium, 3=low
}

interface BaseTarget {
  id: string;
  kind: TargetKind;
  name: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Naver booking monitoring target
 */
export interface NaverBookingTarget extends BaseTarget {
  kind: 'naver-booking';
  urlInput: string;
  urlFinalLast: string | null;
  policy: string; // Rule set: "ABC", "C", etc.
}

/**
 * Flight price query
 */
export interface FlightPriceQuery {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string | null; // YYYY-MM-DD
  adults: number;
  children?: number;
  cabinClass?: 'economy' | 'premium-economy' | 'business' | 'first';
  directOnly?: boolean;
  airlines?: string[];
  currency?: string;
}

/**
 * Flight price monitoring target
 */
export interface FlightPriceTarget extends BaseTarget {
  kind: 'flight-price';
  urlInput: string;
  urlFinalLast: string | null;
  provider: FlightProvider;
  priceQuery: FlightPriceQuery;
}

/**
 * Monitoring target union
 */
export type Target = NaverBookingTarget | FlightPriceTarget;

/**
 * Config-defined target before persistence
 */
export type ConfiguredTarget =
  | Omit<NaverBookingTarget, 'id'>
  | (Omit<FlightPriceTarget, 'id' | 'urlInput'> & {
      urlInput?: string;
    });

/**
 * Persisted target payload before ID generation
 */
export type NewTarget = Omit<NaverBookingTarget, 'id'> | Omit<FlightPriceTarget, 'id'>;

/**
 * Target state tracking
 */
export interface TargetState {
  targetId: string;
  lastStatus: BookingStatus;
  lastChangedAt: Date;
  lastOpenAt: Date | null;
  consecutiveFailures: number;
  lastObservedValue: number | null;
  bestObservedValue: number | null;
  lastNotifiedFingerprint: string | null;
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
  screenshotPath?: string;
  observedValue?: number | null;
  observedCurrency?: string | null;
  shouldNotify?: boolean;
  notificationKey?: string | null;
  notification?: NotificationMessage;
  details?: Record<string, string | number | boolean | null>;
  debug?: {
    title: string;
    bookingLinks: number;
    bookingButtons: number;
    matchedRule?: string;
    matchedText?: string;
    matchedHref?: string | null;
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
  details?: string; // JSON stringified object
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
  locale?: string;
  timezoneId?: string;
  storageStatePath?: string;
  channel?: string;
  launchArgs?: string[];
  stealth?: boolean;
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
  targets?: ConfiguredTarget[];
}
