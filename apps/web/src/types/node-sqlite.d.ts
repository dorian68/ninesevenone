declare module "node:sqlite" {
  export type StatementRunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

  export class StatementSync {
    all(...anonymousParameters: unknown[]): unknown[];
    get(...anonymousParameters: unknown[]): unknown;
    run(...anonymousParameters: unknown[]): StatementRunResult;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
  }
}
