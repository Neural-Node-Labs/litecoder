// Loose ambient fallback so `tsc` type-checks cleanly even when the optional
// `playwright` package hasn't been installed yet (e.g. fresh clone, CI cache
// miss). If the real package IS installed, Node's module resolution finds
// its shipped types first and this stub is never consulted.
//
// Run `npm install` (playwright is an optionalDependency) before using the
// `ui_test` / `api_test` tools for real.
declare module "playwright" {
  export type Browser = any;
  export type BrowserContext = any;
  export type Page = any;
  export const chromium: {
    launch(opts?: any): Promise<Browser>;
  };
}
