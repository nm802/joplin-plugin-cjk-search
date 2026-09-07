import { snippetFor } from '../src/core/snippet';

// 検索結果に添える抜粋（issue #9 で追加）

test('一致箇所を含む位置から切り出す', () => {
  const body = 'あ'.repeat(200) + '屋根の防水工事' + 'い'.repeat(200);
  expect(snippetFor(body, '防水工事')).toContain('防水工事');
});

test('一致が無いときは本文の先頭から切り出す', () => {
  expect(snippetFor('雨漏り対応を業者へ依頼した', '存在しない語')).toContain('雨漏り対応');
});

test('全角英数の本文でも一致箇所から切り出す', () => {
  const body = 'あ'.repeat(200) + 'この機能のＡＰＩは別紙参照';
  // 位置は畳み込んだ文字で当てるが、画面に出すのは元の文字。
  expect(snippetFor(body, 'API')).toContain('ＡＰＩ');
});

test('ひらがなの本文はひらがなのまま出る', () => {
  const body = 'あ'.repeat(200) + 'さーばー設定を見直す';
  const snippet = snippetFor(body, 'サーバー');
  expect(snippet).toContain('さーばー設定');
  expect(snippet).not.toContain('サーバー');
});

test('markdown記号をまたぐ一致でも位置が合う', () => {
  const body = 'あ'.repeat(200) + '屋根の**防水**工事を実施した';
  expect(snippetFor(body, '防水工事')).toContain('屋根の防水工事');
});

test('行をまたぐ一致でも位置が合う', () => {
  const body = 'あ'.repeat(200) + 'The quick brown\nfox jumps over';
  expect(snippetFor(body, 'brown fox')).toContain('brown fox');
});

test('本文が空なら空文字を返す', () => {
  expect(snippetFor('', '防水')).toBe('');
});
