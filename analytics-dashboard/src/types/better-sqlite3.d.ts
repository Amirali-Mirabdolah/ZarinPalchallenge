/* eslint-disable @typescript-eslint/no-explicit-any -- the native module API is inherently dynamic */
declare module 'better-sqlite3' {
  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    verbose?: (msg: string) => void;
  }
  interface RunResult {
    changes: number;
    lastInsertRowid?: number;
  }
  interface Statement<T = any> {
    get(...params: any[]): T | undefined;
    all(...params: any[]): T[];
    run(...params: any[]): RunResult;
    iterate(...params: any[]): IterableIterator<T>;
    bind(...params: any[]): Statement<T>;
    raw(...params: any[]): Statement<T>;
  }
  class BetterSqlite3Database {
    constructor(path: string, options?: Options);
    prepare(sql: string): Statement;
    close(): void;
  }
  export default BetterSqlite3Database;
}
