export function logInfo(scope, message, meta = {}) {
  // Keep this simple; later we can write to quote_events if desired.
  // eslint-disable-next-line no-console
  console.info(`[${scope}] ${message}`, meta);
}

export function logError(scope, message, meta = {}) {
  // eslint-disable-next-line no-console
  console.error(`[${scope}] ${message}`, meta);
}
