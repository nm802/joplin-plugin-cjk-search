import { normalize } from './normalize';

/** 抜粋の長さ。ダイアログの1行に収まる程度。 */
const WIDTH = 60;

/**
 * 検索結果に添える本文の抜粋。
 *
 * 一致箇所を含む位置から切り出す。先頭固定で切ると、本文の後ろのほうで当たった
 * ノートは「なぜ当たったのか」が画面から分からない。
 *
 * 位置の探索は正規化した本文に対して行う。索引と同じ土俵で当てないと、全角英数や
 * markdown 記号をまたぐ一致では見つからず、先頭に落ちてしまう。
 */
export function snippetFor(body: string, query: string): string {
  const text = normalize(body);
  if (text === '') return '';

  const words = normalize(query).split(' ').filter((w) => w !== '');
  let at = -1;
  for (const word of words) {
    const found = text.indexOf(word);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }

  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(WIDTH / 4));
  const slice = text.slice(start, start + WIDTH);
  return (start > 0 ? '…' : '') + slice + (start + WIDTH < text.length ? '…' : '');
}
