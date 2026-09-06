import { SearchIndex, type Note } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #6 テストケース #1〜#6（タイトルの索引と並び順）

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T00:00:00Z');

const build = async (notes: Note[]) => {
  const index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(notes);
  return index;
};

const note = (id: string, title: string, body: string, updatedTime = T0): Note => ({
  id,
  title,
  body,
  updatedTime,
});

test('タイトルだけに含まれる語で引ける', async () => {
  const notes = [
    note('f05', '雨漏り調査報告', '雨漏り対応を業者へ依頼した。屋根の防水工事が必要になる。'),
    ...Array.from({ length: 11 }, (_, i) => note(`x${i}`, '', '屋根の防水工事を実施した')),
  ];
  const index = await build(notes);
  expect(await index.search('調査')).toEqual(['f05']);
});

test('タイトル一致は本文一致より上に来る', async () => {
  // FTS5 の bm25() は列ごとに IDF を取る。防水 をタイトルに持つノートが多いと
  // タイトル側の IDF が下がり、BM25 だけでは本文一致の z が先頭に来る（実測 -1.751 対 -0.000）。
  // タイトル優先を外すと z が先頭になって落ちる。
  const index = await build([
    ...Array.from({ length: 10 }, (_, i) => note(`t${i}`, `防水の記録${i}`, '見積を取得した')),
    note('z', '資材発注の控え', '屋根の防水を実施した'),
  ]);
  expect((await index.search('防水'))[0]).toBe('t0');
});

test('タイトルと本文をまたぐ語は一致しない', async () => {
  const index = await build([note('a', '屋根の防水', '工事を実施した')]);
  expect(await index.search('防水工事')).toEqual([]);
});

test('同順位なら更新日時が新しいノートが上に来る', async () => {
  // id の辞書順は a < b < c。更新日時を見ない実装なら a が先頭に来る。
  const index = await build([
    note('a', '', '雨漏り対応', T0 - 3 * DAY),
    note('b', '', '雨漏り対応', T0 - 2 * DAY),
    note('c', '', '雨漏り対応', T0 - 1 * DAY),
  ]);
  expect(await index.search('雨漏り')).toEqual(['c', 'b', 'a']);
});

test('一致件数に上限を設けない', async () => {
  const index = await build(
    Array.from({ length: 30 }, (_, i) => note(`n${String(i).padStart(2, '0')}`, '', '屋根の防水工事')),
  );
  expect((await index.search('防水')).length).toBe(30);
});

test('一致回数が多いノートが上に来る', async () => {
  // b を新しくする。BM25 を使わず更新日時だけで並べる実装なら b が先頭に来る。
  const index = await build([
    note('a', '', '防水の記録。防水を点検。防水を再確認。', T0 - 2 * DAY),
    note('b', '', '防水の記録。屋根を点検。書類を再確認。', T0 - 1 * DAY),
  ]);
  expect((await index.search('防水'))[0]).toBe('a');
});
