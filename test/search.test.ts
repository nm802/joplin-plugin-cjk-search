import { SearchIndex } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #3 テストケース #5〜#15（索引・検索）
// 共通フィクスチャ12件。1件だけのデータでは索引の絞り込み経路を通らず素通りするため。
// 内容は現行 Joplin の挙動を実測した検証ノートと同一。
const T0 = Date.parse('2026-09-01T00:00:00Z');

/** [id, タイトル, 本文, 更新日時] */
const FIXTURES: [string, string, string, number][] = [
  ['f01', '', 'この機能のＡＰＩは別紙参照', T0],
  ['f02', '', 'この機能のAPIは別紙参照', T0],
  ['f03', '', '雨漏り　対応を業者へ依頼した', T0],
  ['f04', '', '雨漏り 対応を業者へ依頼した', T0],
  ['f05', '', '雨漏り対応を業者へ依頼した。屋根の防水工事が必要になる。', T0],
  ['f06', '', '屋根の**防水**工事を実施した', T0],
  ['f07', '', '屋根の防水\n工事を実施した', T0],
  ['f08', '', '現場を確認。朝から降り続く雨', T0],
  ['f09', '', '型番メモ 型番QZ-4700の熱設計を検討する', T0],
  ['f10', '', 'JoplinのプラグインAPIを調べた', T0],
  ['f11', '', '国産の日産車', T0],
  ['f12', '', '国産 車', T0],
];

let index: SearchIndex;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(
    FIXTURES.map(([id, title, body, updatedTime]) => ({ id, title, body, updatedTime })),
  );
});

// #3 の時点では並び順を対象外にしていたため、集合として比較する。
// 並び順は ranking.test.ts で検証する。
const search = async (query: string) => (await index.search(query)).sort();

test('日本語文中の半角英数語が半角クエリで引ける', async () => {
  expect(await search('API')).toEqual(['f01', 'f02', 'f10']);
});

test('半角英数の本文が全角クエリで引ける', async () => {
  expect(await search('ＡＰＩ')).toEqual(['f01', 'f02', 'f10']);
});

test('ラテン語の語中一致はしない', async () => {
  expect(await search('PI')).toEqual([]);
});

test('記号を含む型番が引ける', async () => {
  expect(await search('QZ-4700')).toEqual(['f09']);
});

test('日本語語がトークン途中にあっても引ける', async () => {
  expect(await search('熱設計')).toEqual(['f09']);
});

test('日本語は語中一致する', async () => {
  expect(await search('漏り')).toEqual(['f03', 'f04', 'f05']);
});

test('国産の日産車は国産車で引けない', async () => {
  expect(await search('国産車')).toEqual([]);
});

test('強調記号と改行をまたぐ複合語が引ける', async () => {
  expect(await search('防水工事')).toEqual(['f05', 'f06', 'f07']);
});

test('全角スペース区切りのクエリは半角区切りと同じ結果を返す', async () => {
  expect(await search('雨漏り　対応')).toEqual(['f03', 'f04', 'f05']);
  expect(await search('雨漏り 対応')).toEqual(['f03', 'f04', 'f05']);
});

test('複数語は積集合になる', async () => {
  expect(await search('雨漏り 屋根')).toEqual(['f05']);
});

test('1文字クエリは語中と本文末尾の両方から引ける', async () => {
  // f03〜f05 は 雨漏り の語頭なので tok の前方一致で、
  // f08 は体言止めの文末なので tail の完全一致でしか引けない。
  expect(await search('雨')).toEqual(['f03', 'f04', 'f05', 'f08']);
});
