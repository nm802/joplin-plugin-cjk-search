import type { Db } from './db';
import { normalize } from './normalize';
import { analyze } from './analyze';

/** FTS5 の文字列リテラルは二重引用符で囲み、中の `"` は重ねて escape する。 */
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * bigram 転置索引。
 *
 * 索引は FTS5 に位置情報つきで作り、2文字以上のクエリはフレーズ検索で引く。
 * AND では位置が見られないため `国産の日産車` が `国産車` で誤ヒットする。
 * 位置情報を捨てて AND + 実文字列検証にする案は実測で 10〜25倍遅く、
 * 得られる索引の縮小は 15% にとどまったため採らない（docs/evernote-research.md）。
 */
export class SearchIndex {
  public constructor(private db: Db) {}

  public async create(): Promise<void> {
    await this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_ng
       USING fts5(note_id UNINDEXED, tok, tail, tokenize='ascii')`,
    );
  }

  /** ノート1件を索引に入れる。既に入っていれば置き換える。 */
  public async put(noteId: string, body: string): Promise<void> {
    await this.remove(noteId);
    const { tok, tail } = analyze(normalize(body));
    await this.db.run('INSERT INTO notes_ng(note_id, tok, tail) VALUES (?, ?, ?)', [
      noteId,
      tok.join(' '),
      tail.join(' '),
    ]);
  }

  /**
   * 複数件をまとめて索引に入れる。初回の全件構築で使う。
   *
   * 1件ずつ put すると各文が独立したトランザクションになり、件数ぶんの fsync が走る。
   * 2750件の投入が10分を超えて終わらなかったため、明示的に囲む。
   */
  public async putMany(entries: Iterable<[string, string]>): Promise<void> {
    await this.db.exec('BEGIN');
    try {
      for (const [noteId, body] of entries) await this.put(noteId, body);
      await this.db.exec('COMMIT');
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  public async remove(noteId: string): Promise<void> {
    await this.db.run('DELETE FROM notes_ng WHERE note_id = ?', [noteId]);
  }

  /**
   * 半角スペース区切りの複数語は AND（積集合）。Joplin 本体も Evernote も既定は AND。
   * 全角スペースは normalize() が半角へ畳むので、区切りとして同じに働く。
   */
  public async search(query: string): Promise<string[]> {
    const words = normalize(query).split(' ').filter((w) => w !== '');
    if (words.length === 0) return [];

    let result: string[] | null = null;
    for (const word of words) {
      const hits = await this.searchWord(word);
      if (result === null) {
        result = hits;
      } else {
        // Array#includes で突き合わせると語数×件数の総当たりになる。
        // 全件が一致する語では 2750×2750 まで膨らんだため Set で引く。
        const hitSet = new Set(hits);
        result = result.filter((id) => hitSet.has(id));
      }
      if (result.length === 0) return [];
    }
    return (result as string[]).sort();
  }

  private async searchWord(word: string): Promise<string[]> {
    const { tok } = analyze(word);
    if (tok.length === 0) return [];

    // 1文字のクエリは bigram 索引に完全一致するトークンが無い。tok の前方一致で
    // 語頭・語中を拾い、前方一致では届かない末尾文字を tail の完全一致で補う。
    const match =
      [...word].length === 1
        ? `tok:${quote(word)} * OR tail:${quote(word)}`
        : `tok:${quote(tok.join(' '))}`;

    const rows = await this.db.all<{ note_id: string }>(
      'SELECT note_id FROM notes_ng WHERE notes_ng MATCH ?',
      [match],
    );
    return rows.map((r) => r.note_id);
  }
}
