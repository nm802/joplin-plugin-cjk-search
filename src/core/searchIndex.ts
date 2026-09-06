import type { Db } from './db';
import { normalize } from './normalize';
import { analyze } from './analyze';

/** FTS5 の文字列リテラルは二重引用符で囲み、中の `"` は重ねて escape する。 */
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * 正規化・トークン化の出力が変わったら上げる。上げ忘れると、古い索引を使い続けて
 * 静かに取りこぼす。
 */
export const ANALYZER_VERSION = 1;

/** 索引の列構成が変わったら上げる。 */
export const SCHEMA_VERSION = 1;

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedTime: number;
}

export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

interface Row {
  note_id: string;
  updated_time: number;
  score: number;
}

/**
 * bigram 転置索引。
 *
 * 索引は FTS5 に位置情報つきで作り、2文字以上のクエリはフレーズ検索で引く。
 * AND では位置が見られないため `国産の日産車` が `国産車` で誤ヒットする。
 * 位置情報を捨てて AND + 実文字列検証にする案は実測で 10〜25倍遅く、
 * 得られる索引の縮小は 15% にとどまったため採らない（docs/evernote-research.md）。
 *
 * タイトルと本文は別のトークン列として持つ。連結するとタイトル末尾と本文先頭に
 * またがる偽の bigram ができ、タイトル `屋根の防水` と本文 `工事を実施した` を持つ
 * ノートが `防水工事` で引けてしまう。
 */
export class SearchIndex {
  public constructor(private db: Db) {}

