const RETRYABLE_NETWORK_PATTERN =
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network timeout|other side closed/i;

export function isRetryableError(error) {
  const message = String(error?.message || "");

  if (RETRYABLE_NETWORK_PATTERN.test(message)) {
    return true;
  }

  const status = Number(message.match(/HTTP (\d{3})/)?.[1]);
  if (Number.isFinite(status)) {
    // Rate limiting and server faults are worth another attempt.
    // Other 4xx responses mean the request itself is wrong.
    return status === 429 || status >= 500;
  }

  return false;
}

export async function withRetry(label, operation, options = {}) {
  const attempts = parsePositiveInteger(options.attempts, 4);
  const baseDelayMs = parsePositiveInteger(options.baseDelayMs, 1000);
  const sleep = options.sleep || defaultSleep;
  const log = options.log || ((message) => console.warn(message));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      log(
        `${label} failed on attempt ${attempt} of ${attempts} (${error.message}). Retrying in ${delayMs}ms.`
      );
      await sleep(delayMs);
    }
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}
