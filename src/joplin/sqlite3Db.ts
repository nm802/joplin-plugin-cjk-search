import joplin from 'api';
import type { Db } from '../core/db';

/**
 * `joplin.require('sqlite3')` を Db インタフェースに合わせる。
 *
 * sqlite3 はコールバック API なので Promise に包む。プラグインからネイティブ
 * モジュールを同梱することはできず、Joplin が提供するものを使う決まりになっている
 * （`sqlite3` と `fs-extra` の2つだけが提供される）。
 *
 * 開発機の Raspberry Pi では `sqlite3` の arm64 / Node 22 向けビルド済みバイナリが
 * 無いため、コア側のテストは node:sqlite で回している。こちらは実機でしか動かない。
 */
export class Sqlite3Db implements Db {
  private db: any;

  private constructor(db: any) {
    this.db = db;
  }

  public static async open(path: string): Promise<Sqlite3Db> {
    const sqlite3 = joplin.require('sqlite3');
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
