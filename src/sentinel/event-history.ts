// xcoder:version 7 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:43:52.349Z | xcoder:subtask test-st-50b14d
/**
 * The two stateful facts the policy engine needs, kept out of the engine so
 * it stays pure and unit-testable. In-memory and non-persisted in v1; the
 * fact that matters (is this IP blocked?) comes from the OS, not memory.
 */
import type { Clock } from './runtime.js';
import type { ModelAnalysis, SentinelEvent } from './schema.js';
import type { Firewall } from './system-tools.js';

export interface EventHistory {
  failedAuthCount(ip: string, windowMs: number): number;
  record(event: SentinelEvent, analysis: ModelAnalysis, at: Date): void;
  isBlocked(ip: string): boolean;
  rememberBlocked(ip: string, value: boolean): void;
  prune(now: Date, maxAgeMs: number): void;
  /** Optional: true when the cached block state is still within its TTL. */
  hasFreshBlockState?(ip: string): boolean;
  /** Optional: re-read authoritative OS block state and cache it. */
  refreshBlocked?(ip: string): Promise<boolean>;
}

/** How long a remembered block answer may be trusted before an OS re-read. */
export const BLOCK_CACHE_TTL_MS = 15000;

interface Entry {
  at: number;
  failedAuth: boolean;
}

/** Failed-auth categories that count toward brute-force thresholds. */
const FAILED_AUTH: ReadonlySet<ModelAnalysis['category']> = new Set([
  'auth_failure',
  'brute_force',
  'root_login_attempt',
]);

export class InMemoryEventHistory implements EventHistory {
  private readonly byIp = new Map<string, Entry[]>();
  private readonly blockedCache = new Map<string, { at: number; value: boolean }>();
  private total = 0;

  constructor(
    private readonly deps: {
      firewall: Pick<Firewall, 'isBlocked'>;
      clock: Clock;
      maxEntries: number;
    },
  ) {}

  failedAuthCount(ip: string, windowMs: number): number {
    const list = this.byIp.get(ip);
    if (!list) return 0;
    const cutoff = this.deps.clock.now().getTime() - windowMs;
    let n = 0;
    for (const e of list) if (e.failedAuth && e.at >= cutoff) n += 1;
    return n;
  }

  record(event: SentinelEvent, analysis: ModelAnalysis, at: Date): void {
    const ip = event.sourceIp;
    if (!ip) return;
    const entry: Entry = {
      at: at.getTime(),
      failedAuth: analysis.threatDetected && FAILED_AUTH.has(analysis.category),
    };
    const list = this.byIp.get(ip) ?? [];
    list.push(entry);
    this.byIp.set(ip, list);
    this.total += 1;
    // Bounded by construction: a log flood cannot grow memory without limit.
    while (this.total > this.deps.maxEntries) this.evictOldest();
  }

  isBlocked(ip: string): boolean {
    // Volatile-detection / durable-action: the OS is authoritative, so a
    // restart or a manual iptables change cannot make us disagree with it.
    // Only a entry inside the freshness window may be trusted; once stale we
    // must NOT keep asserting 'blocked', because the rule may have been
    // removed. Policy sees 'not blocked', and the firewall tool re-checks
    // with `iptables -C` before writing, so a stale answer can only cost a
    // redundant no-op call - it can never cause a missed block.
    const cached = this.blockedCache.get(ip);
    if (cached === undefined) return false;
    if (this.deps.clock.now().getTime() - cached.at < BLOCK_CACHE_TTL_MS) return cached.value;
    return false;
  }

  /** True if the cached answer is still fresh enough to skip an OS read. */
  hasFreshBlockState(ip: string): boolean {
    const cached = this.blockedCache.get(ip);
    if (cached === undefined) return false;
    return this.deps.clock.now().getTime() - cached.at < BLOCK_CACHE_TTL_MS;
  }

  /** Re-read the authoritative OS state and cache it. */
  async refreshBlocked(ip: string): Promise<boolean> {
    const value = await this.deps.firewall.isBlocked(ip);
    this.rememberBlocked(ip, value);
    return value;
  }

  /** Called by the daemon after refreshing isBlocked from the firewall. */
  rememberBlocked(ip: string, value: boolean): void {
    this.blockedCache.set(ip, { at: this.deps.clock.now().getTime(), value });
  }

  prune(now: Date, maxAgeMs: number): void {
    const cutoff = now.getTime() - maxAgeMs;
    for (const [ip, list] of this.byIp) {
      const kept = list.filter((e) => e.at >= cutoff);
      if (kept.length === 0) {
        this.total -= list.length;
        this.byIp.delete(ip);
      } else {
        this.total -= list.length - kept.length;
        this.byIp.set(ip, kept);
      }
    }
    for (const [ip, c] of this.blockedCache) {
      if (now.getTime() - c.at > maxAgeMs) this.blockedCache.delete(ip);
    }
  }

  private evictOldest(): void {
    let oldestIp: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [ip, list] of this.byIp) {
      const head = list[0];
      if (head && head.at < oldestAt) {
        oldestAt = head.at;
        oldestIp = ip;
      }
    }
    if (oldestIp === null) return;
    const list = this.byIp.get(oldestIp);
    if (!list) return;
    list.shift();
    this.total -= 1;
    if (list.length === 0) this.byIp.delete(oldestIp);
  }
}
