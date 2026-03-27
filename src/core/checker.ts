/**
 * Monitoring checker using Playwright
 * Supports Naver booking availability and flight fare tracking
 */

import type { Page } from 'playwright';
import type { BrowserManager } from '../infrastructure/playwright/browser.js';
import type {
  Target,
  CheckResult,
  CheckRule,
  TargetState,
  FlightPriceTarget,
  BookingStatus,
} from '../types/index.js';
import {
  formatCurrencyValue,
  formatFlightQuerySummary,
  resolveFlightTargetUrl,
} from './flight-price.js';

/**
 * Check rules as defined in PRD
 */
const CHECK_RULES: CheckRule[] = [
  {
    name: 'A',
    selector: 'a[href*="/booking"]',
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

const TIME_SLOT_PATTERN = /\b\d{1,2}:\d{2}\b/;

const FLIGHT_PRICE_SELECTORS = [
  '[data-testid*="price"]',
  '[data-test-id*="price"]',
  '[aria-label*="price"]',
  '[aria-label*="Price"]',
  '[aria-label*="요금"]',
  '[aria-label*="가격"]',
  '[class*="price"]',
  '[class*="Price"]',
];

interface CheckContext {
  previousState?: TargetState | null;
}

interface FlightPriceCandidate {
  value: number;
  currency: string;
  source: string;
  text: string;
  score: number;
}

/**
 * Checker interface
 */
export interface Checker {
  check(target: Target, context?: CheckContext): Promise<CheckResult>;
}

function getPriceRegexes(currency: string): RegExp[] {
  switch (currency.toUpperCase()) {
    case 'KRW':
      return [/₩\s*([0-9][0-9,]{2,})/g, /KRW\s*([0-9][0-9,]{2,})/gi, /([0-9][0-9,]{2,})\s*원/g];
    case 'USD':
      return [/\$\s*([0-9][0-9,]{1,})/g, /USD\s*([0-9][0-9,]{1,})/gi];
    case 'AUD':
      return [/A\$\s*([0-9][0-9,]{1,})/g, /AUD\s*([0-9][0-9,]{1,})/gi];
    case 'JPY':
      return [/¥\s*([0-9][0-9,]{2,})/g, /JPY\s*([0-9][0-9,]{2,})/gi];
    case 'EUR':
      return [/€\s*([0-9][0-9,]{1,})/g, /EUR\s*([0-9][0-9,]{1,})/gi];
    default:
      return [new RegExp(`${currency}\\s*([0-9][0-9,]{1,})`, 'gi')];
  }
}

function getMinimumPlausiblePrice(currency: string): number {
  switch (currency.toUpperCase()) {
    case 'KRW':
      return 50000;
    case 'JPY':
      return 5000;
    default:
      return 30;
  }
}

function extractPriceCandidates(
  rawText: string,
  currency: string,
  source: string,
  baseScore: number
): FlightPriceCandidate[] {
  const normalizedText = rawText.replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return [];
  }

  const keywordBonus = /(최저|특가|왕복|편도|직항|nonstop|roundtrip|selected|항공|fare|price)/i.test(
    normalizedText
  )
    ? 2
    : 0;
  const candidates: FlightPriceCandidate[] = [];
  const seenValues = new Set<string>();

  for (const regex of getPriceRegexes(currency)) {
    let match: RegExpExecArray | null = regex.exec(normalizedText);
    while (match) {
      const numericValue = Number(match[1].replace(/,/g, ''));
      const dedupeKey = `${source}:${numericValue}`;
      if (
        Number.isFinite(numericValue) &&
        numericValue >= getMinimumPlausiblePrice(currency) &&
        !seenValues.has(dedupeKey)
      ) {
        seenValues.add(dedupeKey);
        candidates.push({
          value: numericValue,
          currency,
          source,
          text: normalizedText.slice(0, 160),
          score: baseScore + keywordBonus,
        });
      }
      match = regex.exec(normalizedText);
    }
  }

  return candidates;
}

async function collectSelectorPriceCandidates(
  page: Page,
  currency: string
): Promise<FlightPriceCandidate[]> {
  const results: FlightPriceCandidate[] = [];

  for (const selector of FLIGHT_PRICE_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    const limit = Math.min(count, 20);

    for (let index = 0; index < limit; index++) {
      const node = locator.nth(index);
      const isVisible = await node.isVisible().catch(() => false);
      if (!isVisible) {
        continue;
      }

      const text = await node.innerText().catch(() => '');
      if (!text) {
        continue;
      }

      results.push(...extractPriceCandidates(text, currency, `selector:${selector}`, 5));
    }
  }

  return results;
}

async function collectBodyPriceCandidates(page: Page, currency: string): Promise<FlightPriceCandidate[]> {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (!bodyText) {
    return [];
  }

  return bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 220)
    .flatMap((line) => extractPriceCandidates(line, currency, 'body-text', 2));
}

