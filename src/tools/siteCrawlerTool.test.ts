// xcoder:version 4 | xcoder:task task-f9b6a5 | xcoder:updated 2026-08-03T17:12:05.795Z | xcoder:subtask test-st-a992e3
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crawlSiteMap, formatSiteMap, SiteMap } from "./siteCrawlerTool.js";

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

function mockHtmlResponse(url: string, title: string, links: string[], status = 200) {
  const html = `
    <html><head><title>${title}</title></head><body>
      ${links.map((l) => `<a href="${l}">link</a>`).join("\n")}
    </body></html>
  `;
  const headers = new Map<string, string>();
  headers.set("content-type", "text/html; charset=utf-8");
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    ok: status >= 200 && status < 300,
    headers,
    text: () => Promise.resolve(html),
  };
}

describe("crawlSiteMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("crawls a single page and returns a basic SiteMap (json format)", async () => {
    mockFetch.mockResolvedValue(
      mockHtmlResponse("https://example.com/", "Home", [])
    );

    const result = await crawlSiteMap("https://example.com/");

    expect(result.rootUrl).toBe("https://example.com/");
    expect(result.totalPages).toBe(1);
    expect(result.maxDepth).toBe(0);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].title).toBe("Home");
    expect(result.pages[0].status).toBe(200);
    expect(result.graph["https://example.com/"]).toEqual([]);
    expect(result.parent).toEqual({});
  });

  it("follows internal links up to maxDepth", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Root", ["/about"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/about", "About", ["https://external.com/page"])
      );

    const result = await crawlSiteMap("https://example.com/", { maxDepth: 2 });

    expect(result.totalPages).toBe(2);
    expect(result.pages[0].url).toBe("https://example.com/");
    expect(result.pages[1].url).toBe("https://example.com/about");
    // External link should not be in internal links
    expect(result.graph["https://example.com/about"]).toEqual([]);
    // Parent relationship
    expect(result.parent["https://example.com/about"]).toBe("https://example.com/");
  });

  it("stops crawling when maxPages is reached", async () => {
    // Page A links to B and C, but maxPages=2 should stop after 2 pages
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Root", ["/page-b", "/page-c"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/page-b", "Page B", [])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/page-c", "Page C", [])
      );

    const result = await crawlSiteMap("https://example.com/", { maxPages: 2 });

    expect(result.totalPages).toBeLessThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("handles fetch errors gracefully without crashing", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/page-b", "Page B", [])
      );

    // Even though the root fetch fails, crawlSiteMap should not throw.
    // But we need a valid starting page. Let's use a valid URL as root
    // and see that error pages are skipped.
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Root", ["/bad", "/good"])
      )
      .mockRejectedValueOnce(new Error("Network failure")) // /bad fails
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/good", "Good", [])
      );

    const result = await crawlSiteMap("https://example.com/", { maxPages: 5 });

    // Should still have pages for the ones that succeeded
    expect(result.totalPages).toBe(2); // Root + Good (Bad was skipped)
    expect(result.pages.map((p) => p.url)).toContain("https://example.com/");
    expect(result.pages.map((p) => p.url)).toContain("https://example.com/good");
    expect(result.pages.map((p) => p.url)).not.toContain("https://example.com/bad");
  });

  it("does not exceed maxDepth limit", async () => {
    // Create a chain of pages linking to the next
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Depth 0", ["/d1"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/d1", "Depth 1", ["/d2"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/d2", "Depth 2", ["/d3"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/d3", "Depth 3", [])
      );

    const result = await crawlSiteMap("https://example.com/", { maxDepth: 2 });

    // All pages should have depth <= 2
    for (const page of result.pages) {
      expect(page.depth).toBeLessThanOrEqual(2);
    }
    expect(result.totalPages).toBeLessThanOrEqual(3); // root + d1 + d2, d3 is depth 3 (beyond max)
  });

  it("filters non-HTML pages (respects Content-Type)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", ["/style.css"])
    );

    const cssHeaders = new Map<string, string>();
    cssHeaders.set("content-type", "text/css");
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      ok: true,
      headers: cssHeaders,
      text: () => Promise.resolve("body { color: red; }"),
    });

    const result = await crawlSiteMap("https://example.com/");

    // CSS file should not be included as a page
    expect(result.totalPages).toBe(1);
    expect(result.pages[0].url).toBe("https://example.com/");
  });

  it("records pages with non-200 HTTP status codes", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", ["/not-found"])
    );
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/not-found", "404 Page", [], 404)
    );

    const result = await crawlSiteMap("https://example.com/");

    expect(result.totalPages).toBeGreaterThanOrEqual(1);
    const notFoundPage = result.pages.find(p => p.status === 404);
    expect(notFoundPage).toBeDefined();
    expect(notFoundPage!.title).toContain("404");
  });

  it("handles pages with server error (500) gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", ["/server-error"])
    );
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/server-error", "500 Error", [], 500)
    );

    const result = await crawlSiteMap("https://example.com/");

    const errorPage = result.pages.find(p => p.status === 500);
    expect(errorPage).toBeDefined();
    expect(errorPage!.title).toContain("500");
  });

  it("follows external links when sameDomain is false", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", ["https://other.com/page"])
    );
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://other.com/page", "Other", [])
    );

    const result = await crawlSiteMap("https://example.com/", { sameDomain: false });

    expect(result.totalPages).toBe(2);
    expect(result.pages.map(p => p.url)).toContain("https://other.com/page");
  });

  it("filters mailto, tel, and javascript links", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", [
        "mailto:test@example.com",
        "tel:+1234567890",
        "javascript:void(0)",
        "/about",
      ])
    );
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/about", "About", [])
    );

    const result = await crawlSiteMap("https://example.com/");

    // Only /about should be enqueued, not the mailto/tel/javascript links
    expect(result.totalPages).toBe(2);
    const rootLinks = result.graph["https://example.com/"];
    expect(rootLinks).toContain("https://example.com/about");
    expect(rootLinks).not.toContain("mailto:test@example.com");
    expect(rootLinks).not.toContain("tel:+1234567890");
    expect(rootLinks).not.toContain("javascript:void(0)");
  });

  it("does not revisit URLs that were already crawled", async () => {
    // Page A -> Page B -> Page A (circular)
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Home", ["/page-b"])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/page-b", "Page B", ["/"])
      );

    const result = await crawlSiteMap("https://example.com/");

    expect(result.totalPages).toBe(2); // A and B, not A again
  });

  it("handles pages with empty or missing <title> element", async () => {
    const html = `<html><head></head><body><a href="/about">link</a></body></html>`;
    const headers = new Map<string, string>();
    headers.set("content-type", "text/html; charset=utf-8");
    mockFetch.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      ok: true,
      headers,
      text: () => Promise.resolve(html),
    });
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/about", "About", [])
    );

    const result = await crawlSiteMap("https://example.com/");

    expect(result.pages[0].title).toBe("(no title)");
  });

  it("deduplicates identical internal links on a page", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/", "Home", ["/about", "/about", "/about"])
    );
    mockFetch.mockResolvedValueOnce(
      mockHtmlResponse("https://example.com/about", "About", [])
    );

    const result = await crawlSiteMap("https://example.com/");

    const rootLinks = result.graph["https://example.com/"];
    expect(rootLinks).toEqual(["https://example.com/about"]); // deduplicated
  });

  it("respects the 10-second timeout with AbortController", async () => {
    // Simulate a slow response by rejecting due to abort
    mockFetch.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
    // Then root is already the first (non-recoverable after mock reset? Actually the root was already simulated failing)
    // We need to test that a page that hangs is skipped without crashing.
    // So set up: root succeeds, linked page times out
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/", "Home", ["/slow"])
      )
      .mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

    const result = await crawlSiteMap("https://example.com/");

    // Should have only root page, not the timed-out one
    expect(result.totalPages).toBe(1);
    expect(result.pages[0].url).toBe("https://example.com/");
  });

  it("resolves relative links with base URL", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/sub/page.html", "Subpage", [
          "../other",
          "./child",
          "/absolute",
        ])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/other", "Other", [])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/sub/child", "Child", [])
      )
      .mockResolvedValueOnce(
        mockHtmlResponse("https://example.com/absolute", "Absolute", [])
      );

    const result = await crawlSiteMap("https://example.com/sub/page.html");

    const rootLinks = result.graph["https://example.com/sub/page.html"];
    expect(rootLinks).toContain("https://example.com/other");
    expect(rootLinks).toContain("https://example.com/sub/child");
    expect(rootLinks).toContain("https://example.com/absolute");
  });
});

