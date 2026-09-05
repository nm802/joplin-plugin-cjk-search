import { normalize } from '../src/core/normalize';

// issue #2 テストケース #1〜#6（文字正規化）
// #7〜#12（markdown・改行の扱い）はレビュー待ちのため未着手

test('全角英数は半角小文字になる', () => {
  expect(normalize('ＡＰＩ仕様')).toBe('api仕様');
});

test('半角カナは全角カナになる', () => {
  expect(normalize('ｻｰﾊﾞｰ設定')).toBe('サーバー設定');
});

test('全角スペースは半角スペースになる', () => {
  expect(normalize('雨漏り　対応')).toBe('雨漏り 対応');
});

test('NFDの濁点は1文字に合成される', () => {
  const nfd = 'がんぼう'; // 5コードポイント
  expect([...nfd].length).toBe(5);
  expect(normalize(nfd)).toBe('がんぼう');
  expect([...normalize(nfd)].length).toBe(4);
});

test('丸数字は算用数字になる', () => {
  expect(normalize('①項目')).toBe('1項目');
});

test('半角大文字は小文字になる', () => {
  expect(normalize('API仕様')).toBe('api仕様');
});
