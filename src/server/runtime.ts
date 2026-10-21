/**
 * Which runtime is this?
 *
 * The Worker and the local Node process share the same code, and they differ
 * in two ways that matter: the Worker has no listening socket (the platform
 * owns it) and no `.env` file (the configuration arrives as bindings).
 *
 * The Workers runtime identifies itself in the user agent.
 */
export function isWorkersRuntime(): boolean {
  return (
    typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
  );
}
