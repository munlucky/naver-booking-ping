/**
 * Configuration loader with YAML support and validation
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { AppConfig } from '../types/index.js';
import { AppConfigSchema, AppConfigInput } from './schema.js';

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
  const path = configPath || findConfigPath();

  if (!path) {
    throw new Error(
      'Configuration file not found. Please create config/config.yaml based on config/config.example.yaml'
    );
  }

  const content = await readFile(path, 'utf-8');
  const rawConfig = yaml.load(content) as AppConfigInput;

  // Validate with Zod
  const validated = AppConfigSchema.parse(rawConfig);

  return validated as AppConfig;
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
