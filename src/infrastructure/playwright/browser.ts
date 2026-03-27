/**
 * Playwright browser manager
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import type { BrowserConfig } from '../../types/index.js';

/**
 * Browser manager interface
 */
export interface BrowserManager {
  getPage(): Promise<Page>;
  close(): Promise<void>;
}

function ensureParentDir(filePath: string | undefined): void {
  if (!filePath) {
    return;
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createLaunchOptions(config: BrowserConfig, headlessOverride?: boolean) {
  return {
    headless: headlessOverride ?? config.headless,
    channel: config.channel,
    args: config.launchArgs,
  };
}

function createContextOptions(config: BrowserConfig) {
  const contextOptions: {
    userAgent: string;
    viewport?: { width: number; height: number };
    locale?: string;
    timezoneId?: string;
    storageState?: string;
    extraHTTPHeaders?: Record<string, string>;
  } = {
    userAgent: config.userAgent,
    locale: config.locale,
    timezoneId: config.timezoneId,
    extraHTTPHeaders: config.locale
      ? {
          'Accept-Language': `${config.locale},ko;q=0.9,en-US;q=0.8,en;q=0.7`,
        }
      : undefined,
  };

  if (config.viewport) {
    contextOptions.viewport = config.viewport;
  }

  if (config.storageStatePath && existsSync(config.storageStatePath)) {
    contextOptions.storageState = config.storageStatePath;
  }

  return contextOptions;
}

async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    const chromeObject = { runtime: {} };
    Object.defineProperty(window, 'chrome', {
      get: () => chromeObject,
    });
  });
}

/**
 * Playwright browser manager implementation
 */
export class PlaywrightBrowserManager implements BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private contextUseCount: number = 0;
  private browserUseCount: number = 0;
  private readonly MAX_CONTEXT_USES = 100; // Context 재생성 주기
  private readonly MAX_BROWSER_USES = 500; // Browser 재시작 주기

  constructor(private config: BrowserConfig) {}

  /**
   * Get or create a page instance
   * Creates a fresh page for each request to avoid crashes from reuse
   * Periodically recreates context and browser to prevent memory leaks
   */
  async getPage(): Promise<Page> {
    // Periodically restart browser to prevent Chrome memory leaks
    if (this.browser && this.browserUseCount >= this.MAX_BROWSER_USES) {
      await this.close();
      this.browserUseCount = 0;
      this.contextUseCount = 0;
    }

    // Initialize browser if needed
    if (!this.browser || this.browser.isConnected() === false) {
      this.browser = await chromium.launch(createLaunchOptions(this.config));
      // Reset context when browser is recreated
      this.context = null;
      this.contextUseCount = 0;
    }

    // Periodically recreate context to prevent resource accumulation
    const needsNewContext =
      !this.context ||
      this.context.pages().length === 0 ||
      this.contextUseCount >= this.MAX_CONTEXT_USES;

    if (needsNewContext) {
      // Close old context if exists
      if (this.context) {
        await this.context.close().catch(() => {});
      }

      this.context = await this.browser.newContext(createContextOptions(this.config));
      if (this.config.stealth !== false) {
        await applyStealth(this.context);
      }
      this.contextUseCount = 0;
    }

    // Context is guaranteed to be non-null here after needsNewContext check
    const context = this.context!;

    // Always create a fresh page to avoid crashes from reuse
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.timeoutMs);

    // Increment counters
    this.contextUseCount++;
    this.browserUseCount++;

    return page;
  }

  /**
   * Close browser resources
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

/**
 * Create a new browser manager
 */
export async function createBrowserManager(config: BrowserConfig): Promise<BrowserManager> {
  return new PlaywrightBrowserManager(config);
}

/**
 * Launch a manual browser session and persist cookies/storage for later automated runs
 */
export interface BootstrapBrowserSession {
  saveAndClose(): Promise<void>;
}

export async function bootstrapBrowserSession(
  config: BrowserConfig,
  url: string
): Promise<BootstrapBrowserSession> {
  ensureParentDir(config.storageStatePath);

  const browser = await chromium.launch(createLaunchOptions(config, false));
  const context = await browser.newContext(createContextOptions(config));
  if (config.stealth !== false) {
    await applyStealth(context);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeoutMs,
  });

  await page.waitForTimeout(2000);

  const saveAndClose = async () => {
    await context.storageState({
      path: config.storageStatePath,
    });
    await browser.close().catch(() => {});
  };

  process.on('SIGINT', async () => {
    await saveAndClose();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await saveAndClose();
    process.exit(0);
  });

  return {
    saveAndClose,
  };
}
