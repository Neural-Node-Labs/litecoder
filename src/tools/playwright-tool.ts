import { resolveCredential, redact } from "./credential.js";
import { checkRequestAllowed, safeFetch } from "./net-policy.js";

/**
 * Declarative test steps only — the model describes *what* to do, this
 * module is the only thing that ever touches a browser or an HTTP client.
 * That split is what keeps a resolved credential out of the model's
 * context: the model hands us a `credentialRef` (an env var name); we
 * resolve it here, use it, and never put the resolved value in the
 * returned result.
 */
export type UiStep =
  | { op: "goto"; url: string }
  | { op: "fill"; selector: string; value: string }
  | { op: "click"; selector: string }
  | { op: "expect_text"; selector: string; text: string }
  | { op: "expect_url"; contains: string }
  | { op: "login_with_credential"; usernameSelector: string; passwordSelector: string; submitSelector: string; usernameValue: string };

export interface UiTestInput {
  kind: "ui";
  url: string;
  credentialRef?: string;
  steps: UiStep[];
}

export interface ApiTestInput {
  kind: "api";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  credentialRef?: string; // resolved value sent as `Authorization: Bearer <value>`
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number;
  expectBodyContains?: string;
}

export type PlaywrightToolInput = UiTestInput | ApiTestInput;

export interface PlaywrightToolResult {
  ok: boolean;
  detail: string;
  steps: { op: string; ok: boolean; note: string }[];
}

export async function runApiTest(input: ApiTestInput): Promise<PlaywrightToolResult> {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (input.credentialRef) {
    headers["Authorization"] = `Bearer ${resolveCredential(input.credentialRef)}`;
  }
  try {
    const res = await safeFetch(input.url, {
      method: input.method,
      headers,
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    });
    const text = await res.text();
    const statusOk = input.expectStatus === undefined || res.status === input.expectStatus;
    const bodyOk = !input.expectBodyContains || text.includes(input.expectBodyContains);
    const ok = statusOk && bodyOk;
    const detail = redact(
      `${input.method} ${input.url} → ${res.status}` +
        (input.expectStatus !== undefined ? ` (expected ${input.expectStatus})` : "") +
        (input.expectBodyContains ? `, body ${bodyOk ? "contains" : "MISSING"} expected substring` : ""),
      input.credentialRef
    );
    return {
      ok,
      detail,
      steps: [{ op: "http_request", ok, note: detail }],
    };
  } catch (e) {
    return {
      ok: false,
      detail: redact(`request failed: ${(e as Error).message}`, input.credentialRef),
      steps: [{ op: "http_request", ok: false, note: (e as Error).message }],
    };
  }
}

/**
 * Requires the optional `playwright` dependency (`npm install`, then
 * `npx playwright install chromium` once). Imported dynamically so the
 * rest of Kooder works without it if a task never needs a UI test.
 */
export async function runUiTest(input: UiTestInput): Promise<PlaywrightToolResult> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      ok: false,
      detail:
        "the `playwright` package isn't installed. Run `npm install` (it's an " +
        "optionalDependency) then `npx playwright install chromium`.",
      steps: [],
    };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  // Every request (navigation, redirect, sub-resource) goes through the shared URL policy.
  await context.route("**/*", (route: { request(): { url(): string; isNavigationRequest(): boolean }; abort(reason?: string): Promise<void>; continue(): Promise<void> }) => {
    const why = checkRequestAllowed(route.request().url(), { navigation: route.request().isNavigationRequest() });
    return why ? route.abort("blockedbyclient") : route.continue();
  });
  const page = await context.newPage();
  const stepResults: { op: string; ok: boolean; note: string }[] = [];
  let overallOk = true;

  try {
    const blocked = checkRequestAllowed(input.url, { navigation: true });
    if (blocked) throw new Error(blocked);
    await page.goto(input.url, { waitUntil: "domcontentloaded" });
    stepResults.push({ op: "goto", ok: true, note: input.url });

    for (const step of input.steps) {
      try {
        switch (step.op) {
          case "goto":
            {
              const why = checkRequestAllowed(step.url, { navigation: true });
              if (why) throw new Error(why);
            }
            await page.goto(step.url, { waitUntil: "domcontentloaded" });
            stepResults.push({ op: "goto", ok: true, note: step.url });
            break;
          case "fill":
            await page.fill(step.selector, step.value);
            stepResults.push({ op: "fill", ok: true, note: step.selector });
            break;
          case "click":
            await page.click(step.selector);
            stepResults.push({ op: "click", ok: true, note: step.selector });
            break;
          case "expect_text": {
            const content = await page.textContent(step.selector);
            const ok = !!content && content.includes(step.text);
            stepResults.push({
              op: "expect_text",
              ok,
              note: ok ? "matched" : `expected "${step.text}", got "${content}"`,
            });
            if (!ok) overallOk = false;
            break;
          }
          case "expect_url": {
            const ok = page.url().includes(step.contains);
            stepResults.push({ op: "expect_url", ok, note: ok ? "matched" : `got ${page.url()}` });
            if (!ok) overallOk = false;
            break;
          }
          case "login_with_credential": {
            const password = resolveCredential(input.credentialRef ?? "");
            await page.fill(step.usernameSelector, step.usernameValue);
            await page.fill(step.passwordSelector, password);
            await page.click(step.submitSelector);
            stepResults.push({ op: "login_with_credential", ok: true, note: "submitted (value redacted)" });
            break;
          }
        }
      } catch (e) {
        overallOk = false;
        stepResults.push({ op: step.op, ok: false, note: redact((e as Error).message, input.credentialRef) });
        break; // stop on first hard failure — no point clicking further into a broken page
      }
    }
  } finally {
    await browser.close();
  }

  return {
    ok: overallOk,
    detail: overallOk ? "all steps passed" : "one or more steps failed — see `steps`",
    steps: stepResults,
  };
}

export async function runPlaywrightTool(input: PlaywrightToolInput): Promise<PlaywrightToolResult> {
  return input.kind === "api" ? runApiTest(input) : runUiTest(input);
}
