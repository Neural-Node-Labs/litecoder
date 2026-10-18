// xcoder:version 1 | xcoder:task task-7f2823 | xcoder:updated 2026-08-03T09:31:52.622Z | xcoder:subtask code-st-e8e2bf
// Type declaration for sql.js (optional dependency)
declare module "sql.js" {
  export default function initSqlJs(): Promise<SqlJsStatic>;

  interface SqlJsStatic {
    Database: new () => Database;
  }

  interface Database {
    run(sql: string, params?: unknown[]): void;
    close(): void;
  }
}