function pickCurrentFlightPrice(candidates: FlightPriceCandidate[]): FlightPriceCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const ranked = [...candidates].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.value - right.value;
  });

  const topScore = ranked[0].score;
  const preferred = ranked.filter((candidate) => candidate.score >= topScore - 1);

  return preferred.reduce((lowest, candidate) => {
    if (candidate.value < lowest.value) {
      return candidate;
    }
    return lowest;
  }, preferred[0]);
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
   * Check target status
   */
  async check(target: Target, context: CheckContext = {}): Promise<CheckResult> {
    const page = await this.browserManager.getPage();

    try {
      if (target.kind === 'flight-price') {
        return await this.checkFlightPrice(page, target, context.previousState ?? null);
      }

      return await this.checkNaverBooking(page, target, context.previousState ?? null);
    } finally {
      try {
        await page.close({ runBeforeUnload: false });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Checker] Page close failed (will be cleaned up on restart): ${errorMsg}`);
      }
    }
  }

  /**
   * Naver booking monitoring logic
   */
  private async checkNaverBooking(
    page: Page,
    target: Extract<Target, { kind: 'naver-booking' }>,
    previousState: TargetState | null
  ): Promise<CheckResult> {
    const evidence: string[] = [];

    try {
      await page.goto(target.urlInput, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs,
      });

      if (target.name) {
        try {
          await page.waitForSelector(`:text("${target.name}")`, { timeout: 10000 });
        } catch {
          await page.waitForTimeout(2000);
        }
      } else {
        await page.waitForTimeout(2000);
      }

      const finalUrl = page.url();
      const title = await page.title().catch(() => 'unknown');
      const activeRules = this.getActiveRules(target.policy);
      const bookingLinks = await page.locator('a[href*="booking"]').count();
      const bookingButtons = await page.locator('a:has-text("예약"), button:has-text("예약")').count();

      for (const rule of activeRules) {
        const matched = await this.applyRule(page, rule);
        if (matched) {
          evidence.push(rule.name);
        }
      }

      const status = this.determineStatus(evidence, target.policy);
      const shouldNotify = status === 'OPEN' && previousState?.lastStatus !== 'OPEN';

      return {
        status,
        evidence,
        finalUrl,
        shouldNotify,
        notification: shouldNotify
          ? {
              title: `[${target.name}] 예약 버튼 활성화`,
              body: '예약 버튼이 활성화됐습니다!',
              clickUrl: target.urlInput,
            }
          : undefined,
        details: {
          monitorKind: target.kind,
          policy: target.policy,
        },
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
        details: {
          monitorKind: target.kind,
          policy: target.policy,
        },
      };
    }
  }

  /**
   * Flight price monitoring logic
   */
  private async checkFlightPrice(
    page: Page,
    target: FlightPriceTarget,
    previousState: TargetState | null
  ): Promise<CheckResult> {
    const currency = target.priceQuery.currency ?? 'KRW';
    const targetUrl = resolveFlightTargetUrl(target);

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await page.waitForTimeout(5000);

      const finalUrl = page.url();
      const title = await page.title().catch(() => 'unknown');
      const bodyText = await page.locator('body').innerText().catch(() => '');

      if (
        finalUrl.includes('/captcha-v2/') ||
        /(captcha|verify you are human|are you a person or a robot|귀하는 사람인가요, 로봇인가요|길게 누르기|비정상적인 트래픽|access denied)/i.test(
          bodyText
        )
      ) {
        return {
          status: 'UNKNOWN',
          evidence: ['flight-provider-blocked'],
          finalUrl,
          error: new Error('Flight provider blocked automated access'),
          details: {
            monitorKind: target.kind,
            provider: target.provider,
            blockUrl: finalUrl,
          },
        };
      }

      const selectorCandidates = await collectSelectorPriceCandidates(page, currency);
      const bodyCandidates = await collectBodyPriceCandidates(page, currency);
      const selectedCandidate = pickCurrentFlightPrice([...selectorCandidates, ...bodyCandidates]);

      if (!selectedCandidate) {
        return {
          status: 'UNKNOWN',
          evidence: ['flight-price-not-found'],
          finalUrl,
          error: new Error('Unable to detect a flight price from the provider page'),
          details: {
            monitorKind: target.kind,
            provider: target.provider,
          },
        };
      }

      const previousBest = previousState?.bestObservedValue ?? null;
      const notificationKey = `flight-price:${target.id}:${selectedCandidate.currency}:${selectedCandidate.value}`;
      const isNewLowest = previousBest === null || selectedCandidate.value < previousBest;
      const shouldNotify =
        isNewLowest && previousState?.lastNotifiedFingerprint !== notificationKey;
      const status: BookingStatus =
        previousBest === null || selectedCandidate.value <= previousBest ? 'OPEN' : 'CLOSED';
      const currentPriceLabel = formatCurrencyValue(selectedCandidate.value, selectedCandidate.currency);
      const previousPriceLabel =
        previousBest === null ? null : formatCurrencyValue(previousBest, selectedCandidate.currency);

      return {
        status,
        evidence: [
          `provider:${target.provider}`,
          `price-source:${selectedCandidate.source}`,
          `page-title:${title}`,
        ],
        finalUrl,
        observedValue: selectedCandidate.value,
        observedCurrency: selectedCandidate.currency,
        shouldNotify,
        notificationKey,
        notification: shouldNotify
          ? {
              title: `[${target.name}] 최저가 갱신 ${currentPriceLabel}`,
              body: [
                formatFlightQuerySummary(target.priceQuery),
                previousPriceLabel ? `이전 최저가: ${previousPriceLabel}` : '첫 가격 기록입니다.',
                `현재 감지 가격: ${currentPriceLabel}`,
                `감지 소스: ${selectedCandidate.source}`,
              ].join('\n'),
              clickUrl: finalUrl || targetUrl,
            }
          : undefined,
        details: {
          monitorKind: target.kind,
          provider: target.provider,
          currentPrice: selectedCandidate.value,
          previousBestPrice: previousBest,
          probeSource: selectedCandidate.source,
          directOnly: target.priceQuery.directOnly ?? false,
        },
      };
    } catch (error) {
      return {
        status: 'UNKNOWN',
        evidence: ['flight-price-error'],
        finalUrl: page.url(),
        error: error instanceof Error ? error : new Error(String(error)),
        details: {
          monitorKind: target.kind,
          provider: target.provider,
        },
      };
    }
  }

  private getActiveRules(policy: string): CheckRule[] {
    if (policy === 'C') {
      return CHECK_RULES.filter((rule) => rule.name === 'C');
    }

    return CHECK_RULES.filter((rule) => policy.includes(rule.name));
  }

  private async applyRule(page: Page, rule: CheckRule): Promise<boolean> {
    try {
      if (rule.name === 'C') {
        return await this.checkRuleC(page);
      }

      const element = page.locator(rule.selector).first();
      const count = await element.count();
      return count > 0;
    } catch {
      return false;
    }
  }

  private async checkRuleC(page: Page): Promise<boolean> {
    try {
      const elements = await page.locator('button:not(:disabled), a:not([disabled])').all();

      for (const element of elements) {
        try {
          const text = await element.textContent();
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

  private determineStatus(evidence: string[], policy: string): BookingStatus {
    if (evidence.length === 0) {
      return 'CLOSED';
    }

    if (policy.includes('C') && evidence.includes('C')) {
      return 'OPEN';
    }

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
