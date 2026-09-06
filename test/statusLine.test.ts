import { statusLine } from '../src/core/statusLine';

// issue #17 テストケース #1〜#4（打ち切りを画面に出す）

test('上限で切ったときは総数と表示数の両方を出す', () => {
  expect(statusLine({ total: 55, shown: 50 })).toBe('55 件中 50 件を表示');
});

test('切っていないときは件数だけを出す', () => {
  expect(statusLine({ total: 12, shown: 12 })).toBe('12 件');
});

test('一致0件でも件数を出す', () => {
  expect(statusLine({ total: 0, shown: 0 })).toBe('0 件');
});

test('索引の構築中はその旨と件数を出す', () => {
  expect(statusLine({ indexing: true, indexedCount: 1200, version: '0.1.6' })).toBe(
    'v0.1.6 — indexing… (1200 notes so far)',
  );
});

test('クエリが空で構築も終わっていれば索引件数を出す', () => {
  expect(statusLine({ indexing: false, indexedCount: 2726, version: '0.1.6' })).toBe(
    'v0.1.6 — 2726 notes indexed',
  );
});

test('直近の索引更新が失敗していればそれを添える', () => {
  expect(
    statusLine({ indexing: false, indexedCount: 2726, version: '0.1.6', lastError: 'boom' }),
  ).toBe('v0.1.6 — 2726 notes indexed — last update failed: boom');
});
