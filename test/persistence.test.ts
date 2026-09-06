import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SearchIndex,
  ANALYZER_VERSION,
  SCHEMA_VERSION,
  type Note,
} from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #8 テストケース #1〜#10（永続化と差分適用）

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T00:00:00Z');

const note = (id: string, body: string, updatedTime = T0): Note => ({
  id,
  title: '',
  body,
  updatedTime,
});

/** 5件。うち n3 だけが 防水 を含む。 */
const FIVE = (): Note[] => [
  note('n1', '雨漏り対応を業者へ依頼した'),
  note('n2', '現場を確認した'),
  note('n3', '屋根の点検を実施した'),
  note('n4', '見積を取得した'),
  note('n5', '納期を確認した'),
];

const open = async (path = ':memory:') => {
  const index = new SearchIndex(new NodeSqliteDb(path));
  await index.create();
  return index;
};

test('新規の索引には実装側のバージョンが記録される', async () => {
  const index = await open();
  expect(await index.version()).toEqual({
    analyzerVersion: ANALYZER_VERSION,
    schemaVersion: SCHEMA_VERSION,
  });
});

test('analyzer_versionが違う索引は要再構築と判定される', async () => {
  const index = await open();
  await index.setVersionForTest(ANALYZER_VERSION - 1, SCHEMA_VERSION);
  expect(await index.needsRebuild()).toBe(true);
});

test('schema_versionが違う索引は要再構築と判定される', async () => {
  const index = await open();
  await index.setVersionForTest(ANALYZER_VERSION, SCHEMA_VERSION - 1);
  expect(await index.needsRebuild()).toBe(true);
});

test('バージョンが一致する索引は再構築不要と判定される', async () => {
  const index = await open();
  expect(await index.needsRebuild()).toBe(false);
});

test('同じノート集合を渡しても再索引されない', async () => {
  const index = await open();
  await index.sync(FIVE());
  expect(await index.sync(FIVE())).toEqual({
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 5,
  });
});

test('更新日時が新しいノートは入れ直される', async () => {
  const index = await open();
  await index.sync(FIVE());

  const next = FIVE();
  next[2] = note('n3', '屋根の防水を実施した', T0 + DAY);
  expect(await index.sync(next)).toEqual({
    added: 0,
    updated: 1,
    removed: 0,
    unchanged: 4,
  });
  expect(await index.search('防水')).toEqual(['n3']);
});

test('更新日時が古いノートは無視される', async () => {
  const index = await open();
  await index.sync(FIVE());

  const next = FIVE();
  next[2] = note('n3', '屋根の防水を実施した', T0 - DAY);
  expect((await index.sync(next)).updated).toBe(0);
  expect(await index.search('防水')).toEqual([]);
  expect(await index.search('点検')).toEqual(['n3']);
});

test('渡されなかったノートは索引から消える', async () => {
  const index = await open();
  await index.sync(FIVE());

  expect(await index.sync(FIVE().slice(0, 4))).toEqual({
    added: 0,
    updated: 0,
    removed: 1,
    unchanged: 4,
  });
  expect(await index.search('納期')).toEqual([]);
});

test('新しいノートは追加される', async () => {
  const index = await open();
  await index.sync(FIVE());

  expect(await index.sync([...FIVE(), note('n6', '屋根の防水を実施した')])).toEqual({
    added: 1,
    updated: 0,
    removed: 0,
    unchanged: 5,
  });
  expect(await index.search('防水')).toEqual(['n6']);
});

test('索引はファイルに残り開き直しても引ける', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cjk-search-'));
  const path = join(dir, 'index.sqlite');
  try {
    const first = await open(path);
    await first.sync([...FIVE(), note('n6', '屋根の防水を実施した')]);
    const before = await first.search('防水');
    await first.close();

    const second = await open(path);
    expect(await second.search('防水')).toEqual(before);
    expect(await second.needsRebuild()).toBe(false);
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
