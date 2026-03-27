/**
 * State Manager: JSON file-based state storage
 * MVP-friendly alternative to SQLite (no native dependencies)
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type {
  Target,
  TargetState,
  CheckLog,
  BookingStatus,
  TargetKind,
  FlightProvider,
  FlightPriceQuery,
  NewTarget,
} from '../types/index.js';

/**
 * Data directory and files
 */
const DATA_DIR = './data';
const TARGETS_FILE = `${DATA_DIR}/targets.json`;
const STATES_FILE = `${DATA_DIR}/states.json`;
const LOGS_DIR = `${DATA_DIR}/logs`;

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Read JSON file safely
 */
function readJsonFile<T>(path: string, defaultValue: T): T {
  ensureDataDir();
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

/**
 * Write JSON file atomically
 */
function writeJsonFile<T>(path: string, data: T): void {
  ensureDataDir();
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Target data structure
 */
interface TargetData {
  id: string;
  kind?: TargetKind;
  name: string;
  urlInput: string;
  urlFinalLast: string | null;
  enabled: boolean;
  policy?: string;
  provider?: FlightProvider;
  priceQuery?: FlightPriceQuery;
  createdAt: string;
  updatedAt: string;
}

/**
 * State data structure
 */
interface StateData {
  targetId: string;
  lastStatus: BookingStatus;
  lastChangedAt: string;
  lastOpenAt: string | null;
  consecutiveFailures: number;
  lastObservedValue?: number | null;
  bestObservedValue?: number | null;
  lastNotifiedFingerprint?: string | null;
  updatedAt: string;
}

/**
 * Log entry structure
 */
interface LogEntryData {
  id: string;
  targetId: string;
  checkedAt: string;
  status: BookingStatus;
  evidence: string;
  error: string | null;
  details?: string | null;
  createdAt: string;
}

export interface StateUpdate {
  status: BookingStatus;
  observedValue?: number | null;
}

/**
 * State Manager interface
 */
export interface StateManager {
  // Targets
  addTarget(target: NewTarget): Promise<string>;
  getTarget(id: string): Promise<Target | null>;
  listTargets(): Promise<Target[]>;
  updateTarget(id: string, updates: Partial<Target>): Promise<void>;
  deleteTarget(id: string): Promise<boolean>;

  // States
  getState(targetId: string): Promise<TargetState | null>;
  setState(targetId: string, update: StateUpdate): Promise<void>;
  markNotified(targetId: string, fingerprint: string | null): Promise<void>;

  // Logs
  addLog(log: Omit<CheckLog, 'id' | 'createdAt'>): Promise<void>;
  getRecentLogs(targetId: string, limit: number): Promise<CheckLog[]>;

  // Cleanup
  close(): void;
}

/**
 * JSON file implementation of StateManager
 */
export class JsonStateManager implements StateManager {
  private targets: Map<string, TargetData>;
  private states: Map<string, StateData>;

  constructor() {
    // Load initial data
    const targetsData = readJsonFile<Record<string, TargetData>>(TARGETS_FILE, {});
    const statesData = readJsonFile<Record<string, StateData>>(STATES_FILE, {});

    this.targets = new Map(Object.entries(targetsData));
    this.states = new Map(Object.entries(statesData));
  }

  /**
   * Save data to disk
   */
  private save(): void {
    const targetsObj = Object.fromEntries(this.targets.entries());
    const statesObj = Object.fromEntries(this.states.entries());

    writeJsonFile(TARGETS_FILE, targetsObj);
    writeJsonFile(STATES_FILE, statesObj);
  }

  /**
   * Add a new target
   */
  async addTarget(target: NewTarget): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const targetData: TargetData = {
      id,
      kind: target.kind,
      name: target.name,
      urlInput: target.urlInput,
      urlFinalLast: target.urlFinalLast || null,
      enabled: target.enabled,
      policy: target.kind === 'naver-booking' ? target.policy : undefined,
      provider: target.kind === 'flight-price' ? target.provider : undefined,
      priceQuery: target.kind === 'flight-price' ? target.priceQuery : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.targets.set(id, targetData);

    // Initialize state
    const stateData: StateData = {
      targetId: id,
      lastStatus: 'UNKNOWN',
      lastChangedAt: now,
      lastOpenAt: null,
      consecutiveFailures: 0,
      lastObservedValue: null,
      bestObservedValue: null,
      lastNotifiedFingerprint: null,
      updatedAt: now,
    };
    this.states.set(id, stateData);

    this.save();
    return id;
  }

  /**
   * Get a target by ID
   */
  async getTarget(id: string): Promise<Target | null> {
    const data = this.targets.get(id);
    if (!data) return null;

    if ((data.kind ?? 'naver-booking') === 'flight-price' && data.provider && data.priceQuery) {
      return {
        id: data.id,
        kind: 'flight-price',
        name: data.name,
        urlInput: data.urlInput,
        urlFinalLast: data.urlFinalLast,
        enabled: data.enabled,
        provider: data.provider,
        priceQuery: data.priceQuery,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };
    }

    return {
      id: data.id,
      kind: 'naver-booking',
      name: data.name,
      urlInput: data.urlInput,
      urlFinalLast: data.urlFinalLast,
      enabled: data.enabled,
      policy: data.policy || 'ABC',
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * List all targets
   */
  async listTargets(): Promise<Target[]> {
    return Array.from(this.targets.values()).map((data) => {
      if ((data.kind ?? 'naver-booking') === 'flight-price' && data.provider && data.priceQuery) {
        return {
          id: data.id,
          kind: 'flight-price' as const,
          name: data.name,
          urlInput: data.urlInput,
          urlFinalLast: data.urlFinalLast,
          enabled: data.enabled,
          provider: data.provider,
          priceQuery: data.priceQuery,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
        };
      }

      return {
        id: data.id,
        kind: 'naver-booking' as const,
        name: data.name,
        urlInput: data.urlInput,
        urlFinalLast: data.urlFinalLast,
        enabled: data.enabled,
        policy: data.policy || 'ABC',
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };
    });
  }

  /**
   * Update a target
   */
  async updateTarget(id: string, updates: Partial<Target>): Promise<void> {
    const data = this.targets.get(id);
    if (!data) return;

    const now = new Date().toISOString();

    if (updates.name !== undefined) data.name = updates.name;
    if (updates.urlInput !== undefined) data.urlInput = updates.urlInput;
    if (updates.urlFinalLast !== undefined) data.urlFinalLast = updates.urlFinalLast;
    if (updates.enabled !== undefined) data.enabled = updates.enabled;
    if (updates.kind !== undefined) data.kind = updates.kind;
    if (updates.kind === 'naver-booking' && updates.policy !== undefined) {
      data.policy = updates.policy;
    }
    if (updates.kind === 'flight-price') {
      if (updates.provider !== undefined) data.provider = updates.provider;
      if (updates.priceQuery !== undefined) data.priceQuery = updates.priceQuery;
    }
    data.updatedAt = now;

    this.targets.set(id, data);
    this.save();
  }

  /**
   * Delete a target
   */
  async deleteTarget(id: string): Promise<boolean> {
    const hadTarget = this.targets.has(id);
    this.targets.delete(id);
    this.states.delete(id);
    this.save();

    // Clean up log files for this target
    try {
      const logFiles = readdirSync(LOGS_DIR);
      for (const file of logFiles) {
        if (file.startsWith(`${id}-`)) {
          unlinkSync(`${LOGS_DIR}/${file}`);
        }
      }
    } catch {
      // Ignore log cleanup errors
    }

    return hadTarget;
  }

  /**
   * Get state for a target
   */
  async getState(targetId: string): Promise<TargetState | null> {
    const data = this.states.get(targetId);
    if (!data) return null;

    return {
      targetId: data.targetId,
      lastStatus: data.lastStatus,
      lastChangedAt: new Date(data.lastChangedAt),
      lastOpenAt: data.lastOpenAt ? new Date(data.lastOpenAt) : null,
      consecutiveFailures: data.consecutiveFailures,
      lastObservedValue: data.lastObservedValue ?? null,
      bestObservedValue: data.bestObservedValue ?? null,
      lastNotifiedFingerprint: data.lastNotifiedFingerprint ?? null,
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Set state for a target
   */
  async setState(targetId: string, update: StateUpdate): Promise<void> {
    const now = new Date().toISOString();
    const currentState = this.states.get(targetId);
    const status = update.status;
    const observedValue = update.observedValue ?? null;

    if (!currentState) {
      // Should not happen, but handle gracefully
      const newState: StateData = {
        targetId,
        lastStatus: status,
        lastChangedAt: now,
        lastOpenAt: status === 'OPEN' ? now : null,
        consecutiveFailures: 0,
        lastObservedValue: observedValue,
        bestObservedValue: observedValue,
        lastNotifiedFingerprint: null,
        updatedAt: now,
      };
      this.states.set(targetId, newState);
    } else {
      if (currentState.lastStatus !== status) {
        // Status changed
        currentState.lastStatus = status;
        currentState.lastChangedAt = now;
        if (status === 'OPEN') {
          currentState.lastOpenAt = now;
        }
        currentState.consecutiveFailures = 0;
      }
      currentState.lastObservedValue = observedValue;
      if (
        observedValue !== null &&
        (currentState.bestObservedValue === undefined ||
          currentState.bestObservedValue === null ||
          observedValue < currentState.bestObservedValue)
      ) {
        currentState.bestObservedValue = observedValue;
      }
      currentState.updatedAt = now;
      this.states.set(targetId, currentState);
    }

    this.save();
  }

  /**
   * Store the last successful notification fingerprint
   */
  async markNotified(targetId: string, fingerprint: string | null): Promise<void> {
    const currentState = this.states.get(targetId);
    if (!currentState) {
      return;
    }

    currentState.lastNotifiedFingerprint = fingerprint;
    currentState.updatedAt = new Date().toISOString();
    this.states.set(targetId, currentState);
    this.save();
  }

  /**
   * Add a check log
   */
  async addLog(log: Omit<CheckLog, 'id' | 'createdAt'>): Promise<void> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const logEntry: LogEntryData = {
      id,
      targetId: log.targetId,
      checkedAt: log.checkedAt.toISOString(),
      status: log.status,
      evidence: log.evidence,
      error: log.error || null,
      details: log.details || null,
      createdAt: now,
    };

    // Store logs in separate files per target (last 100 only)
    const logFile = `${LOGS_DIR}/${log.targetId}.json`;
    const logs = readJsonFile<LogEntryData[]>(logFile, []);

    logs.unshift(logEntry); // Add to front

    // Keep only last 100 logs per target
    if (logs.length > 100) {
      logs.splice(100);
    }

    writeJsonFile(logFile, logs);
  }

  /**
   * Get recent logs for a target
   */
  async getRecentLogs(targetId: string, limit: number): Promise<CheckLog[]> {
    const logFile = `${LOGS_DIR}/${targetId}.json`;
    const logs = readJsonFile<LogEntryData[]>(logFile, []);

    return logs.slice(0, limit).map((data) => ({
      id: data.id,
      targetId: data.targetId,
      checkedAt: new Date(data.checkedAt),
      status: data.status,
      evidence: data.evidence,
      error: data.error || undefined,
      details: data.details || undefined,
      createdAt: new Date(data.createdAt),
    }));
  }

  /**
   * Close (no-op for JSON, data is always flushed)
   */
  close(): void {
    // Data is already saved on each operation
  }
}