  public async create(): Promise<void> {
    await this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_ng USING fts5(
         note_id UNINDEXED, updated_time UNINDEXED,
         title_tok, title_tail, tok, tail,
         tokenize='ascii')`,
    );
    await this.db.exec(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    );
    const rows = await this.db.all<{ n: number }>('SELECT count(*) AS n FROM meta');
    if (rows[0].n === 0) {
      await this.db.run('INSERT INTO meta(key, value) VALUES (?, ?)', [
        'analyzer_version',
        ANALYZER_VERSION,
      ]);
      await this.db.run('INSERT INTO meta(key, value) VALUES (?, ?)', [
        'schema_version',
        SCHEMA_VERSION,
      ]);
    }
  }

  public async version(): Promise<{ analyzerVersion: number; schemaVersion: number }> {
    const rows = await this.db.all<{ key: string; value: number }>('SELECT key, value FROM meta');
    const get = (key: string) => rows.find((r) => r.key === key)?.value ?? -1;
    return { analyzerVersion: get('analyzer_version'), schemaVersion: get('schema_version') };
  }

  /**
   * 索引が実装と食い違っていないか。
   *
   * 食い違っていても**自動では作り直さない。** 全件構築は 2750ノートで 68秒かかるので、
   * 走らせるかどうかは呼び出し側が確認を取って決める。
   */
  public async needsRebuild(): Promise<boolean> {
    const { analyzerVersion, schemaVersion } = await this.version();
    return analyzerVersion !== ANALYZER_VERSION || schemaVersion !== SCHEMA_VERSION;
  }

  /** テスト専用。索引に古いバージョンが書かれている状況を作る。 */
  public async setVersionForTest(analyzerVersion: number, schemaVersion: number): Promise<void> {
    await this.db.run('UPDATE meta SET value = ? WHERE key = ?', [
      analyzerVersion,
      'analyzer_version',
    ]);
    await this.db.run('UPDATE meta SET value = ? WHERE key = ?', [schemaVersion, 'schema_version']);
  }

  public async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * 渡されたノート集合に索引を合わせる。
   *
   * 全件構築は 2750ノートで 68秒かかるため、起動のたびに走らせない。
   * `updated_time` を突き合わせ、変わったものだけ入れ直す。
   */
  public async sync(notes: Iterable<Note>): Promise<SyncReport> {
    const known = new Map<string, number>();
    for (const row of await this.db.all<{ note_id: string; updated_time: number }>(
      'SELECT note_id, updated_time FROM notes_ng',
    )) {
      known.set(row.note_id, row.updated_time);
    }

    const report: SyncReport = { added: 0, updated: 0, removed: 0, unchanged: 0 };
    const seen = new Set<string>();

    await this.db.exec('BEGIN');
    try {
      for (const note of notes) {
        seen.add(note.id);
        const indexed = known.get(note.id);
        if (indexed === undefined) {
          await this.put(note);
          report.added++;
        } else if (note.updatedTime > indexed) {
          await this.put(note);
          report.updated++;
        } else {
          report.unchanged++;
        }
      }
      for (const noteId of known.keys()) {
        if (!seen.has(noteId)) {
          await this.remove(noteId);
          report.removed++;
        }
      }
      await this.db.exec('COMMIT');
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
    return report;
  }

  /** ノート1件を索引に入れる。既に入っていれば置き換える。 */
  public async put(note: Note): Promise<void> {
    await this.remove(note.id);
    const title = analyze(normalize(note.title));
    const body = analyze(normalize(note.body));
    await this.db.run(
      `INSERT INTO notes_ng(note_id, updated_time, title_tok, title_tail, tok, tail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.updatedTime,
        title.tok.join(' '),
        title.tail.join(' '),
        body.tok.join(' '),
        body.tail.join(' '),
      ],
    );
  }

  /**
   * 複数件をまとめて索引に入れる。初回の全件構築で使う。
   *
   * 1件ずつ put すると各文が独立したトランザクションになり、件数ぶんの fsync が走る。
   * 2750件の投入が10分を超えて終わらなかったため、明示的に囲む。
   */
  public async putMany(notes: Iterable<Note>): Promise<void> {
    await this.db.exec('BEGIN');
    try {
      for (const note of notes) await this.put(note);
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
   *
   * 並び順は「全語がタイトルに当たったもの → BM25 の合計 → 更新日時の降順 → id」。
   * タイトルを最優先にするのは、Ctrl+P がノートへ飛ぶための入口だから。
   * 件数の上限は設けない。上限は表示側で扱う（docs/requirements.md FR-4）。
   */
  public async search(query: string): Promise<string[]> {
    const words = normalize(query)
      .split(' ')
      .filter((w) => w !== '');
    if (words.length === 0) return [];

    const scores = new Map<string, { score: number; updatedTime: number }>();
    let matched: Set<string> | null = null;
    let titleMatched: Set<string> | null = null;

    for (const word of words) {
      const anyRows = await this.matchRows(word, 'all');
      const anyIds = new Set(anyRows.map((r) => r.note_id));
      matched = matched === null ? anyIds : intersect(matched, anyIds);
      if (matched.size === 0) return [];

      for (const row of anyRows) {
        const prev = scores.get(row.note_id);
        scores.set(row.note_id, {
          score: (prev?.score ?? 0) + row.score,
          updatedTime: row.updated_time,
        });
      }

      const titleIds = new Set(
        (await this.matchRows(word, 'title')).map((r) => r.note_id),
      );
      titleMatched = titleMatched === null ? titleIds : intersect(titleMatched, titleIds);
    }

    const inTitle = titleMatched as Set<string>;
    return [...(matched as Set<string>)].sort((a, b) => {
      const at = inTitle.has(a) ? 0 : 1;
      const bt = inTitle.has(b) ? 0 : 1;
      if (at !== bt) return at - bt;
      // bm25() は一致が良いほど小さい（負に大きい）値を返す。
      const sa = scores.get(a) as { score: number; updatedTime: number };
      const sb = scores.get(b) as { score: number; updatedTime: number };
      if (sa.score !== sb.score) return sa.score - sb.score;
      if (sa.updatedTime !== sb.updatedTime) return sb.updatedTime - sa.updatedTime;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /** 1語を、指定した範囲（タイトルのみ / タイトルと本文）に対して引く。 */
  private async matchRows(word: string, scope: 'title' | 'all'): Promise<Row[]> {
    const { tok } = analyze(word);
    if (tok.length === 0) return [];

    const fields = scope === 'title' ? [['title_tok', 'title_tail']] : [
      ['title_tok', 'title_tail'],
      ['tok', 'tail'],
    ];

    // 1文字のクエリは bigram 索引に完全一致するトークンが無い。tok の前方一致で
    // 語頭・語中を拾い、前方一致では届かない末尾文字を tail の完全一致で補う。
    const single = [...word].length === 1;
    const terms = fields.flatMap(([tokCol, tailCol]) =>
      single
        ? [`${tokCol}:${quote(word)} *`, `${tailCol}:${quote(word)}`]
        : [`${tokCol}:${quote(tok.join(' '))}`],
    );

    return this.db.all<Row>(
      `SELECT note_id, updated_time, bm25(notes_ng) AS score
       FROM notes_ng WHERE notes_ng MATCH ?`,
      [terms.join(' OR ')],
    );
  }
}

const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)));
