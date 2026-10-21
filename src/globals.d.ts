/**
 * Build identity, injected by vite.config.ts at build time.
 *
 * They travel inside the bundle so a bug report can say exactly which commit
 * the user was running, without asking them for a version they never saw.
 */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
