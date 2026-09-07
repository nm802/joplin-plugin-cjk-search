import { normalize, foldChars, stripInlineMarkup } from './normalize';

/** 抜粋の長さ。ダイアログの1行に収まる程度。 */
const WIDTH = 60;

/** 1文字と、それに続く結合文字（NFD の濁点など）をひとまとまりにする。 */
const SEGMENT = /[\s\S][̀-゙゚ͯ]*/gu;

/**
 * 表示に使う文字列と、畳み込み後の位置から表示側の位置への対応表を作る。
 *
 * 畳み込みは長さを変える（`ｶﾞ` は1文字に、`①` は `1` になる）。位置をそのまま
 * 使い回すとずれるので、畳み込んだ1文字ごとに元の位置を控える。
 */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (const match of text.matchAll(SEGMENT)) {
    const at = match.index as number;
    // 改行は normalize() が空白に畳む。ここも同じにしないと行をまたぐ一致を見失う。
    const piece = /^\s$/.test(match[0]) ? ' ' : foldChars(match[0]);
    for (const ch of piece) {
      folded += ch;
      map.push(at);
    }
  }
  return { folded, map };
}

/**
 * 検索結果に添える本文の抜粋。
 *
 * 一致箇所を含む位置から切り出す。先頭固定で切ると、本文の後ろのほうで当たった
 * ノートは「なぜ当たったのか」が画面から分からない。
 *
 * **位置の探索は畳み込んだ文字で行い、画面に出すのは元の文字。** 索引と同じ土俵で
 * 当てないと、全角英数や行をまたぐ一致では見つからず先頭に落ちる。一方、畳み込んだ
 * 文字をそのまま出すと、ひらがなで書いた本文がカタカナで表示される。
 *
 * markdown 記号だけは落とした状態を表示元にする。記号をまたぐ一致に位置を合わせるためで、
 * 落ちるのは `*` や `` ` `` のような記号だけなので、読めなくはならない。
 */
export function snippetFor(body: string, query: string): string {
  const source = stripInlineMarkup(body);
  const { folded, map } = foldWithMap(source);
  if (folded.trim() === '') return '';

  const words = normalize(query)
    .split(' ')
    .filter((w) => w !== '');
  let at = -1;
  for (const word of words) {
    const found = folded.indexOf(word);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }

  const hit = at < 0 ? 0 : map[at];
  const start = Math.max(0, hit - Math.floor(WIDTH / 4));
  const slice = source.slice(start, start + WIDTH).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + slice + (start + WIDTH < source.length ? '…' : '');
}
