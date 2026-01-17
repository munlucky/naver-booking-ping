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

  constructor(private config: BrowserConfig) {}

  /**
   * Get or create a page instance
   */
  async getPage(): Promise<Page> {
    // Return existing page if it's still valid
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    // Clean up closed page reference
    if (this.page?.isClosed()) {
      this.page = null;
    }

    // Initialize browser if needed
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });
    }

    // Initialize context if needed
    if (!this.context) {
      const contextOptions: { userAgent: string; viewport?: { width: number; height: number } } = {
        userAgent: this.config.userAgent,
      };

      if (this.config.viewport) {
        contextOptions.viewport = this.config.viewport;
      }

      this.context = await this.browser.newContext(contextOptions);
    }

    // Create new page
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs);

    return this.page;
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
