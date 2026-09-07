import type { Note } from '../core/searchIndex';
import type { NoteSource } from '../core/indexUpdater';

/**
 * `joplin.data` のうち、この層が使う部分だけ。
 * Joplin の型に直接依存させないことで、モックを渡してヘッドレスに検証できる。
 *
 * 戻り値は経路で形が違う（一覧はページ、単体はノートそのもの）ので `unknown` で受けて
 * 呼び出し側で絞る。
 */
export interface DataApi {
  get(path: string[], query?: Record<string, unknown>): Promise<unknown>;
}

interface RawNote {
  id: string;
  title: string;
  body: string;
  updated_time: number;
}

interface Page {
  items: RawNote[];
  has_more: boolean;
}

const toNote = (item: RawNote): Note => ({
  id: item.id,
  title: item.title ?? '',
  body: item.body ?? '',
  updatedTime: item.updated_time,
});

/**
 * 索引に必要な項目。`updated_time` を取り忘れると差分適用が常に全件更新になる
 * （SearchIndex.sync が更新日時の差で判定するため）。
 */
const FIELDS = ['id', 'title', 'body', 'updated_time'];

/** 1回の取得件数。Joplin の既定は10件と少ないので明示する。 */
const PAGE_SIZE = 100;

/**
 * ページ送りの並び順。
 *
 * 本体の既定は `updated_time` 昇順で、同値のときの決め手が無い
 * （`paginationToSql.ts` は tiebreaker を付けない）。**一意でも不変でもないキーの上で
 * offset を進めると静かに取りこぼす。** 取得中に1件でも保存されるとその行が末尾へ移り、
 * 以降の全行が1つ前へ詰まって、ページ境界の1件がどのページにも現れない。同値の行が
 * 多い場合はクエリごとに順序が入れ替わって重複と欠落が同時に起きる。
 *
 * `id` は一意で、ノートを編集しても変わらない。
 */
const ORDER: Record<string, unknown> = { order_by: 'id', order_dir: 'ASC' };

/**
 * ノートを全件取得する。
 *
 * `has_more` が false になるまで回す。1ページ目だけ取って終わる実装は、
 * ノートが少ないうちは正しく見えて、増えたところで静かに取りこぼす。
 *
 * 同じ id は1回しか返さない。取得の途中でノートが削除されると後ろの行が繰り上がり、
 * 同じ行が2つのページに現れることがある。
 */
export async function fetchAllNotes(api: DataApi): Promise<Note[]> {
  const notes: Note[] = [];
  const seen = new Set<string>();
  let page = 1;

  for (;;) {
    const response = (await api.get(['notes'], {
      fields: FIELDS,
      limit: PAGE_SIZE,
      page,
      ...ORDER,
    })) as Page;
    for (const item of response.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      notes.push(toNote(item));
    }
    if (!response.has_more) return notes;
    page++;
  }
}

/** 突き合わせ用。本文を運ばないので全件でも軽い。 */
const STAMP_FIELDS = ['id', 'updated_time'];

/** `IndexUpdater` へ渡す取り寄せ口。 */
export function joplinNoteSource(api: DataApi): NoteSource {
  return {
    async get(id: string): Promise<Note | null> {
      try {
        const item = (await api.get(['notes', id], { fields: FIELDS })) as RawNote | null;
        return item && item.id ? toNote(item) : null;
      } catch (error) {
        // 消えたノートを取りに行くと本体は 404 を投げる。削除イベントが来ない経路が
        // あるので、これは失敗ではなく「消えた」として扱う。
        if (/not found/i.test(error instanceof Error ? error.message : String(error))) return null;
        throw error;
      }
    },

    async stamps(): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      let page = 1;
      for (;;) {
        const response = (await api.get(['notes'], {
          fields: STAMP_FIELDS,
          limit: PAGE_SIZE,
          page,
          ...ORDER,
        })) as Page;
        for (const item of response.items) out.set(item.id, item.updated_time);
        if (!response.has_more) return out;
        page++;
      }
    },
  };
}
