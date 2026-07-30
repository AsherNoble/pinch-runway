// The single hostname this app is served from. Pinning it in one place keeps the
// public origin out of request headers: `x-forwarded-host` is client-controllable,
// so anything derived from it (canonical URLs, OG image URLs) follows whatever
// host a caller asserts. Anything that needs to name the deployed site should
// import from here rather than reading a header.

export const CANONICAL_HOST = "pinch-runway.asherthenoble.chatgpt.site";

export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

// Matches only a bare loopback host with an optional port. Anchored on purpose:
// a prefix test would accept `localhost.example.com` and `[::1].example.com`,
// and the latter is not even a parseable URL host.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/** True for the loopback hosts used during local development. */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return LOOPBACK_HOST.test(host.trim().toLowerCase());
}

/**
 * Base URL for resolving absolute metadata URLs. Always the pinned canonical
 * origin, except on a loopback host so `npm run dev` resolves assets locally.
 */
export function resolveMetadataBase(host: string | null | undefined): URL {
  return isLocalHost(host)
    ? new URL(`http://${host!.trim().toLowerCase()}`)
    : new URL(CANONICAL_ORIGIN);
}
