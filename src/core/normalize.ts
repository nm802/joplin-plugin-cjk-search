/**
 * 索引時とクエリ時に共通して通す正規化。
 *
 * 片側だけに掛けると取りこぼす。Joplin 本体はクエリを正規化しておきながら
 * LIKE の対象を未正規化の notes テーブルにしているため、全角で書かれた本文が
 * 全角でも半角でも引けない。同じ轍を踏まないよう、呼び出し口をこの1関数に絞る。
 *
 * NFKC は全角英数の半角化・半角カナの全角化・全角スペースの半角化・NFD 濁点の合成・
 * 丸数字の展開をまとめて行う。Lucene の CJKWidthFilter が扱う範囲を包含する。
 */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}
