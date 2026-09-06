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

// issue #2 テストケース #7〜#13（markdown・改行の扱い）

test('強調記号は除去され前後が連結される', () => {
  expect(normalize('屋根の**防水**工事')).toBe('屋根の防水工事');
});

test('見出し記号とリスト記号は除去される', () => {
  expect(normalize('## 見出し\n- 項目')).toBe('見出し 項目');
});

test('リンク記法は表示文字列だけ残る', () => {
  expect(normalize('[雨漏り](:/0a1b2c)')).toBe('雨漏り');
});

test('コードスパンの中身は保持される', () => {
  expect(normalize('`notes_fts` を見る')).toBe('notes_fts を見る');
});

test('段落内の改行は除去され前後が連結される', () => {
  expect(normalize('屋根の防水\n工事を実施')).toBe('屋根の防水工事を実施');
});

test('空行をまたぐ場合は連結されず区切られる', () => {
  expect(normalize('雨漏り対応\n\n屋根の防水')).toBe('雨漏り対応 屋根の防水');
});

test('正規化は冪等である', () => {
  for (const s of ['****防水****', '## ## 見出し', '[[a](b)](c)']) {
    expect(normalize(normalize(s))).toBe(normalize(s));
  }
});
