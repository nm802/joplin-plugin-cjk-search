import type { Note } from '../core/searchIndex';

/**
 * `joplin.data` のうち、この層が使う部分だけ。
 * Joplin の型に直接依存させないことで、モックを渡してヘッドレスに検証できる。
 */
export interface DataApi {
  get(
    path: string[],
    query?: Record<string, unknown>,
  ): Promise<{ items: RawNote[]; has_more: boolean }>;
}

interface RawNote {
  id: string;
  title: string;
  body: string;
  updated_time: number;
}

/**
 * 索引に必要な項目。`updated_time` を取り忘れると差分適用が常に全件更新になる
 * （SearchIndex.sync が更新日時の差で判定するため）。
 */
const FIELDS = ['id', 'title', 'body', 'updated_time'];

/** 1回の取得件数。Joplin の既定は10件と少ないので明示する。 */
const PAGE_SIZE = 100;

/**
 * ノートを全件取得する。
 *
 * `has_more` が false になるまで回す。1ページ目だけ取って終わる実装は、
 * ノートが少ないうちは正しく見えて、増えたところで静かに取りこぼす。
 */
export async function fetchAllNotes(api: DataApi): Promise<Note[]> {
  const notes: Note[] = [];
  let page = 1;

  for (;;) {
    const response = await api.get(['notes'], { fields: FIELDS, limit: PAGE_SIZE, page });
    for (const item of response.items) {
      notes.push({
        id: item.id,
        title: item.title ?? '',
        body: item.body ?? '',
        updatedTime: item.updated_time,
      });
    }
    if (!response.has_more) return notes;
    page++;
  }
}
