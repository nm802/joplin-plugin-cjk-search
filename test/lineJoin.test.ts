import { SearchIndex } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';

// issue #15 テストケース #1〜#6（改行は語の区切り、記号は詰める）
const T0 = Date.parse('2026-09-01T00:00:00Z');

/** [id, 本文] */
const FIXTURES: [string, string][] = [
  ['l1', '屋根の防水\n工事を実施した'],
  ['l2', '昨日は雨\n傘を買った'],
  ['l3', 'The quick brown\nfox jumps over'],
  ['l4', 'ＴＥＳＴ\nＡＰＩ\nmahaakassapa\namitaabha'],
  ['l5', '屋根の**防水**工事を実施した'],
  ['l6', '- 屋根の防水\n- 工事を実施した'],
];

let index: SearchIndex;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(
    FIXTURES.map(([id, body]) => ({ id, title: '', body, updatedTime: T0 })),
  );
});

const search = async (query: string) => (await index.search(query)).sort();

test('日本語の行またぎは空白で区切られ、同一行の記号は詰められる', async () => {
  // l1（改行）と l6（箇条書き）は落ち、l5（強調記号）だけが残る。
  expect(await search('防水工事')).toEqual(['l5']);
  expect(await search('防水')).toEqual(['l1', 'l5', 'l6']);
});

test('隣り合う行から存在しない複合語はできない', async () => {
  expect(await search('雨傘')).toEqual([]);
  expect(await search('雨')).toEqual(['l2']);
  expect(await search('傘')).toEqual(['l2']);
});

test('ラテン語の行またぎで単語が融合しない', async () => {
  expect(await search('brownfox')).toEqual([]);
  expect(await search('brown')).toEqual(['l3']);
  expect(await search('fox')).toEqual(['l3']);
});

test('1行1語の英数字本文は各語で引ける', async () => {
  expect(await search('mahaakassapa')).toEqual(['l4']);
  expect(await search('amitaabha')).toEqual(['l4']);
  expect(await search('API')).toEqual(['l4']);
  expect(await search('TEST')).toEqual(['l4']);
});
