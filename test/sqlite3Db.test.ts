import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sqlite3Db } from '../src/joplin/sqlite3Db';
import { SearchIndex } from '../src/core/searchIndex';

// プラグイン実行時に使う Db 実装。Joplin が同梱するのと同じ sqlite3 5.1.6 で検証する。

const T0 = Date.parse('2026-09-01T00:00:00Z');
const sqlite3 = require('sqlite3');

test('sqlite3のDb実装で索引を作り検索できる', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cjk-sqlite3-'));
  try {
    const index = new SearchIndex(await Sqlite3Db.open(sqlite3, join(dir, 'index.sqlite')));
    await index.create();
    await index.sync([
      { id: 'a', title: '', body: 'この機能のＡＰＩは別紙参照', updatedTime: T0 },
      { id: 'b', title: '', body: '屋根の**防水**工事を実施した', updatedTime: T0 },
      { id: 'c', title: '', body: '国産の日産車', updatedTime: T0 },
    ]);
    expect(await index.search('API')).toEqual(['a']);
    expect(await index.search('防水工事')).toEqual(['b']);
    expect(await index.search('国産車')).toEqual([]);
    await index.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sqlite3のDb実装でも索引はファイルに残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cjk-sqlite3-'));
  const path = join(dir, 'index.sqlite');
  try {
    const first = new SearchIndex(await Sqlite3Db.open(sqlite3, path));
    await first.create();
    await first.sync([{ id: 'a', title: '', body: '屋根の防水工事', updatedTime: T0 }]);
    await first.close();

    const second = new SearchIndex(await Sqlite3Db.open(sqlite3, path));
    await second.create();
    expect(await second.search('防水工事')).toEqual(['a']);
    expect(await second.needsRebuild()).toBe(false);
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
