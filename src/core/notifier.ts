/**
 * ntfy notification module
 * Sends push notifications via ntfy.sh
 */

import type { NtfyConfig, NotificationMessage } from '../types/index.js';

/**
 * Simple logger interface for notifier
 */
interface Logger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
  info(message: string): void;
}

/**
 * Notifier interface
 */
export interface Notifier {
  send(message: NotificationMessage): Promise<void>;
}

/**
 * Default console-based logger (fallback)
 */
const defaultLogger: Logger = {
  error: (message: string, error?: unknown) => {
    const errStr = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[Notifier] ${message}${errStr ? '\n' + errStr : ''}`);
  },
  warn: (message: string) => console.warn(`[Notifier] ${message}`),
  info: (message: string) => console.log(`[Notifier] ${message}`),
};

/**
 * Encode UTF-8 string for use in HTTP headers (RFC 2047)
 * Converts non-ASCII characters to encoded-word format
 */
function encodeHeaderValue(value: string): string {
  // If value contains only ASCII characters, return as-is
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }
  // Encode using UTF-8 Base64 (RFC 2047)
  const utf8Bytes = Buffer.from(value, 'utf-8');
  const base64 = utf8Bytes.toString('base64');
  return `=?utf-8?B?${base64}?=`;
}

/**
 * ntfy.sh implementation
 */
export class NtfyNotifier implements Notifier {
  private logger: Logger;

  constructor(
    private config: NtfyConfig,
    logger?: Logger
  ) {
    this.logger = logger || defaultLogger;
  }

  /**
   * Send notification via ntfy
   */
  async send(message: NotificationMessage): Promise<void> {
    const url = `${this.config.serverUrl}/${this.config.topic}`;

    const headers: Record<string, string> = {
      'Title': encodeHeaderValue(message.title),
      'Click': message.clickUrl,
      'Priority': this.config.priority,
    };

    if (this.config.tags.length > 0) {
      headers['Tags'] = this.config.tags.join(',');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...headers,
        },
        body: message.body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`ntfy request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      this.logger.info(`Notification sent successfully to topic: ${this.config.topic}`);
    } catch (error) {
      // Log but don't throw - notification failures shouldn't crash the app
      this.logger.error('Failed to send notification', error);
      throw error;
    }
  }

  /**
   * Send test notification
   */
  async sendTest(): Promise<void> {
    await this.send({
      title: 'Naver Booking Ping - Test',
      body: 'This is a test notification. Your ntfy setup is working!',
      clickUrl: 'https://booking.naver.com/',
    });
  }
}

/**
 * Create a new ntfy notifier
 */
export function createNotifier(
  config: NtfyConfig,
  logger?: Logger
): Notifier {
  return new NtfyNotifier(config, logger);
}
