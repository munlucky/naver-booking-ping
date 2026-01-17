/**
 * Configuration schema validation using Zod
 */

import { z } from 'zod';

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

/**
 * Target configuration schema (from config file)
 */
export const TargetConfigSchema = z.object({
  name: z.string().min(1),
  urlInput: z.string().url(),
  urlFinalLast: z.string().url().optional(),
  enabled: z.boolean().default(true),
  policy: z.string().default('ABC'),
});

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
