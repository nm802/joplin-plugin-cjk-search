import { fetchAllNotes, type DataApi } from '../src/joplin/noteSource';

// issue #14 テストケース #1〜#4（ページ送りを id 順に固定する）

interface Row {
  id: string;
  title: string;
  body: string;
  updated_time: number;
}

/**
 * 本体の `collectionToPaginatedResults` と同じ振る舞いをする偽 API。
 * 渡された `order_by` で並べ替えてから `page`/`limit` で切り出す。
 * 既定は本体と同じ `updated_time` 昇順。
 */
const fakeApi = (rows: Row[], onPage?: (page: number, rows: Row[]) => void) => {
  const calls: Record<string, unknown>[] = [];
  const api: DataApi = {
    get: async (_path, query = {}) => {
      calls.push(query);
      const by = (query.order_by as keyof Row) ?? 'updated_time';
      const limit = (query.limit as number) ?? 100;
      const page = (query.page as number) ?? 1;
      // 並び替えのキーが同値のときの順序は SQLite では不定。呼び出しごとに入れ替えて
      // その状況を作る。id 順に固定できていれば同値そのものが起きない。
      const flip = calls.length % 2 === 0 ? 1 : -1;
      const sorted = rows
        .slice()
        .sort((a, b) =>
          a[by] < b[by] ? -1 : a[by] > b[by] ? 1 : a.id < b.id ? -flip : a.id > b.id ? flip : 0,
        );
      const start = (page - 1) * limit;
      const items = sorted.slice(start, start + limit);
      onPage?.(page, rows);
      return { items, has_more: items.length >= limit };
    },
  };
  return { api, calls };
};

/** id は Joplin と同じく32桁の16進。並びが updated_time と一致しないように散らす。 */
const makeRows = (count: number, updatedTime: (i: number) => number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: ((i * 7919) % count).toString(16).padStart(32, '0'),
    title: `title ${i}`,
    body: `body ${i}`,
    updated_time: updatedTime(i),
  }));

test('取得中に保存されたノートがあっても全件が1回ずつ返る', async () => {
  const rows = makeRows(250, (i) => 1788600000000 + i);
  // 2ページ目を返した直後に、1ページ目に含まれていた1件を最新にする。
  const { api } = fakeApi(rows, (page, current) => {
    if (page === 2) current[3].updated_time = 1788699999999;
  });

  const notes = await fetchAllNotes(api);

  expect(notes.length).toBe(250);
  expect(new Set(notes.map((n) => n.id)).size).toBe(250);
  expect(new Set(notes.map((n) => n.id))).toEqual(new Set(rows.map((r) => r.id)));
});

test('更新日時が全件同値でも全件が1回ずつ返る', async () => {
  const rows = makeRows(250, () => 1788600000000);
  const { api } = fakeApi(rows);

  const notes = await fetchAllNotes(api);

  expect(notes.length).toBe(250);
  expect(new Set(notes.map((n) => n.id))).toEqual(new Set(rows.map((r) => r.id)));
});

test('取得中に削除されたノートがあっても重複しない', async () => {
  const rows = makeRows(250, (i) => 1788600000000 + i);
  const { api } = fakeApi(rows, (page, current) => {
    if (page === 2) current.splice(0, 1);
  });

  const notes = await fetchAllNotes(api);

  expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
});

test('1ページに満たない件数でも全件返る', async () => {
  const rows = makeRows(30, (i) => 1788600000000 + i);
  const { api, calls } = fakeApi(rows);

  expect((await fetchAllNotes(api)).length).toBe(30);
  expect(calls.length).toBe(1);
});