describe("formatSiteMap", () => {
  it("formats an empty site map", () => {
    const emptySiteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 0,
      maxDepth: 0,
      pages: [],
      graph: {},
      parent: {},
    };

    const result = formatSiteMap(emptySiteMap);

    expect(result).toContain("Site Map for: https://example.com/");
    expect(result).toContain("Total pages: 0");
    expect(result).toContain("--- Page Details ---");
  });

  it("formats a multi-page site map as a tree structure", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 3,
      maxDepth: 1,
      pages: [
        {
          url: "https://example.com/",
          title: "Home",
          depth: 0,
          links: ["https://example.com/about", "https://example.com/contact"],
          status: 200,
        },
        {
          url: "https://example.com/about",
          title: "About",
          depth: 1,
          links: [],
          status: 200,
        },
        {
          url: "https://example.com/contact",
          title: "Contact",
          depth: 1,
          links: [],
          status: 200,
        },
      ],
      graph: {
        "https://example.com/": [
          "https://example.com/about",
          "https://example.com/contact",
        ],
        "https://example.com/about": [],
        "https://example.com/contact": [],
      },
      parent: {
        "https://example.com/about": "https://example.com/",
        "https://example.com/contact": "https://example.com/",
      },
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("Site Map for: https://example.com/");
    expect(result).toContain("Total pages: 3, Max depth: 1");
    expect(result).toContain("Home");
    expect(result).toContain("About");
    expect(result).toContain("Contact");
    expect(result).toContain("--- Page Details ---");
    // Tree structure should show hierarchy
    expect(result).toMatch(/https:\/\/example\.com\//);
    expect(result).toMatch(/about/);
    expect(result).toMatch(/contact/);
  });

  it("includes status codes in formatted output", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 1,
      maxDepth: 0,
      pages: [
        {
          url: "https://example.com/",
          title: "Broken",
          depth: 0,
          links: [],
          status: 500,
        },
      ],
      graph: { "https://example.com/": [] },
      parent: {},
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("[500]");
    expect(result).toContain("Broken");
  });

  it("formats a deep tree of 3+ levels correctly", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 4,
      maxDepth: 3,
      pages: [
        { url: "https://example.com/", title: "Root", depth: 0, links: ["https://example.com/level1"], status: 200 },
        { url: "https://example.com/level1", title: "Level 1", depth: 1, links: ["https://example.com/level2"], status: 200 },
        { url: "https://example.com/level2", title: "Level 2", depth: 2, links: ["https://example.com/level3"], status: 200 },
        { url: "https://example.com/level3", title: "Level 3", depth: 3, links: [], status: 200 },
      ],
      graph: {
        "https://example.com/": ["https://example.com/level1"],
        "https://example.com/level1": ["https://example.com/level2"],
        "https://example.com/level2": ["https://example.com/level3"],
        "https://example.com/level3": [],
      },
      parent: {
        "https://example.com/level1": "https://example.com/",
        "https://example.com/level2": "https://example.com/level1",
        "https://example.com/level3": "https://example.com/level2",
      },
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("Root");
    expect(result).toContain("Level 1");
    expect(result).toContain("Level 2");
    expect(result).toContain("Level 3");
  });

  it("truncates internal links list at 10 with continuation message", () => {
    const manyLinks = Array.from({ length: 15 }, (_, i) => `https://example.com/page${i}`);
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 1,
      maxDepth: 0,
      pages: [
        {
          url: "https://example.com/",
          title: "ManyLinks",
          depth: 0,
          links: manyLinks,
          status: 200,
        },
      ],
      graph: { "https://example.com/": manyLinks },
      parent: {},
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("Internal links (15):");
    expect(result).toContain("... and 5 more");
    const lines = result.split("\n");
    const linkLines = lines.filter(l => l.trim().startsWith("- https://example.com/page"));
    expect(linkLines.length).toBe(10);
  });

  it("handles a page missing from pages array gracefully", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 1,
      maxDepth: 1,
      pages: [
        {
          url: "https://example.com/",
          title: "Root",
          depth: 0,
          links: ["https://example.com/missing"],
          status: 200,
        },
      ],
      graph: { "https://example.com/": ["https://example.com/missing"] },
      parent: {
        "https://example.com/missing": "https://example.com/",
      },
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("(unknown)");
    expect(result).toContain("https://example.com/missing");
  });

  it("does not show Internal links section when links array is empty", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 1,
      maxDepth: 0,
      pages: [
        { url: "https://example.com/", title: "EmptyLinks", depth: 0, links: [], status: 200 },
      ],
      graph: { "https://example.com/": [] },
      parent: {},
    };

    const result = formatSiteMap(siteMap);

    expect(result).not.toContain("Internal links (0):");
  });

  it("uses tree-drawing characters for hierarchy", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 3,
      maxDepth: 1,
      pages: [
        { url: "https://example.com/", title: "Root", depth: 0, links: ["https://example.com/a", "https://example.com/b"], status: 200 },
        { url: "https://example.com/a", title: "Child A", depth: 1, links: [], status: 200 },
        { url: "https://example.com/b", title: "Child B", depth: 1, links: [], status: 200 },
      ],
      graph: {
        "https://example.com/": ["https://example.com/a", "https://example.com/b"],
        "https://example.com/a": [],
        "https://example.com/b": [],
      },
      parent: {
        "https://example.com/a": "https://example.com/",
        "https://example.com/b": "https://example.com/",
      },
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("├── ");
    expect(result).toContain("└── ");
  });

  it("handles orphan pages not linked from root", () => {
    const siteMap: SiteMap = {
      rootUrl: "https://example.com/",
      totalPages: 2,
      maxDepth: 1,
      pages: [
        { url: "https://example.com/", title: "Root", depth: 0, links: [], status: 200 },
        { url: "https://example.com/orphan", title: "Orphan", depth: 1, links: [], status: 200 },
      ],
      graph: {
        "https://example.com/": [],
        "https://example.com/orphan": [],
      },
      parent: {},
    };

    const result = formatSiteMap(siteMap);

    expect(result).toContain("Orphan");
    expect(result).toContain("Root");
    expect(result).toContain("--- Page Details ---");
  });
});
