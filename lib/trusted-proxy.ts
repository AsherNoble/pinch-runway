// The ChatGPT proxy injects the verified oai-* operator identity headers only
// after stripping any client-supplied copies. A request that reaches the Worker
// at its raw *.workers.dev origin (including per-version preview URLs) skips the
// proxy, so any oai-* header on it is attacker-supplied. Cloudflare validates
// the real Host header against the TLS SNI, so — unlike the client-controllable
// x-forwarded-host — it cannot be forged to impersonate the proxy host, which
// makes the raw Host the only reliable signal for where the request landed.

type ProxyEnv = { RUNWAY_TRUSTED_PROXY_HOSTS?: string | undefined };

function trustedProxyHosts(env: ProxyEnv): string[] {
  return (env.RUNWAY_TRUSTED_PROXY_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True only when `rawHost` (the Cloudflare-validated Host header) identifies a
 * request that arrived through the trusted ChatGPT proxy, and is therefore
 * allowed to carry a verified operator identity.
 */
export function isTrustedProxyRequest(
  rawHost: string | null | undefined,
  env: ProxyEnv = process.env,
): boolean {
  if (!rawHost) return false;
  const host = rawHost.split(":")[0].trim().toLowerCase();
  if (!host) return false;

  const allowlist = trustedProxyHosts(env);
  if (allowlist.length > 0) return allowlist.includes(host);

  // No explicit allowlist configured: fail safe against the known bypass by
  // refusing identity asserted at a bare Cloudflare origin. The proxied app is
  // never served from a *.workers.dev host, so this cannot affect production.
  return host !== "workers.dev" && !host.endsWith(".workers.dev");
}
