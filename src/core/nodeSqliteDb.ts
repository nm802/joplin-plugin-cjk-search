import { DatabaseSync } from 'node:sqlite';
import type { Db } from './db';

/**
 * Node 22 内蔵の node:sqlite を Db インタフェースに合わせる。
 *
 * テストと計測に使う。プラグイン実行時は joplin.require('sqlite3') 側の実装を使う。
 * `sqlite3` パッケージは arm64 / Node 22 向けのビルド済みバイナリが無く、
 * 開発機（Raspberry Pi）では読み込めないため、コア側のテストはこちらで回す。
 */
export class NodeSqliteDb implements Db {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  public async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  public async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }

  public async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  public async close(): Promise<void> {
    this.db.close();
  }
}
