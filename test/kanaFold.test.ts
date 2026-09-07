import { normalize } from '../src/core/normalize';
import { SearchIndex } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #20 テストケース #1〜#8（ひらがなをカタカナへ畳む）

const T0 = Date.parse('2026-09-01T00:00:00Z');

/** [id, 本文] */
const FIXTURES: [string, string][] = [
  ['k1', 'さーばー設定を見直す'],
  ['k2', 'ｻｰﾊﾞｰ機器の一覧'],
  ['k3', '屋根の防水工事を実施した'],
];

let index: SearchIndex;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(FIXTURES.map(([id, body]) => ({ id, title: '', body, updatedTime: T0 })));
});

const search = async (query: string) => (await index.search(query)).sort();

test('ひらがなの本文がカタカナのクエリで引ける', async () => {
  expect(await search('サーバー')).toEqual(['k1', 'k2']);
});

test('カタカナ・半角カナの本文がひらがなのクエリで引ける', async () => {
  expect(await search('さーばー')).toEqual(['k1', 'k2']);
});

test('漢字の本文はカナの畳み込みに影響されない', async () => {
  expect(await search('防水工事')).toEqual(['k3']);
});

test('ひらがなはカタカナへ畳まれる', () => {
  expect(normalize('さーばー設定')).toBe('サーバー設定');
});

test('小書き・濁点付きのかなも畳まれる', () => {
  expect(normalize('ゔぁいおりん')).toBe('ヴァイオリン');
});

test('繰り返し記号も畳まれる', () => {
  // ゟ は NFKC が先に「より」へ展開するので、畳み込みが見るのは ゝゞ だけになる。
  expect(normalize('ゝゞゟ')).toBe('ヽヾヨリ');
});

test('かな以外の文字は変わらない', () => {
  expect(normalize('あa漢ー1')).toBe('アa漢ー1');
});

test('かなを含む文字列でも正規化は冪等である', () => {
  expect(normalize(normalize('ゔぁ'))).toBe(normalize('ゔぁ'));
});
