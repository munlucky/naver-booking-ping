/**
 * Main entry point for Naver Booking Ping
 */

import { loadConfigSafe } from './config/index.js';
import { JsonStateManager } from './core/state-manager.js';
import { bootstrapBrowserSession, createBrowserManager } from './infrastructure/playwright/browser.js';
import { createChecker } from './core/checker.js';
import { createNotifier } from './core/notifier.js';
import { createScheduler } from './core/scheduler.js';
import { createLogger } from './utils/logger.js';
import { buildSkyscannerUrl } from './core/flight-price.js';
import type { ConfiguredTarget, NewTarget, Target } from './types/index.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

/**
 * Heartbeat: Daily 7 AM notification to confirm system is running
 */
const HEARTBEAT_FILE = './data/heartbeat.json';
const HEARTBEAT_HOUR = 7; // 7 AM

interface HeartbeatData {
  lastSentDate: string; // YYYY-MM-DD
}

function getTodayDate(): string {
  const now = new Date();
  const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
  return koreaTime.toISOString().split('T')[0];
}

function getCurrentHour(): number {
  const now = new Date();
  const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
  return koreaTime.getHours();
}

function getLastHeartbeatDate(): string | null {
  if (!existsSync(HEARTBEAT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf-8')) as HeartbeatData;
    return data.lastSentDate;
  } catch {
    return null;
  }
}

function saveHeartbeatDate(): void {
  try {
    const dir = dirname(HEARTBEAT_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(HEARTBEAT_FILE, JSON.stringify({ lastSentDate: getTodayDate() }, null, 2));
  } catch (err) {
    console.error('[Heartbeat] Failed to save heartbeat date:', err);
  }
}

async function sendHeartbeatIfNeeded(ntfyConfig: { serverUrl: string; heartbeatTopic?: string }, logger: ReturnType<typeof createLogger>): Promise<void> {
  const currentHour = getCurrentHour();
  const today = getTodayDate();
  const lastSent = getLastHeartbeatDate();

  // Send at 7 AM and only once per day
  if (currentHour === HEARTBEAT_HOUR && lastSent !== today && ntfyConfig.heartbeatTopic) {
    try {
      const url = `${ntfyConfig.serverUrl}/${ntfyConfig.heartbeatTopic}`;
      const title = '=?utf-8?B?' + Buffer.from('Naver Booking Ping - 정상 작동 중', 'utf-8').toString('base64') + '?=';
      const body = `시스템이 정상적으로 작동 중입니다.\n시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Title': title,
          'Click': 'https://booking.naver.com/',
        },
        body: body,
      });

      if (response.ok) {
        logger.info('Heartbeat notification sent');
        saveHeartbeatDate();
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      logger.error('Heartbeat notification failed', err);
    }
  }
}

/**
 * Polling interval constants (in milliseconds)
 */
const INTERVAL_WHEN_CLOSED = 10000; // 10 seconds when all targets are CLOSED
const INTERVAL_WHEN_OPEN = 60000;   // 60 seconds when any target is OPEN

/**
 * Check if any enabled target is currently OPEN
 */
async function checkIfAnyTargetOpen(stateManager: JsonStateManager): Promise<boolean> {
  const targets = await stateManager.listTargets();
  const enabledTargets = targets.filter((t) => t.enabled && t.kind === 'naver-booking');

  for (const target of enabledTargets) {
    const state = await stateManager.getState(target.id);
    if (state && state.lastStatus === 'OPEN') {
      return true;
    }
  }
  return false;
}

function resolveConfiguredTarget(targetConfig: ConfiguredTarget): NewTarget {
  if (targetConfig.kind === 'flight-price') {
    return {
      kind: 'flight-price',
      name: targetConfig.name,
      enabled: targetConfig.enabled,
      provider: targetConfig.provider,
      priceQuery: targetConfig.priceQuery,
      urlInput: targetConfig.urlInput || buildSkyscannerUrl(targetConfig.priceQuery),
      urlFinalLast: targetConfig.urlFinalLast || null,
    };
  }

  return {
    kind: 'naver-booking',
    name: targetConfig.name,
    urlInput: targetConfig.urlInput,
    urlFinalLast: targetConfig.urlFinalLast || null,
    enabled: targetConfig.enabled,
    policy: targetConfig.policy,
  };
}

function isSameTargetConfig(existingTarget: Target, normalizedTarget: NewTarget): boolean {
  if (
    existingTarget.kind !== normalizedTarget.kind ||
    existingTarget.name !== normalizedTarget.name ||
    existingTarget.urlInput !== normalizedTarget.urlInput ||
    existingTarget.urlFinalLast !== normalizedTarget.urlFinalLast ||
    existingTarget.enabled !== normalizedTarget.enabled
  ) {
    return false;
  }

  if (normalizedTarget.kind === 'naver-booking') {
    return existingTarget.kind === 'naver-booking' && existingTarget.policy === normalizedTarget.policy;
  }

  return (
    existingTarget.kind === 'flight-price' &&
    existingTarget.provider === normalizedTarget.provider &&
    JSON.stringify(existingTarget.priceQuery) === JSON.stringify(normalizedTarget.priceQuery)
  );
}

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

/**
 * Main application
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const configPath = args.find((a) => a.startsWith('--config='))?.split('=')[1];
  const isTestMode = args.includes('--test');
  const isBootstrapFlightSessionMode = args.includes('--bootstrap-flight-session');

  // Load configuration
  const { config, error } = await loadConfigSafe(configPath);
  if (error || !config) {
    console.error(`Configuration error:\n${error}`);
    console.error('\nPlease create config/config.yaml based on config/config.example.yaml');
    process.exit(1);
  }

  // Initialize logger
  const logger = createLogger(config.logging.level, config.logging.file);
  logger.info('Starting Naver Booking Ping...');

  // Initialize state manager (JSON-based)
  logger.info('Initializing state manager (JSON file-based)...');
  const stateManager = new JsonStateManager();

  // Load targets from config
  if (config.targets && config.targets.length > 0) {
    for (const targetConfig of config.targets) {
      const normalizedTarget = resolveConfiguredTarget(targetConfig);
      const existingTargets = await stateManager.listTargets();
      const existingTarget = existingTargets.find((target) => target.urlInput === normalizedTarget.urlInput);

      if (!existingTarget) {
        const id = await stateManager.addTarget(normalizedTarget);
        logger.info(`Added target: ${normalizedTarget.name} (${id})`);
      } else if (!isSameTargetConfig(existingTarget, normalizedTarget)) {
        await stateManager.updateTarget(existingTarget.id, normalizedTarget);
        logger.info(`Synced target config: ${normalizedTarget.name} (${existingTarget.id})`);
      }
    }
  }

  if (isBootstrapFlightSessionMode) {
    const bootstrapTarget = config.targets
      ?.map((targetConfig) => resolveConfiguredTarget(targetConfig))
      .find((target) => target.kind === 'flight-price' && target.enabled);

    if (!bootstrapTarget || bootstrapTarget.kind !== 'flight-price') {
      logger.error('No enabled flight-price target found for bootstrap session');
      process.exit(1);
    }

    logger.info(`Launching manual Skyscanner session bootstrap for ${bootstrapTarget.name}`);
    const session = await bootstrapBrowserSession(
      {
        ...config.browser,
        headless: false,
      },
      bootstrapTarget.urlInput
    );
    await waitForEnter(
      `브라우저에서 Skyscanner 챌린지를 직접 통과한 뒤 Enter를 누르면 세션을 저장하고 종료합니다. 저장 경로: ${config.browser.storageStatePath}`
    );
    await session.saveAndClose();
    logger.info(`Saved browser session to ${config.browser.storageStatePath}`);
    process.exit(0);
  }

  // Test notification mode
  if (isTestMode) {
    logger.info('Running in test mode...');
    const notifier = createNotifier(config.ntfy, logger);
    try {
      await notifier.send({
        title: 'Naver Booking Ping - Test',
        body: 'This is a test notification. Your ntfy setup is working!',
        clickUrl: 'https://booking.naver.com/',
      });
      logger.info('Test notification sent successfully!');
      logger.info(`Check your ntfy app for topic: ${config.ntfy.topic}`);
    } catch (err) {
      logger.error('Test notification failed', err);
    }
    stateManager.close();
    process.exit(0);
  }

  // Initialize browser
  logger.info('Initializing browser...');
  const browserManager = await createBrowserManager(config.browser);
  const checker = createChecker(browserManager, config.browser.timeoutMs);
  const notifier = createNotifier(config.ntfy, logger);
  const scheduler = createScheduler(config.scheduler);

  // Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);

    // Stop scheduler first to prevent new checks
    scheduler.stop();

    // Wait a bit for any ongoing operations to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Close resources
    try {
      await browserManager.close();
    } catch (err) {
      logger.error('Error closing browser', err);
    }

    // State manager closes automatically (JSON is always flushed)
    stateManager.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Check loop function
  const checkLoop = async (): Promise<void> => {
    // Check if heartbeat needs to be sent (daily 7 AM)
    await sendHeartbeatIfNeeded(config.ntfy, logger);

    const targets = await stateManager.listTargets();
    const enabledTargets = targets.filter((t) => t.enabled);

    if (enabledTargets.length === 0) {
      logger.warn('No enabled targets found');
      return;
    }

    for (const target of enabledTargets) {
      logger.info(`Checking target: ${target.name}`);

      try {
        const prevState = await stateManager.getState(target.id);
        const prevStatus = prevState?.lastStatus || 'UNKNOWN';

        // Perform check
        const result = await checker.check(target, {
          previousState: prevState,
        });

        // Log the result
        await stateManager.addLog({
          targetId: target.id,
          checkedAt: new Date(),
          status: result.status,
          evidence: JSON.stringify(result.evidence),
          error: result.error?.message,
          details: result.details ? JSON.stringify(result.details) : undefined,
        });

        // Update final URL if changed
        if (result.finalUrl !== target.urlFinalLast) {
          await stateManager.updateTarget(target.id, {
            urlFinalLast: result.finalUrl,
          });
        }

        const shouldNotify = result.shouldNotify === true && !!result.notification;

        if (shouldNotify && result.notification) {
          logger.info(`Alert condition met: ${prevStatus} -> ${result.status} for ${target.name}`);
          await notifier.send(result.notification);
          await stateManager.setState(target.id, {
            status: result.status,
            observedValue: result.observedValue,
          });
          if (result.notificationKey !== undefined) {
            await stateManager.markNotified(target.id, result.notificationKey);
          }
          logger.info(`Notification sent for ${target.name}`);
        } else {
          await stateManager.setState(target.id, {
            status: result.status,
            observedValue: result.observedValue,
          });
        }

        logger.info(
          `Check complete: ${target.name} -> ${result.status} (evidence: ${result.evidence.join(', ') || 'none'})`
        );

        if (result.screenshotPath) {
          logger.info(`  Screenshot: ${result.screenshotPath}`);
        }

        // Log error if present (UNKNOWN status with error)
        if (result.error) {
          logger.info(`  Error: ${result.error.message}`);
        }

        // Log debug info if available
        if (result.debug) {
          logger.info(
            `  Debug: title="${result.debug.title}", bookingLinks=${result.debug.bookingLinks}, bookingButtons=${result.debug.bookingButtons}`
          );
          if (result.debug.matchedRule || result.debug.matchedText || result.debug.matchedHref) {
            logger.info(
              `  DebugMatch: rule=${result.debug.matchedRule || '-'}, text="${result.debug.matchedText || ''}", href=${result.debug.matchedHref || '-'}`
            );
          }
        }

        if (result.details?.currentPrice && result.observedCurrency) {
          logger.info(`  Detail: currentPrice=${result.observedCurrency} ${result.details.currentPrice}`);
        }
      } catch (error) {
        logger.error(`Error checking target ${target.name}`, error);
      }
    }

    // Adjust polling interval based on current states
    // Use 60s interval if any target is OPEN, 10s if all are CLOSED
    const hasAnyOpen = await checkIfAnyTargetOpen(stateManager);
    const newInterval = hasAnyOpen ? INTERVAL_WHEN_OPEN : INTERVAL_WHEN_CLOSED;
    scheduler.updateInterval(newInterval);
  };

  // Get initial target count for logging
  const allTargets = await stateManager.listTargets();
  const enabledTargetCount = allTargets.filter((t) => t.enabled).length;

  // Start scheduler
  logger.info('Starting scheduler...');
  scheduler.start(checkLoop);

  logger.info(`Running with ${enabledTargetCount} target(s)`);
  logger.info('Press Ctrl+C to stop');
}

// Run main
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
