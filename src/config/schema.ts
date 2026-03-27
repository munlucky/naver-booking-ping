/**
 * Configuration schema validation using Zod
 */

import { z } from 'zod';

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Ntfy configuration schema
 */
export const NtfyConfigSchema = z.object({
  serverUrl: z.string().url().default('https://ntfy.sh'),
  topic: z.string().min(1),
  priority: z.enum(['default', 'low', 'high', 'urgent']).default('high'),
  tags: z.array(z.string()).default(['bell', 'calendar']),
});

/**
 * Scheduler configuration schema
 */
export const SchedulerConfigSchema = z.object({
  baseIntervalMs: z.number().positive().default(60000),
  jitterRatio: z.number().min(0).max(1).default(0.3),
  backoffSteps: z.array(z.number().positive()).default([120000, 300000, 600000]),
});

/**
 * Browser configuration schema
 */
export const BrowserConfigSchema = z.object({
  headless: z.boolean().default(true),
  userAgent: z.string().default(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ),
  timeoutMs: z.number().positive().default(30000),
  locale: z.string().default('ko-KR'),
  timezoneId: z.string().default('Asia/Seoul'),
  storageStatePath: z.string().default('./data/browser-storage-state.json'),
  channel: z.string().optional(),
  launchArgs: z.array(z.string()).default([
    '--disable-blink-features=AutomationControlled',
    '--lang=ko-KR',
  ]),
  stealth: z.boolean().default(true),
});

/**
 * Database configuration schema
 */
export const DatabaseConfigSchema = z.object({
  path: z.string().default('./data/booking-ping.db'),
});

/**
 * Logging configuration schema
 */
export const LoggingConfigSchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
  file: z.string().default('./logs/app.log'),
});

const LegacyNaverBookingTargetConfigSchema = z.object({
  name: z.string().min(1),
  urlInput: z.string().url(),
  urlFinalLast: z.string().url().optional(),
  enabled: z.boolean().default(true),
  policy: z.string().default('ABC'),
}).transform((data) => ({
  kind: 'naver-booking' as const,
  ...data,
}));

const NaverBookingTargetConfigSchema = z.object({
  kind: z.literal('naver-booking'),
  name: z.string().min(1),
  urlInput: z.string().url(),
  urlFinalLast: z.string().url().optional(),
  enabled: z.boolean().default(true),
  policy: z.string().default('ABC'),
});

const FlightPriceQuerySchema = z.object({
  origin: z.string().length(3).transform((value) => value.toUpperCase()),
  destination: z.string().length(3).transform((value) => value.toUpperCase()),
  departureDate: DateStringSchema,
  returnDate: DateStringSchema.optional(),
  adults: z.number().int().positive().default(1),
  children: z.number().int().min(0).default(0),
  cabinClass: z.enum(['economy', 'premium-economy', 'business', 'first']).default('economy'),
  directOnly: z.boolean().default(false),
  airlines: z.array(z.string().min(2).max(3).transform((value) => value.toUpperCase())).default([]),
  currency: z.string().length(3).transform((value) => value.toUpperCase()).default('KRW'),
});

const FlightPriceTargetConfigSchema = z.object({
  kind: z.literal('flight-price'),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  provider: z.enum(['skyscanner']).default('skyscanner'),
  urlInput: z.string().url().optional(),
  urlFinalLast: z.string().url().optional(),
  priceQuery: FlightPriceQuerySchema,
});

/**
 * Target configuration schema (from config file)
 */
export const TargetConfigSchema = z.union([
  FlightPriceTargetConfigSchema,
  NaverBookingTargetConfigSchema,
  LegacyNaverBookingTargetConfigSchema,
]);

/**
 * Complete application configuration schema
 */
export const AppConfigSchema = z.object({
  ntfy: NtfyConfigSchema,
  scheduler: SchedulerConfigSchema,
  browser: BrowserConfigSchema,
  database: DatabaseConfigSchema,
  logging: LoggingConfigSchema,
  targets: z.array(TargetConfigSchema).optional(),
});

export type AppConfigInput = z.infer<typeof AppConfigSchema>;
