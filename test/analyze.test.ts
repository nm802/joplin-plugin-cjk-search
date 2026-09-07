import { analyze } from '../src/core/analyze';
import { normalize } from '../src/core/normalize';

// issue #3 テストケース #1〜#4（トークン生成）

test('日本語の連続部分は重なりbigramになる', () => {
  expect(analyze(normalize('国産の日産車')).tok).toEqual([
    '国産', '産ノ', 'ノ日', '日産', '産車',
  ]);
});

test('ラテン語と数字は1トークンとして保たれる', () => {
  const { tok } = analyze(normalize('型番QZ-4700の熱設計'));
  expect(tok).toContain('qz');
  expect(tok).toContain('4700');
});

test('1文字の連続部分はunigramとしてtokに出る', () => {
  expect(analyze(normalize('国産 車')).tok).toEqual(['国産', '車']);
});

test('各連続部分の末尾文字はtail列に出る', () => {
  expect(analyze(normalize('型番メモ 型番QZ-4700の熱設計を検討する')).tail).toEqual([
    'モ', '番', 'ル',
  ]);
});
