// xcoder:version 2 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T16:08:43.709Z | xcoder:subtask code-st-97a4d4
import * as cheerio from "cheerio";
import { safeFetch } from "./net-policy.js";

export interface SitePage {
  url: string;
  title: string;
  depth: number;
  links: string[];       // internal links found on this page
  status: number;        // HTTP status code
}

export interface SiteMap {
  rootUrl: string;
  totalPages: number;
  maxDepth: number;
  pages: SitePage[];
  /** Adjacency list: page URL -> list of linked page URLs (internal only) */
  graph: Record<string, string[]>;
  /** Breadcrumb / hierarchy: page URL -> parent URL (first discovered parent) */
  parent: Record<string, string>;
}

/**
 * Crawl a URL and build a site map of all discoverable internal pages.
 *
 * Uses BFS to traverse same-domain links up to `maxPages` pages.
 * Respects `maxDepth` to limit how deep the crawl goes.
 */
export async function crawlSiteMap(
  url: string,
  options: { maxPages?: number; maxDepth?: number; sameDomain?: boolean } = {}
): Promise<SiteMap> {
  const { maxPages = 50, maxDepth = 5, sameDomain = true } = options;

  const rootUrl = normalizeUrl(url) ?? url;
  const rootDomain = extractDomain(rootUrl);

  const visited = new Set<string>();
  const pages: SitePage[] = [];
  const graph: Record<string, string[]> = {};
  const parent: Record<string, string> = {};

  // BFS queue: [url, depth, parentUrl?]
  const queue: [string, number, string | null][] = [[rootUrl, 0, null]];

  while (queue.length > 0 && pages.length < maxPages) {
    const [currentUrl, depth, parentUrl] = queue.shift()!;

    if (visited.has(currentUrl)) continue;
    if (depth > maxDepth) continue;
    visited.add(currentUrl);

    try {
      const page = await fetchPage(currentUrl);
      if (!page) continue;

      // Record parent relationship
      if (parentUrl) {
        parent[currentUrl] = parentUrl;
      }

      // Filter internal links
      const internalLinks: string[] = [];
      for (const link of page.links) {
        const normalized = normalizeUrl(link, currentUrl);
        if (!normalized) continue;
        if (sameDomain && extractDomain(normalized) !== rootDomain) continue;
        if (normalized.startsWith("mailto:") || normalized.startsWith("tel:") || normalized.startsWith("javascript:")) continue;
        if (visited.has(normalized)) continue;
        internalLinks.push(normalized);
      }

      // Deduplicate internal links
      const uniqueInternal = [...new Set(internalLinks)];

      // Record in graph
      graph[currentUrl] = uniqueInternal;

      // Add to pages
      pages.push({
        url: currentUrl,
        title: page.title,
        depth,
        links: uniqueInternal,
        status: page.status,
      });

      // Enqueue unvisited internal links
      for (const link of uniqueInternal) {
        if (!visited.has(link)) {
          queue.push([link, depth + 1, currentUrl]);
        }
      }
    } catch (err) {
      // Skip pages that fail to load
      console.error(`[crawlSiteMap] Failed to fetch ${currentUrl}: ${err}`);
    }
  }

  const maxDepthReached = pages.reduce((max, p) => Math.max(max, p.depth), 0);

  return {
    rootUrl,
    totalPages: pages.length,
    maxDepth: maxDepthReached,
    pages,
    graph,
    parent,
  };
}

/**
 * Format the site map as a human-readable tree string.
 */
export function formatSiteMap(siteMap: SiteMap): string {
  const lines: string[] = [];
  lines.push(`Site Map for: ${siteMap.rootUrl}`);
  lines.push(`Total pages: ${siteMap.totalPages}, Max depth: ${siteMap.maxDepth}`);
  lines.push("");

  // Build a tree from the parent map
  const treeLines = buildTreeLines(siteMap);
  lines.push(...treeLines);

  lines.push("");
  lines.push("--- Page Details ---");
  for (const page of siteMap.pages) {
    lines.push(`  [${page.status}] ${page.url}`);
    lines.push(`    Title: ${page.title}`);
    if (page.links.length > 0) {
      lines.push(`    Internal links (${page.links.length}):`);
      for (const link of page.links.slice(0, 10)) {
        lines.push(`      - ${link}`);
      }
      if (page.links.length > 10) {
        lines.push(`      ... and ${page.links.length - 10} more`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildTreeLines(siteMap: SiteMap): string[] {
  const lines: string[] = [];
  const { rootUrl, parent, pages } = siteMap;

  // Build children map
  const children: Record<string, string[]> = {};
  for (const [child, par] of Object.entries(parent)) {
    if (!children[par]) children[par] = [];
    children[par].push(child);
  }

  // Build a page lookup
  const pageByUrl = new Map<string, SitePage>();
  for (const p of pages) {
    pageByUrl.set(p.url, p);
  }

  function printTree(url: string, indent: string, isLast: boolean): void {
    const page = pageByUrl.get(url);
    const prefix = isLast ? "└── " : "├── ";
    const title = page ? page.title : "(unknown)";
    lines.push(`${indent}${prefix}${url} [${page?.status ?? "?"}] "${title}"`);

    const childList = children[url] || [];
    const newIndent = indent + (isLast ? "    " : "│   ");
    for (let i = 0; i < childList.length; i++) {
      printTree(childList[i], newIndent, i === childList.length - 1);
    }
  }

  lines.push(rootUrl);
  const rootChildren = children[rootUrl] || [];
  for (let i = 0; i < rootChildren.length; i++) {
    printTree(rootChildren[i], "", i === rootChildren.length - 1);
  }

  return lines;
}

// --- Helpers ---

function normalizeUrl(href: string, base?: string): string | null {
  try {
    const url = new URL(href, base || undefined);
    // Remove trailing slash for consistency
    let normalized = url.origin + url.pathname.replace(/\/$/, "") + url.search;
    // If pathname is empty, keep root
    if (normalized.endsWith(url.origin)) {
      normalized = url.origin + "/";
    }
    return normalized;
  } catch {
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function fetchPage(url: string): Promise<{ title: string; links: string[]; status: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "kooder-site-crawler/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      return { title: `(HTTP ${res.status})`, links: [], status: res.status };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null; // Skip non-HTML resources
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || "(no title)";

    const links: string[] = [];
    $("a[href]").each((_index: number, el) => {
      const href = $(el).attr("href");
      if (href && href.trim()) {
        links.push(href.trim());
      }
    });

    return { title, links, status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

