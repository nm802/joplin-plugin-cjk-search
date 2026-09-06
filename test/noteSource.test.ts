import { fetchAllNotes, type DataApi } from '../src/joplin/noteSource';

// issue #9 テストケース #1〜#4（joplin.data のページング）

/** `pages` の各要素を1回の呼び出しで返し、最後のページだけ has_more を false にする。 */
const mockApi = (pages: number[]) => {
  const calls: { path: string[]; query: Record<string, unknown> }[] = [];
  let issued = 0;
  const api: DataApi = {
    get: async (path, query) => {
      calls.push({ path, query: query ?? {} });
      const index = calls.length - 1;
      const count = pages[index] ?? 0;
      const items = Array.from({ length: count }, () => {
        const id = `n${issued++}`;
        return { id, title: `title ${id}`, body: `body ${id}`, updated_time: 1 };
      });
      return { items, has_more: index < pages.length - 1 };
    },
  };
  return { api, calls };
};

test('ページングで全件のノートを取得する', async () => {
  const { api } = mockApi([100, 100, 50]);
  const notes = await fetchAllNotes(api);
  expect(notes.length).toBe(250);
  expect(new Set(notes.map((n) => n.id)).size).toBe(250);
});

test('1ページで収まる場合も全件取得する', async () => {
  const { api } = mockApi([30]);
  expect((await fetchAllNotes(api)).length).toBe(30);
});

test('ノートが0件でも例外にならない', async () => {
  const { api } = mockApi([0]);
  expect(await fetchAllNotes(api)).toEqual([]);
});

test('取得するフィールドにidとtitleとbodyとupdated_timeが含まれる', async () => {
  const { api, calls } = mockApi([1]);
  await fetchAllNotes(api);
  const fields = calls[0].query.fields as string[];
  expect(fields).toEqual(expect.arrayContaining(['id', 'title', 'body', 'updated_time']));
});
