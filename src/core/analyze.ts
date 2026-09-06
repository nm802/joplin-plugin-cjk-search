/**
 * CJKAnalyzer 互換のトークン化。
 *
 * Lucene の CJKAnalyzer と同じ構成（スクリプト境界での分割 → 幅畳み込み → 小文字化 →
 * CJK の重なり bigram）を再実装したもの。Lucene 本体は Java でありプラグインからは
 * 使えないため、移植ではない。幅畳み込みと小文字化は normalize() が担うので、
 * ここではスクリプト境界の分割と bigram 化だけを行う。
 *
 * 入力は normalize() を通した文字列であること。索引時とクエリ時の双方が同じ経路を
 * 通ることがこのプラグインの前提なので、片側だけ normalize() を省いてはならない。
 */

export interface Tokens {
  /** フレーズ検索用のトークン列。位置がそのまま意味を持つので順序と個数を崩さない。 */
  tok: string[];
  /**
   * 各 CJK 連続部分の末尾文字。
   *
   * bigram 索引には単字トークンが無いため、1文字クエリは前方一致（`雨*`）で拾う。
   * だが連続部分の末尾文字だけは「その文字で始まる bigram」が存在せず前方一致で拾えない。
   * かといって tok 列に unigram として混ぜると位置がずれてフレーズ検索が壊れるため、
   * 別の列に分ける。
   */
  tail: string[];
}

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) as number;
  return (
    (c >= 0x3040 && c <= 0x30ff) || // ひらがな・カタカナ
    (c >= 0x31f0 && c <= 0x31ff) || // カタカナ拡張
    (c >= 0x3400 && c <= 0x4dbf) || // CJK統合漢字拡張A
    (c >= 0x4e00 && c <= 0x9fff) || // CJK統合漢字
    (c >= 0xf900 && c <= 0xfaff) || // CJK互換漢字
    (c >= 0xac00 && c <= 0xd7af) //   ハングル
  );
}

const isLatinAlnum = (ch: string) => /[0-9a-z]/i.test(ch) && !isCjk(ch);

export function analyze(text: string): Tokens {
  const tok: string[] = [];
  const tail: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (isLatinAlnum(text[i])) {
      // ラテン語・数字は語のまま1トークン。文字単位に割らないので `PI` では `API` に当たらない。
      let j = i;
      while (j < text.length && isLatinAlnum(text[j])) j++;
      tok.push(text.slice(i, j));
      i = j;
    } else if (isCjk(text[i])) {
      let j = i;
      while (j < text.length && isCjk(text[j])) j++;
      const run = text.slice(i, j);
      if (run.length === 1) {
        tok.push(run);
      } else {
        for (let k = 0; k < run.length - 1; k++) tok.push(run.slice(k, k + 2));
      }
      tail.push(run[run.length - 1]);
      i = j;
    } else {
      // 空白・記号は区切り。またいで bigram を作らない。
      i++;
    }
  }

  return { tok, tail };
}
