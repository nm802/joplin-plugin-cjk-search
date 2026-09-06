import { SearchIndex } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #18 テストケース #1〜#6（打鍵中の語は前方一致、空白で区切られた語は完全一致）
const T0 = Date.parse('2026-09-01T00:00:00Z');

/** [id, 本文] */
const FIXTURES: [string, string][] = [
  ['p1', 'ＴＥＳＴ\nＡＰＩ\nmahaakassapa\namitaabha'],
  ['p2', 'testing the api client'],
  ['p3', '屋根の防水工事を実施した'],
];

let index: SearchIndex;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(FIXTURES.map(([id, body]) => ({ id, title: '', body, updatedTime: T0 })));
});

const search = async (query: string) => (await index.search(query)).sort();

test('打鍵中の末尾の語は前方一致で引ける', async () => {
  expect(await search('mahaakassap')).toEqual(['p1']);
});

test('末尾が空白なら完全一致になる', async () => {
  expect(await search('mahaakassap ')).toEqual([]);
  expect(await search('mahaakassapa ')).toEqual(['p1']);
});

test('末尾以外の語は前方一致にならない', async () => {
  // 全ての語を前方一致にすると testing + api の p2 も入る。
  expect(await search('test api')).toEqual(['p1']);
});

test('単独の語は前方一致で複数に当たる', async () => {
  expect(await search('test')).toEqual(['p1', 'p2']);
});

test('CJKは末尾の空白の有無で結果が変わらない', async () => {
  expect(await search('防水')).toEqual(['p3']);
  expect(await search('防水 ')).toEqual(['p3']);
});

test('全角空白で区切っても確定として扱う', async () => {
  expect(await search('mahaakassap　')).toEqual([]);
});
