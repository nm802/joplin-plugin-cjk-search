import { SearchIndex } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #3 テストケース #5〜#15（索引・検索）
// 共通フィクスチャ12件。1件だけのデータでは索引の絞り込み経路を通らず素通りするため。
// 内容は現行 Joplin の挙動を実測した検証ノートと同一。
const FIXTURES: [string, string][] = [
  ['f01', 'この機能のＡＰＩは別紙参照'],
  ['f02', 'この機能のAPIは別紙参照'],
  ['f03', '雨漏り　対応を業者へ依頼した'],
  ['f04', '雨漏り 対応を業者へ依頼した'],
  ['f05', '雨漏り対応を業者へ依頼した。屋根の防水工事が必要になる。'],
  ['f06', '屋根の**防水**工事を実施した'],
  ['f07', '屋根の防水\n工事を実施した'],
  ['f08', '現場を確認。朝から降り続く雨'],
  ['f09', '型番メモ 型番QZ-4700の熱設計を検討する'],
  ['f10', 'JoplinのプラグインAPIを調べた'],
  ['f11', '国産の日産車'],
  ['f12', '国産 車'],
];

let index: SearchIndex;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(FIXTURES);
});

const search = (query: string) => index.search(query);

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
