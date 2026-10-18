// xcoder:version 4 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T15:52:16.274Z | xcoder:subtask code-st-97a4d4
/**
 * apiTestTool — Make HTTP requests to test API endpoints.
 *
 * Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS with custom headers,
 * JSON/Form/Text bodies, query parameters, and optional response validation.
 * Returns structured results including status, headers, body, and timing.
 */
import { resolveCredential } from "./credential.js";
import { safeFetch } from "./net-policy.js";

export interface ApiTestResult {
  url: string;
  method: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown; // parsed JSON if Content-Type is JSON, otherwise raw string
  bodyTruncated: boolean;
  durationMs: number;
  contentType: string;
}

export interface ApiTestOptions {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  /** Optional query parameters appended to the URL */
  queryParams?: Record<string, string>;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body — string, object (serialized as JSON), or omitted */
  body?: string | Record<string, unknown>;
  /** How to encode the body. Defaults to 'json' if body is an object, 'text' if string. */
  bodyType?: "json" | "text" | "form";
  /** Max response body length in characters before truncation (default: 10000) */
  maxBodyLength?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** If set, the tool will assert the response status matches this value and return an error if not */
  expectStatus?: number;
  /** If set, the tool will assert the response body contains this string and return an error if not */
  expectBodyContains?: string;
  /** Reference to an environment variable holding a credential — resolved at tool level and NEVER returned to the LLM. Injected as Authorization: Bearer <value>. */
  credentialRef?: string;
}

/**
 * Execute an HTTP request against an API endpoint and return structured results.
 */
export async function testApiEndpoint(opts: ApiTestOptions): Promise<ApiTestResult> {
  const {
    url,
    method,
    queryParams,
    headers: customHeaders,
    body,
    bodyType,
    maxBodyLength = 10000,
    timeout = 30000,
  } = opts;

  // Build URL with query params
  let targetUrl = url;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams(queryParams);
    targetUrl += (url.includes("?") ? "&" : "?") + params.toString();
  }

  // Build fetch options
  const fetchHeaders: Record<string, string> = {
    ...customHeaders,
  };

  // Resolve credentialRef at tool level — the raw value never leaves this function
  if (opts.credentialRef) {
    fetchHeaders["Authorization"] = `Bearer ${resolveCredential(opts.credentialRef)}`;
  }

  let fetchBody: string | undefined;
  if (body !== undefined) {
    if (bodyType === "form") {
      const formBody = typeof body === "string" ? body : new URLSearchParams(body as Record<string, string>).toString();
      fetchBody = formBody;
      if (!fetchHeaders["Content-Type"]) {
        fetchHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (bodyType === "text") {
      fetchBody = typeof body === "string" ? body : JSON.stringify(body);
      if (!fetchHeaders["Content-Type"]) {
        fetchHeaders["Content-Type"] = "text/plain";
      }
    } else {
      // Default: json
      fetchBody = typeof body === "string" ? body : JSON.stringify(body);
      if (!fetchHeaders["Content-Type"]) {
        fetchHeaders["Content-Type"] = "application/json";
      }
    }
  }

  // HEAD requests cannot have a body
  if (method === "HEAD" || method === "OPTIONS") {
    fetchBody = undefined;
  }

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // safeFetch: http(s) only, private/metadata destinations blocked (incl. via DNS and
    // redirects), and Authorization is dropped on a cross-origin redirect.
    const response = await safeFetch(targetUrl, {
      method,
      headers: fetchHeaders,
      body: fetchBody,
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;

    // Collect response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = responseHeaders["content-type"] ?? "";

    // Read body (HEAD and OPTIONS requests have no body)
    let bodyResult: unknown = null;
    let bodyTruncated = false;
    if (method !== "HEAD" && method !== "OPTIONS") {
      const rawText = await response.text();
      if (rawText.length > maxBodyLength) {
        bodyTruncated = true;
      }
      const truncated = rawText.slice(0, maxBodyLength);

      // Try to parse as JSON if content-type suggests it
      if (contentType.includes("application/json") || contentType.includes("application/problem+json")) {
        try {
          bodyResult = JSON.parse(truncated);
        } catch {
          bodyResult = truncated;
        }
      } else {
        bodyResult = truncated;
      }
    }

    // Validate expectStatus if provided
    if (opts.expectStatus !== undefined && response.status !== opts.expectStatus) {
      const bodyStr = bodyResult !== null ? JSON.stringify(bodyResult).slice(0, 200) : "(no body)";
      throw new Error(
        `Expected status ${opts.expectStatus} but got ${response.status} (${response.statusText}). Body preview: ${bodyStr}`,
      );
    }

    // Validate expectBodyContains if provided
    if (opts.expectBodyContains !== undefined) {
      const rawBody = bodyResult !== null ? (typeof bodyResult === "string" ? bodyResult : JSON.stringify(bodyResult)) : "";
      if (!rawBody.includes(opts.expectBodyContains)) {
        throw new Error(`Expected body to contain "${opts.expectBodyContains}" but it did not.`);
      }
    }

    return {
      url: targetUrl,
      method,
      statusCode: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyResult,
      bodyTruncated,
      durationMs,
      contentType,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`API request failed after ${durationMs}ms: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

