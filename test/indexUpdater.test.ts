import { SearchIndex, type Note } from '../src/core/searchIndex';
import { NodeSqliteDb } from '../src/core/nodeSqliteDb';
import { IndexUpdater, type NoteSource } from '../src/core/indexUpdater';

// issue #13 テストケース #1〜#8（差分更新・定期突合・失敗の可視化）

const T0 = Date.parse('2026-09-01T00:00:00Z');

const note = (id: string, body: string, updatedTime = T0): Note => ({
  id,
  title: '',
  body,
  updatedTime,
});

const INITIAL = [
  note('a', '屋根の雨漏りを確認した'),
  note('b', '外壁の塗装を検討する'),
  note('c', '床下の点検を依頼した'),
];

/** 取得の呼び出しを数え、解決を止められる差し替え用ノート源。 */
class FakeSource implements NoteSource {
  public notes = new Map<string, Note>();
  public getCalls: string[] = [];
  public stampCalls = 0;
  public inflight = 0;
  public maxInflight = 0;
  public failOnce = new Set<string>();
  private blocked = false;
  private releases: (() => void)[] = [];

  public constructor(notes: Note[]) {
    for (const n of notes) this.notes.set(n.id, n);
  }

  public block(): void {
    this.blocked = true;
  }

  public releaseAll(): void {
    this.blocked = false;
    for (const release of this.releases) release();
    this.releases = [];
  }

  public async get(id: string): Promise<Note | null> {
    this.getCalls.push(id);
    this.inflight++;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      if (this.blocked) await new Promise<void>((resolve) => this.releases.push(resolve));
      if (this.failOnce.delete(id)) throw new Error(`boom ${id}`);
      return this.notes.get(id) ?? null;
    } finally {
      this.inflight--;
    }
  }

  public async stamps(): Promise<Map<string, number>> {
    this.stampCalls++;
    return new Map([...this.notes.values()].map((n) => [n.id, n.updatedTime]));
  }
}

let index: SearchIndex;
let source: FakeSource;
let updater: IndexUpdater;

beforeEach(async () => {
  index = new SearchIndex(new NodeSqliteDb(':memory:'));
  await index.create();
  await index.putMany(INITIAL);
  source = new FakeSource(INITIAL.map((n) => ({ ...n })));
  updater = new IndexUpdater(index, source);
});

const search = async (query: string) => (await index.search(query)).sort();

test('変更されたノート1件だけが索引に入り直す', async () => {
  source.notes.set('a', note('a', '瓦屋根の防水工事を実施した', T0 + 1));

  updater.noteChanged('a', 2);
  await updater.idle();

  expect(await search('防水工事')).toEqual(['a']);
  expect(await search('雨漏り')).toEqual([]);
  // 全件取得していない。取りに行ったのは変更のあった1件だけ。
  expect(source.getCalls).toEqual(['a']);
  expect(source.stampCalls).toBe(0);
});

test('削除イベントでノートが索引から消える', async () => {
  updater.noteChanged('b', 3);
  await updater.idle();

  expect(await search('塗装')).toEqual([]);
  expect(await search('雨漏り')).toEqual(['a']);
  expect(await search('点検')).toEqual(['c']);
  // 消すだけなので取りに行かない。
  expect(source.getCalls).toEqual([]);
});

test('更新中に来た変更を捨てずに順に処理する', async () => {
  source.notes.set('a', note('a', '瓦屋根の防水工事', T0 + 1));
  source.notes.set('b', note('b', '外壁の高圧洗浄', T0 + 1));
  source.notes.set('c', note('c', '床下の湿気対策', T0 + 1));

  source.block();
  updater.noteChanged('a', 2);
  updater.noteChanged('b', 2);
  updater.noteChanged('c', 2);
  source.releaseAll();
  await updater.idle();

  expect(await search('防水工事')).toEqual(['a']);
  expect(await search('高圧洗浄')).toEqual(['b']);
  expect(await search('湿気対策')).toEqual(['c']);
  expect(source.maxInflight).toBe(1);
});

test('処理待ちの同じidは1回にまとめる', async () => {
  source.block();
  updater.noteChanged('a', 2);
  updater.noteChanged('a', 2);
  updater.noteChanged('a', 2);
  updater.noteChanged('a', 2);
  source.releaseAll();
  await updater.idle();

  // 走行中の1回と、積まれた分を畳んだ1回。
  expect(source.getCalls).toEqual(['a', 'a']);
});

test('定期突合は更新日時が食い違うノートの本文だけを取りに行く', async () => {
  source.notes.set('c', note('c', '床下の湿気対策を実施した', T0 + 5));

  await updater.reconcile();

  expect(source.getCalls).toEqual(['c']);
  expect(await search('湿気対策')).toEqual(['c']);
  expect(await search('雨漏り')).toEqual(['a']);
});

test('定期突合は一覧から消えたノートを索引から落とす', async () => {
  source.notes.delete('b');

  await updater.reconcile();

  expect(await search('塗装')).toEqual([]);
  expect(await search('雨漏り')).toEqual(['a']);
  expect(await search('点検')).toEqual(['c']);
});

test('索引更新が例外を投げても次の更新は走る', async () => {
  source.notes.set('a', note('a', '瓦屋根の防水工事', T0 + 1));
  source.notes.set('b', note('b', '外壁の高圧洗浄', T0 + 1));
  source.failOnce.add('a');

  updater.noteChanged('a', 2);
  updater.noteChanged('b', 2);
  await updater.idle();

  expect(await search('高圧洗浄')).toEqual(['b']);
  expect(await search('雨漏り')).toEqual(['a']); // 失敗した a は古いまま残る
  expect(source.getCalls).toEqual(['a', 'b']);
});

test('全件構築の最中は突き合わせを走らせない', async () => {
  source.notes.set('c', note('c', '床下の湿気対策を実施した', T0 + 5));

  updater.hold();
  await updater.reconcile();

  // 索引が育っている途中に突き合わせると全件が食い違って見え、構築の直後に
  // 同じノートを1件ずつ取り直すことになる。
  expect(source.stampCalls).toBe(0);
  expect(source.getCalls).toEqual([]);

  updater.release();
  await updater.reconcile();

  expect(source.getCalls).toEqual(['c']);
});

test('索引更新の結果が状態として読み出せる', async () => {
  source.notes.set('a', note('a', '瓦屋根の防水工事', T0 + 1));
  source.notes.set('b', note('b', '外壁の高圧洗浄', T0 + 1));

  updater.noteChanged('a', 2);
  await updater.idle();
  updater.noteChanged('b', 2);
  await updater.idle();

  expect(updater.state().changed).toBe(2);
  expect(updater.state().error).toBeNull();
  expect(updater.state().pending).toBe(0);
});
