import type { Db } from '../core/db';

/**
 * `joplin.require('sqlite3')` を Db インタフェースに合わせる。
 *
 * sqlite3 はコールバック API なので Promise に包む。プラグインからネイティブ
 * モジュールを同梱することはできず、Joplin が提供するものを使う決まりになっている
 * （`sqlite3` と `fs-extra` の2つだけが提供される）。
 *
 * モジュールの取得は呼び出し側から渡す。プラグイン実行時は `joplin.require('sqlite3')`、
 * テストでは同じ版（Joplin が同梱するのは 5.1.6）を直接 require する。こうしておかないと
 * この層だけ実機でしか動かせなくなる。
 */
export class Sqlite3Db implements Db {
  private db: any;

  private constructor(db: any) {
    this.db = db;
  }

  public static async open(sqlite3: any, path: string): Promise<Sqlite3Db> {
    const db = await new Promise<any>((resolve, reject) => {
      const handle = new sqlite3.Database(path, (error: Error | null) => {
        if (error) reject(error);
        else resolve(handle);
      });
    });
    return new Sqlite3Db(db);
  }

  public exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (error: Error | null) => (error ? reject(error) : resolve()));
    });
  }

  public run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (error: Error | null) => (error ? reject(error) : resolve()));
    });
  }

  public all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (error: Error | null, rows: T[]) =>
        error ? reject(error) : resolve(rows ?? []),
      );
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((error: Error | null) => (error ? reject(error) : resolve()));
    });
  }
}
