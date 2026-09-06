/**
 * 検索コアが使う SQLite の最小インタフェース。
 *
 * 検索コアは Joplin API に依存しない。テストでは Node 22 内蔵の node:sqlite を、
 * プラグイン実行時は joplin.require('sqlite3') を後ろに置く。前者は同期 API、
 * 後者はコールバック API なので、共通の入口を非同期に揃えておく。
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}
