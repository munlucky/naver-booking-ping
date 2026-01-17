/**
 * Booking status checker using Playwright
 * Implements Rule A/B/C detection logic
 */

import type { Page } from 'playwright';
import type { BrowserManager } from '../infrastructure/playwright/browser.js';
import type { Target, CheckResult, CheckRule, BookingStatus } from '../types/index.js';

/**
 * Check rules as defined in PRD
 */
const CHECK_RULES: CheckRule[] = [
  {
    name: 'A',
    selector: 'a[href*="/booking"]', // Matches /booking, /booking/, booking.naver.com, etc.
    priority: 2,
  },
  {
    name: 'B',
    selector: 'a[role="button"]:has-text("예약"), button:has-text("예약"), a.D_Xqt:has-text("예약")',
    priority: 2,
  },
  {
    name: 'C',
    selector: 'button:not(:disabled), a:not([disabled])',
    priority: 1,
  },
];

/**
 * Time slot pattern for Rule C
 */
const TIME_SLOT_PATTERN = /\b\d{1,2}:\d{2}\b/;

/**
 * Checker interface
 */
export interface Checker {
  check(target: Target): Promise<CheckResult>;
}

/**
 * Playwright-based checker implementation
 */
export class PlaywrightChecker implements Checker {
  constructor(
    private browserManager: BrowserManager,
    private timeoutMs: number = 30000
  ) {}

  /**
   * Check booking status for a target
   */
  async check(target: Target): Promise<CheckResult> {
    const page = await this.browserManager.getPage();
    const evidence: string[] = [];

    try {
      // Navigate to URL
      await page.goto(target.urlInput, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      // Wait for dynamic content to load
      await page.waitForTimeout(3000);

      // Get final URL after redirects
      const finalUrl = page.url();

      // Debug: log page title and URL
      const title = await page.title().catch(() => 'unknown');

      // Determine which rules to apply based on policy
      const activeRules = this.getActiveRules(target.policy);

      // Debug: Check all booking-related links
      const bookingLinks = await page.locator('a[href*="booking"]').count();
      const bookingButtons = await page.locator('a:has-text("예약"), button:has-text("예약")').count();

      // Apply each rule
      for (const rule of activeRules) {
        const matched = await this.applyRule(page, rule);
        if (matched) {
          evidence.push(rule.name);
        }
      }

      // Determine status based on evidence
      const status = this.determineStatus(evidence, target.policy);

      return {
        status,
        evidence,
        finalUrl,
        debug: {
          title,
          bookingLinks,
          bookingButtons,
        },
      };
    } catch (error) {
      return {
        status: 'UNKNOWN',
        evidence,
        finalUrl: page.url(),
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      // Close the page to free resources
      // Use runBeforeUnload: false to force close even if page has beforeunload handlers
      try {
        await page.close({ runBeforeUnload: false });
      } catch (error) {
        // If close fails, log and continue - resources will be cleaned up on browser restart
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Checker] Page close failed (will be cleaned up on restart): ${errorMsg}`);
      }
    }
  }

  /**
   * Get active rules based on policy
   */
  private getActiveRules(policy: string): CheckRule[] {
    if (policy === 'C') {
      return CHECK_RULES.filter((r) => r.name === 'C');
    }
    return CHECK_RULES.filter((r) => policy.includes(r.name));
  }

  /**
   * Apply a single rule and return if matched
   */
  private async applyRule(page: Page, rule: CheckRule): Promise<boolean> {
    try {
      if (rule.name === 'C') {
        // Rule C: Check for time slot pattern in enabled buttons/links
        return await this.checkRuleC(page);
      } else {
        // Rule A and B: Simple selector existence
        const element = page.locator(rule.selector).first();
        const count = await element.count();
        return count > 0;
      }
    } catch {
      return false;
    }
  }

  /**
   * Rule C: Check for time slot pattern
   */
  private async checkRuleC(page: Page): Promise<boolean> {
    try {
      // Get all enabled buttons and links
      const elements = await page.locator('button:not(:disabled), a:not([disabled])').all();

      for (const el of elements) {
        try {
          const text = await el.textContent();
          if (text && TIME_SLOT_PATTERN.test(text.trim())) {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Determine final status based on evidence and policy
   */
  private determineStatus(evidence: string[], policy: string): BookingStatus {
    if (evidence.length === 0) {
      return 'CLOSED';
    }

    // If Rule C is in policy and matched, high confidence
    if (policy.includes('C') && evidence.includes('C')) {
      return 'OPEN';
    }

    // If any rule matched, consider it open
    return 'OPEN';
  }
}

/**
 * Create a new checker
 */
export function createChecker(
  browserManager: BrowserManager,
  timeoutMs: number = 30000
): Checker {
  return new PlaywrightChecker(browserManager, timeoutMs);
}
