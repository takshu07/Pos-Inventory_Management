import { logger } from "../config/logger";

/**
 * Generic retry wrapper for database transactions and flaky network calls.
 * Implements exponential backoff.
 * 
 * @param operation The async function to execute.
 * @param retryCondition A function that receives the error and returns true if it should be retried.
 * @param maxRetries Maximum number of retries before bubbling the error (default: 3).
 * @param baseDelayMs Base delay in milliseconds for exponential backoff (default: 100).
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  retryCondition: (error: any) => boolean,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;

      if (attempt > maxRetries || !retryCondition(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        { attempt, maxRetries, delayMs, error: error instanceof Error ? error.message : "Unknown error" },
        "Operation failed, retrying..."
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
