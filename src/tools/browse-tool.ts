import fs from "node:fs";
import path from "node:path";
import { resolveCredential, redact } from "./credential.js";
import { createKooderPaths } from "../util/kooder-paths.js";
import { checkRequestAllowed } from "./net-policy.js";
/**
 * `browse` — let the agent (or `xcoder browse …`) drive a real browser through
 * a list of steps: navigate, click, type, read text/links, screenshot, assert.
 * Unlike `ui_test` (pass/fail only) it RETURNS what it read, so the model can
 * decide its next step. Requires the optional `playwright` dependency.
 *
 * Safety:
 *  - every request (navigation, redirect, sub-resource) goes through
 *    `checkRequestAllowed` — http(s) only, no file:/chrome:/ftp:, and no
 *    private-network or cloud-metadata hosts unless KOODER_BROWSE_ALLOW_PRIVATE=1
 *    (localhost is always allowed so local apps can be tested);
 *  - secrets are typed via `credentialRef` (env var name) and never returned;
 *    LLM / GitHub key variables can never be used as a credentialRef;
 *  - screenshots can only be written inside the workspace.
 */

export type BrowseStep =
  | { op: "goto"; url: string }
  | { op: "click" | "hover" | "check" | "uncheck"; selector: string }
  | { op: "fill" | "type"; selector: string; value?: string; credentialRef?: string }
  | { op: "select"; selector: string; value: string }
  | { op: "press"; key: string; selector?: string }
  | { op: "scroll"; to: "top" | "bottom" | "up" | "down" | string }
  | { op: "wait_for"; selector: string; state?: "visible" | "hidden" | "attached" | "detached"; timeoutMs?: number }
  | { op: "wait"; ms: number }
  | { op: "text"; selector?: string }
  | { op: "attr"; selector: string; name: string }
  | { op: "links"; selector?: string }
  | { op: "title" | "url" | "back" | "forward" | "reload" | "close" }
  | { op: "screenshot"; path?: string; fullPage?: boolean }
  | { op: "expect_text"; selector: string; text: string }
  | { op: "expect_url"; contains: string };

export interface BrowseInput {
  /** Optional starting URL (same as a leading `goto` step). */
  url?: string;
  steps: BrowseStep[];
  /** Keep the browser open between calls under this name (cookies/login survive). End with {op:"close"}. */
  session?: string;
  headed?: boolean;
  /** Per-step timeout, default 10000. */
  timeoutMs?: number;
}

export interface BrowseStepResult {
  op: string;
  ok: boolean;
  note: string;
  data?: unknown;
}

export interface BrowseResult {
  ok: boolean;
  detail: string;
  steps: BrowseStepResult[];
  page?: { url: string; title: string; text: string };
  screenshots: string[];
}

const MAX_TEXT = 4000;
const MAX_LINKS = 50;
const MAX_SESSIONS = 3;
const FORBIDDEN_CREDENTIAL_REFS = /^(KOODER_API_KEY|XCODER_API_KEY|DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN)$/i;

// ── URL policy (implemented in net-policy.ts; re-exported for existing callers) ──

export { checkRequestAllowed, isPrivateIPv4, isPrivateIPv6 } from "./net-policy.js";

// ── sessions ────────────────────────────────────────────────────────────────

