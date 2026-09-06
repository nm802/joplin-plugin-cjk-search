/**
 * 索引時とクエリ時に共通して通す正規化。
 *
 * 片側だけに掛けると取りこぼす。Joplin 本体はクエリを正規化しておきながら
 * LIKE の対象を未正規化の notes テーブルにしているため、全角で書かれた本文が
 * 全角でも半角でも引けない。同じ轍を踏まないよう、呼び出し口をこの1関数に絞る。
 */

/** 行頭に来るとブロック要素を開始する記号（見出し・リスト・引用）。 */
const BLOCK_START = /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+|>[ \t]*)/;

/**
 * 行頭のブロック記号を落とす。`## ## 見出し` のように重なっていても
 * 全て落ちるまで繰り返す（冪等性のため）。
 */
function stripBlockMarkers(line: string): string {
  let out = line;
  while (BLOCK_START.test(out)) out = out.replace(BLOCK_START, '');
  return out;
}

/**
 * インラインの markdown 記号を落とす。
 *
 * リンクは表示文字列だけ残し URL とノート ID は捨てる。`:/0a1b2c…` のような
 * ID が検索に引っかかっても邪魔にしかならない。
 * コードスパンは記号だけ落として中身は残す。識別子やコマンドは検索したい対象。
 * `_` は落とさない。`notes_fts` のような識別子を壊すため。
 *
 * 入れ子（`[[a](b)](c)`）は内側から順に解けるので、変化がなくなるまで繰り返す。
 */
function stripInlineMarkup(text: string): string {
  let out = text;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/!?\[([^[\]]*)\]\([^()]*\)/g, '$1');
    out = out.replace(/\*+/g, '');
    out = out.replace(/~~/g, '');
    out = out.replace(/`+/g, '');
  } while (out !== prev);
  return out;
}

/**
 * 行を1本のテキストに畳む。行のあいだには必ず空白を入れる。
 *
 * **改行は語の区切りとして扱う。日本語でも連結しない**（docs/requirements.md FR-3）。
 * markdown は段落内の単独改行を空白として描画するので、連結すると索引が本体の
 * 表示と食い違う。`昨日は雨\n傘を買った` から `雨傘` が引けるような、存在しない
 * 複合語もできる。誤ヒットは利用者の側から取り除けない。
 *
 * 記号を落とした位置は別扱いで、空白を入れない（stripInlineMarkup）。
 * `屋根の**防水**工事` は `屋根の防水工事` のままにする。
 */
function joinLines(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    const stripped = stripBlockMarkers(line);
    if (stripped.trim() === '') continue;
    if (out !== '') out += ' ';
    out += stripped;
  }
  return out;
}

/**
 * NFKC は全角英数の半角化・半角カナの全角化・全角スペースの半角化・NFD 濁点の合成・
 * 丸数字の展開をまとめて行う。Lucene の CJKWidthFilter が扱う範囲を包含する。
 */
export function normalize(text: string): string {
  const joined = joinLines(stripInlineMarkup(text).split('\n'));
  return joined.normalize('NFKC').toLowerCase().replace(/[ \t]+/g, ' ').trim();
}
