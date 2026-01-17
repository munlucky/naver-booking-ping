/**
 * Main entry point for Naver Booking Ping
 */

import { loadConfigSafe } from './config/index.js';
import { JsonStateManager } from './core/state-manager.js';
import { createBrowserManager } from './infrastructure/playwright/browser.js';
import { createChecker } from './core/checker.js';
import { createNotifier } from './core/notifier.js';
import { createScheduler } from './core/scheduler.js';
import { createLogger } from './utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

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
 * Main application
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const configPath = args.find((a) => a.startsWith('--config='))?.split('=')[1];
  const isTestMode = args.includes('--test');

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
      const existingTargets = await stateManager.listTargets();
      const exists = existingTargets.some((t) => t.urlInput === targetConfig.urlInput);

      if (!exists) {
        const id = await stateManager.addTarget({
          name: targetConfig.name,
          urlInput: targetConfig.urlInput,
          urlFinalLast: targetConfig.urlFinalLast || null,
          enabled: targetConfig.enabled,
          policy: targetConfig.policy,
        });
        logger.info(`Added target: ${targetConfig.name} (${id})`);
      }
    }
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
        // Perform check
        const result = await checker.check(target);

        // Log the result
        await stateManager.addLog({
          targetId: target.id,
          checkedAt: new Date(),
          status: result.status,
          evidence: JSON.stringify(result.evidence),
          error: result.error?.message,
        });

        // Update final URL if changed
        if (result.finalUrl !== target.urlFinalLast) {
          await stateManager.updateTarget(target.id, {
            urlFinalLast: result.finalUrl,
          });
        }

        // Check for status change
        const prevState = await stateManager.getState(target.id);
        const prevStatus = prevState?.lastStatus || 'UNKNOWN';

        if (result.status === 'OPEN' && prevStatus !== 'OPEN') {
          // Status changed to OPEN - send notification
          logger.info(`Status changed: ${prevStatus} -> ${result.status} for ${target.name}`);
          await notifier.send({
            title: `[${target.name}] 예약 버튼 활성화`,
            body: `예약 버튼이 활성화됐습니다!`,
            clickUrl: target.urlInput,
          });
          // Save state after sending notification
          await stateManager.setState(target.id, result.status);
          logger.info(`Notification sent for ${target.name}`);
        } else {
          // Save state (OPEN → OPEN or CLOSED → CLOSED)
          await stateManager.setState(target.id, result.status);
        }

        logger.info(
          `Check complete: ${target.name} -> ${result.status} (evidence: ${result.evidence.join(', ') || 'none'})`
        );

        // Log debug info if available
        if (result.debug) {
          logger.info(
            `  Debug: title="${result.debug.title}", bookingLinks=${result.debug.bookingLinks}, bookingButtons=${result.debug.bookingButtons}`
          );
        }
      } catch (error) {
        logger.error(`Error checking target ${target.name}`, error);
      }
    }
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