interface Session {
  browser: { close(): Promise<void> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
}
const sessions = new Map<string, Session>();

export async function closeAllBrowseSessions(): Promise<void> {
  for (const [name, s] of sessions) {
    sessions.delete(name);
    await s.browser.close().catch(() => undefined);
  }
}

// ── step DSL for the CLI:  xcoder browse --step "click:#login" ───────────────

/** Split "SEL=VALUE" at the first `=` that is not inside [] or quotes. */
export function splitSelectorValue(s: string): [string, string | undefined] {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (c === "=" && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, undefined];
}

export function parseStepSpec(spec: string): BrowseStep {
  const raw = spec.trim();
  if (/^https?:\/\//i.test(raw)) return { op: "goto", url: raw };
  const colon = raw.indexOf(":");
  const op = (colon === -1 ? raw : raw.slice(0, colon)).trim().toLowerCase();
  const rest = colon === -1 ? "" : raw.slice(colon + 1).trim();
  const need = (what: string): string => {
    if (!rest) throw new Error(`step "${spec}": ${op} needs ${what}`);
    return rest;
  };
  const pair = (what: string): [string, string] => {
    const [sel, val] = splitSelectorValue(need(what));
    if (val === undefined) throw new Error(`step "${spec}": expected ${op}:SELECTOR=VALUE`);
    return [sel, val];
  };
  switch (op) {
    case "goto":
    case "open":
      return { op: "goto", url: need("a URL") };
    case "click":
    case "hover":
    case "check":
    case "uncheck":
      return { op, selector: need("a selector") };
    case "fill":
    case "type": {
      const [selector, value] = pair("SELECTOR=VALUE");
      return { op, selector, value };
    }
    case "select": {
      const [selector, value] = pair("SELECTOR=VALUE");
      return { op: "select", selector, value };
    }
    case "press": {
      const [sel, val] = splitSelectorValue(need("a key"));
      return val === undefined ? { op: "press", key: sel } : { op: "press", selector: sel, key: val };
    }
    case "scroll":
      return { op: "scroll", to: need("top|bottom|up|down|SELECTOR") };
    case "wait": {
      if (/^\d+$/.test(rest)) return { op: "wait", ms: Number(rest) };
      return { op: "wait_for", selector: need("milliseconds or a selector") };
    }
    case "text":
      return rest ? { op: "text", selector: rest } : { op: "text" };
    case "links":
      return rest ? { op: "links", selector: rest } : { op: "links" };
    case "attr": {
      const at = need("SELECTOR@attribute").lastIndexOf("@");
      if (at < 1) throw new Error(`step "${spec}": expected attr:SELECTOR@name`);
      return { op: "attr", selector: rest.slice(0, at), name: rest.slice(at + 1) };
    }
    case "title":
    case "url":
    case "back":
    case "forward":
    case "reload":
    case "close":
      return { op };
    case "screenshot":
    case "shot":
      return rest ? { op: "screenshot", path: rest } : { op: "screenshot" };
    case "expect_text": {
      const [selector, text] = pair("SELECTOR=TEXT");
      return { op: "expect_text", selector, text };
    }
    case "expect_url":
      return { op: "expect_url", contains: need("text the URL contains") };
    default:
      throw new Error(`unknown step "${spec}" (goto, click, fill, type, press, select, check, hover, scroll, wait, text, links, attr, title, url, screenshot, back, forward, reload, expect_text, expect_url)`);
  }
}

// ── runner ──────────────────────────────────────────────────────────────────

const clip = (s: string, n = MAX_TEXT): string => (s.length > n ? `${s.slice(0, n)}… [truncated ${s.length - n} chars]` : s);

function screenshotTarget(root: string, requested?: string): string {
  const shotsDir = createKooderPaths(root).screenshotsDir();
  const rel =
    requested ??
    path.relative(root, path.join(shotsDir, `shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`));
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`screenshot path "${rel}" is outside the workspace`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // Resolve symlinks on the directory so a link inside the workspace can't redirect the write.
  const realDir = fs.realpathSync(path.dirname(full));
  const realBase = fs.realpathSync(base);
  if (realDir !== realBase && !realDir.startsWith(realBase + path.sep)) throw new Error(`screenshot path "${rel}" resolves outside the workspace`);
  return path.join(realDir, path.basename(full));
}

export async function runBrowse(root: string, input: BrowseInput): Promise<BrowseResult> {
  const results: BrowseStepResult[] = [];
  const screenshots: string[] = [];
  const fail = (detail: string): BrowseResult => ({ ok: false, detail, steps: results, screenshots });

  const steps: BrowseStep[] = [...(input.url ? [{ op: "goto", url: input.url } as BrowseStep] : []), ...(input.steps ?? [])];
  if (steps.length === 0) return fail("no steps given");

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return fail("the `playwright` package isn't installed. Run `npm install` then `npx playwright install chromium`.");
  }

  const sessionName = input.session?.trim() || undefined;
  let session = sessionName ? sessions.get(sessionName) : undefined;
  let created = false;
  if (!session) {
    if (sessionName && sessions.size >= MAX_SESSIONS) return fail(`too many open browser sessions (max ${MAX_SESSIONS}); close one with {"op":"close"}`);
    const browser = await chromium.launch({ headless: !input.headed });
    const context = await browser.newContext();
    await context.route("**/*", (route: any) => {
      const why = checkRequestAllowed(route.request().url(), { navigation: route.request().isNavigationRequest() });
      if (why) return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    session = { browser, page };
    created = true;
    if (sessionName) sessions.set(sessionName, session);
  }
  const { page } = session;
  page.setDefaultTimeout(input.timeoutMs ?? 10000);

  let ok = true;
  let closeRequested = false;
  const secretRefs: string[] = [];

  try {
    for (const step of steps) {
      const label = step.op;
      try {
        switch (step.op) {
          case "goto": {
            const why = checkRequestAllowed(step.url, { navigation: true });
            if (why) throw new Error(why);
            const resp = await page.goto(step.url, { waitUntil: "domcontentloaded" });
            results.push({ op: label, ok: true, note: `${step.url} → ${resp ? resp.status() : "no response"}` });
            break;
          }
          case "click":
          case "hover":
          case "check":
          case "uncheck":
            await page[step.op](step.selector);
            results.push({ op: label, ok: true, note: step.selector });
            break;
          case "fill":
          case "type": {
            let value = step.value;
            if (step.credentialRef) {
              if (FORBIDDEN_CREDENTIAL_REFS.test(step.credentialRef)) throw new Error(`credentialRef "${step.credentialRef}" is not allowed in browse`);
              value = resolveCredential(step.credentialRef);
              secretRefs.push(step.credentialRef);
            }
            if (value === undefined) throw new Error(`${step.op} needs "value" or "credentialRef"`);
            if (step.op === "fill") await page.fill(step.selector, value);
            else await page.type(step.selector, value);
            results.push({ op: label, ok: true, note: `${step.selector}${step.credentialRef ? " (value redacted)" : ""}` });
            break;
          }
          case "select":
            await page.selectOption(step.selector, step.value);
            results.push({ op: label, ok: true, note: `${step.selector} = ${step.value}` });
            break;
          case "press":
            if (step.selector) await page.press(step.selector, step.key);
            else await page.keyboard.press(step.key);
            results.push({ op: label, ok: true, note: step.key });
            break;
          case "scroll": {
            if (["top", "bottom", "up", "down"].includes(step.to)) {
              // Browser-side code is passed as a string so this file needs no DOM typings.
              await page.evaluate(
                `(() => { const to = ${JSON.stringify(step.to)}; const h = document.documentElement.scrollHeight;
                  if (to === "top") window.scrollTo(0, 0);
                  else if (to === "bottom") window.scrollTo(0, h);
                  else window.scrollBy(0, to === "down" ? window.innerHeight * 0.8 : -window.innerHeight * 0.8); })()`
              );
            } else {
              await page.locator(step.to).first().scrollIntoViewIfNeeded();
            }
            results.push({ op: label, ok: true, note: step.to });
            break;
          }
          case "wait_for":
            await page.waitForSelector(step.selector, { state: step.state ?? "visible", timeout: step.timeoutMs });
            results.push({ op: label, ok: true, note: `${step.selector} ${step.state ?? "visible"}` });
            break;
          case "wait":
            await page.waitForTimeout(Math.min(Math.max(step.ms, 0), 30000));
            results.push({ op: label, ok: true, note: `${step.ms}ms` });
            break;
          case "text": {
            const t: string = (await page.innerText(step.selector ?? "body")) ?? "";
            results.push({ op: label, ok: true, note: step.selector ?? "body", data: clip(t) });
            break;
          }
          case "attr": {
            const v = await page.getAttribute(step.selector, step.name);
            results.push({ op: label, ok: true, note: `${step.selector}@${step.name}`, data: v });
            break;
          }
          case "links": {
            const links = (await page.$$eval(
              `${step.selector ?? "body"} a[href]`,
              `(as) => as.map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.href }))`
            )) as { text: string; href: string }[];
            results.push({ op: label, ok: true, note: `${links.length} link(s)`, data: links.slice(0, MAX_LINKS) });
            break;
          }
          case "title":
            results.push({ op: label, ok: true, note: await page.title() });
            break;
          case "url":
            results.push({ op: label, ok: true, note: page.url() });
            break;
          case "back":
          case "forward":
          case "reload": {
            const fn = step.op === "back" ? "goBack" : step.op === "forward" ? "goForward" : "reload";
            await page[fn]({ waitUntil: "domcontentloaded" });
            results.push({ op: label, ok: true, note: page.url() });
            break;
          }
          case "screenshot": {
            const target = screenshotTarget(root, step.path);
            await page.screenshot({ path: target, fullPage: step.fullPage ?? false });
            const rel = path.relative(root, target) || target;
            screenshots.push(rel);
            results.push({ op: label, ok: true, note: rel });
            break;
          }
          case "expect_text": {
            const content: string | null = await page.textContent(step.selector);
            const hit = !!content && content.includes(step.text);
            results.push({ op: label, ok: hit, note: hit ? "matched" : `expected "${step.text}", got "${clip(content ?? "", 200)}"` });
            if (!hit) ok = false;
            break;
          }
          case "expect_url": {
            const hit = page.url().includes(step.contains);
            results.push({ op: label, ok: hit, note: hit ? "matched" : `got ${page.url()}` });
            if (!hit) ok = false;
            break;
          }
          case "close":
            closeRequested = true;
            results.push({ op: label, ok: true, note: "browser closed" });
            break;
          default:
            throw new Error(`unknown op "${(step as { op: string }).op}"`);
        }
      } catch (e) {
        ok = false;
        let msg = (e as Error).message;
        for (const ref of secretRefs) msg = redact(msg, ref);
        results.push({ op: label, ok: false, note: clip(msg, 500) });
        break; // stop at the first hard failure
      }
      if (closeRequested) break;
    }

    let pageInfo: BrowseResult["page"];
    if (!closeRequested) {
      try {
        pageInfo = {
          url: page.url(),
          title: await page.title(),
          text: clip(((await page.innerText("body").catch(() => "")) as string).replace(/\n{3,}/g, "\n\n"), 2000),
        };
      } catch {
        pageInfo = undefined;
      }
    }
    return {
      ok,
      detail: ok ? "all steps completed" : "a step failed — see `steps`",
      steps: results,
      page: pageInfo,
      screenshots,
    };
  } finally {
    const keepOpen = sessionName && !closeRequested && ok;
    if (!keepOpen) {
      if (sessionName) sessions.delete(sessionName);
      if (created || sessionName) await session.browser.close().catch(() => undefined);
    }
  }
}
