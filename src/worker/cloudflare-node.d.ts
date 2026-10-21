/**
 * The types of the Cloudflare-provided modules.
 *
 * `cloudflare:node` is resolved by the Workers runtime, not by npm, so
 * TypeScript cannot find it on its own. The declaration is deliberately
 * narrow: it names the one function this Worker uses.
 */
declare module 'cloudflare:node' {
  /**
   * Hand a Worker request to a Node HTTP server running in the same
   * isolate, and return its response.
   */
  export function handleAsNodeRequest(port: number, request: Request): Promise<Response>;
}
