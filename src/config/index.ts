/**
 * Configuration loader with YAML support and validation
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { AppConfig } from '../types/index.js';
import { AppConfigSchema, AppConfigInput } from './schema.js';

const ENV_FILE_PATH = './.env';

/**
 * Default configuration paths
 */
const DEFAULT_CONFIG_PATHS = [
  './config/config.yaml',
  './config/config.yml',
  './config.yaml',
  './config.yml',
];

/**
 * Load configuration from YAML file
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  await loadDotEnvIfPresent();

  const path = configPath || findConfigPath();

  if (!path) {
    throw new Error(
      'Configuration file not found. Please create config/config.yaml based on config/config.example.yaml'
    );
  }

  const content = interpolateEnv(await readFile(path, 'utf-8'));
  const rawConfig = yaml.load(content) as AppConfigInput;

  // Validate with Zod
  const validated = AppConfigSchema.parse(rawConfig);

  return validated as AppConfig;
}

async function loadDotEnvIfPresent(): Promise<void> {
  if (!existsSync(ENV_FILE_PATH)) {
    return;
  }

  const content = await readFile(ENV_FILE_PATH, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function interpolateEnv(content: string): string {
  return content.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_match, name: string, defaultValue: string | undefined) => {
    const value = process.env[name] ?? defaultValue;
    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  });
}

/**
 * Find first existing config file
 */
function findConfigPath(): string | null {
  for (const path of DEFAULT_CONFIG_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

/**
 * Load config with error handling for CLI use
 */
export async function loadConfigSafe(configPath?: string): Promise<{
  config: AppConfig | null;
  error: string | null;
}> {
  try {
    const config = await loadConfig(configPath);
    return { config, error: null };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
      return { config: null, error: `Configuration validation failed:\n${errors}` };
    }
    if (err instanceof Error) {
      return { config: null, error: err.message };
    }
    return { config: null, error: 'Unknown error' };
  }
}
