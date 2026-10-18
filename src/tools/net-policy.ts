import dns from "node:dns/promises";
import net from "node:net";

/**
 * Outbound-request policy shared by every tool that fetches a URL on the
 * model's behalf (browse, playwright, api_test, site crawler).
 *
 *  - http(s) only for navigation/requests;
 *  - no private-network, link-local or cloud-metadata destinations unless
 *    KOODER_BROWSE_ALLOW_PRIVATE=1 (legacy XCODER_BROWSE_ALLOW_PRIVATE=1 also honoured);
 *    loopback is always allowed so local apps can be tested;
 *  - hostnames are RESOLVED and every address re-checked (a public name that
 *    points at 10.x / 169.254.169.254 is blocked);
 *  - redirects are followed manually so every hop goes through the same checks,
 *    and Authorization/Cookie are dropped on a cross-origin hop.
 *
 * Residual risk: DNS rebinding between our lookup and the socket connect. Closing
 * that needs a pinned-IP dispatcher; run the agent in a network-restricted
 * container if the threat model includes it.
 */

export function allowPrivate(): boolean {
  return process.env.KOODER_BROWSE_ALLOW_PRIVATE === "1" || process.env.XCODER_BROWSE_ALLOW_PRIVATE === "1";
}

export function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return false; // loopback is allowed (local apps)
  return (
    a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  );
}

export function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false; // a domain name like "fd-cdn.example.com", not an IPv6 literal
  if (h === "::1") return false; // loopback allowed
  // IPv4-mapped: WHATWG URL normalises ::ffff:10.0.0.1 to ::ffff:a00:1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice(7));
  return /^(fc|fd)/.test(h) || /^fe[89ab]/.test(h) || h === "::";
}

/** Returns a reason string if the URL must be blocked, otherwise null. */
export function checkRequestAllowed(rawUrl: string, opts: { navigation?: boolean } = {}): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return `invalid URL "${rawUrl}"`;
  }
  const proto = u.protocol;
  if (proto === "http:" || proto === "https:") {
    const host = u.hostname.toLowerCase();
    if (allowPrivate()) return null;
    if (host === "metadata.google.internal" || host.endsWith(".internal") || host === "metadata") return `host "${host}" is blocked (cloud metadata)`;
    if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
      return `private-network address "${host}" is blocked (set KOODER_BROWSE_ALLOW_PRIVATE=1 to allow; localhost is always allowed)`;
    }
    return null;
  }
  // Sub-resources may be data:/blob:/about:, but navigation must be http(s).
  if (!opts.navigation && (proto === "data:" || proto === "blob:" || proto === "about:")) return null;
  return `scheme "${proto}" is not allowed (http and https only)`;
}

/** Resolves the hostname and re-applies the private-range check to every address. */
export async function checkResolvedHost(rawUrl: string): Promise<string | null> {
  if (allowPrivate()) return null;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return `invalid URL "${rawUrl}"`;
  }
  if (host === "localhost" || net.isIP(host)) return null; // literals were handled by checkRequestAllowed
  try {
    const addrs = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), 2000).unref()),
    ]);
    for (const a of addrs) {
      if (isPrivateIPv4(a.address) || isPrivateIPv6(a.address)) {
        return `host "${host}" resolves to private-network address ${a.address} — blocked`;
      }
    }
  } catch {
    // Unresolvable: let the real request fail with its own, clearer error.
  }
  return null;
}

export class RequestBlockedError extends Error {}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** fetch() with the policy applied to the first URL and to every redirect hop. */
export async function safeFetch(url: string, init: RequestInit = {}, opts: { maxRedirects?: number } = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}) };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const why = checkRequestAllowed(current, { navigation: true }) ?? (await checkResolvedHost(current));
    if (why) throw new RequestBlockedError(why);

    const res = await fetch(current, { ...init, method, body, headers, redirect: "manual" });
    if (!REDIRECT_STATUS.has(res.status)) return res;

    const location = res.headers?.get?.("location");
    if (!location) return res;
    const next = new URL(location, current);
    if (next.origin !== new URL(current).origin) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => !/^(authorization|cookie|proxy-authorization)$/i.test(k))
      );
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD")) {
      method = "GET";
      body = undefined;
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-(type|length)$/i.test(k)));
    }
    current = next.toString();
  }
  throw new RequestBlockedError(`too many redirects (> ${maxRedirects})`);
}
