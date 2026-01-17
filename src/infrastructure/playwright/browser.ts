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
   * Creates a fresh page for each request to avoid crashes from reuse
   */
  async getPage(): Promise<Page> {
    // Initialize browser if needed
    if (!this.browser || this.browser.isConnected() === false) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });
      // Reset context when browser is recreated
      this.context = null;
    }

    // Initialize context if needed (check if context is still valid)
    if (!this.context || this.context.pages().length === 0) {
      const contextOptions: { userAgent: string; viewport?: { width: number; height: number } } = {
        userAgent: this.config.userAgent,
      };

      if (this.config.viewport) {
        contextOptions.viewport = this.config.viewport;
      }

      this.context = await this.browser.newContext(contextOptions);
    }

    // Always create a fresh page to avoid crashes from reuse
    const page = await this.context.newPage();
    page.setDefaultTimeout(this.config.timeoutMs);

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
