// Types for the slice of Node's built-in `node:sqlite` that the Anki importer
// (scripts/anki/import.ts) and its integration test use. The runtime has had
// it since Node 22.5; this project's @types/node (v20) predates it. Delete
// this file once @types/node is bumped to >= 22.
declare module "node:sqlite" {
  type Row = Record<string, unknown>;
  interface StatementSync {
    all(...params: unknown[]): Row[];
    get(...params: unknown[]): Row | undefined;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
