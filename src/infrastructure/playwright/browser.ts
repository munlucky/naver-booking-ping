/**
 * Playwright browser manager
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import type { BrowserConfig } from '../../types/index.js';

/**
 * Browser manager interface
 */
export interface BrowserManager {
  getPage(): Promise<Page>;
  close(): Promise<void>;
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
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });
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

      const contextOptions: { userAgent: string; viewport?: { width: number; height: number } } = {
        userAgent: this.config.userAgent,
      };

      if (this.config.viewport) {
        contextOptions.viewport = this.config.viewport;
      }

      this.context = await this.browser.newContext(contextOptions);
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
