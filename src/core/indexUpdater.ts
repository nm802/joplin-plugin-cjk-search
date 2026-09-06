import type { SearchIndex, Note } from './searchIndex';

/**
 * ノートの取り寄せ口。Joplin API への依存はここで切る。
 * 実装は `src/joplin/noteSource.ts`、テストは差し替えたもので検証する。
 */
export interface NoteSource {
  /** 1件取得する。存在しなければ null。 */
  get(id: string): Promise<Note | null>;
  /** 全ノートの id と更新日時だけを取る。本文を運ばないので軽い。 */
  stamps(): Promise<Map<string, number>>;
}

/** 索引を書き換えたことを外へ伝える口。ダイアログ用のタイトル・本文を持つ側が使う。 */
export interface UpdaterHooks {
  onPut?: (note: Note) => void;
  onRemove?: (id: string) => void;
}

export interface UpdateState {
  /** 起動してから索引に入れ直した件数。 */
  changed: number;
  /** 直近に出た例外のメッセージ。出ていなければ null。 */
  error: string | null;
  /** 処理待ちの件数。 */
  pending: number;
}

/** Joplin の ItemChange。3 が削除。 */
const EVENT_DELETE = 3;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 変更のあったノートだけを索引に入れ直す。
 *
 * **変更1件につき全件を取り直さない。** 2726ノートの全件取得は数十秒かかり、その間に来た
 * 変更を捨てる実装だと、編集中の自動保存が連続したときに最初の1回しか残らない。
 *
 * **走行中に来た id は捨てずに積む。** 同じ id は1回に畳む。処理は直列で、同時に2件を
 * 取りに行かない。
 *
 * **イベントに頼り切らない。** `onNoteChange` は選択中のノートしか通さないので、同期で
 * 降ってきたノートや一括操作はイベントが来ない。`reconcile()` を定期的に呼んで、
 * id と更新日時の突き合わせで埋める。
 */
export class IndexUpdater {
  private queue = new Map<string, 'put' | 'remove'>();
  private running: Promise<void> | null = null;
  private held = false;
  private changed = 0;
  private error: string | null = null;

  public constructor(
    private index: SearchIndex,
    private source: NoteSource,
    private hooks: UpdaterHooks = {},
  ) {}

  /** ノートの変更を受け取る。すぐには処理せず、直列の処理列に積む。 */
  public noteChanged(id: string, event: number): void {
    this.queue.set(id, event === EVENT_DELETE ? 'remove' : 'put');
    void this.drain();
  }

  /**
   * 全件構築のように索引を占有する処理の間、更新を止める。
   *
   * 止めている間もイベントは積む。止めずに走らせると、全件構築の
   * トランザクションの内側へ単発の更新が紛れ込む。
   */
  public hold(): void {
    this.held = true;
  }

  public release(): void {
    this.held = false;
    void this.drain();
  }

  /** 処理列が空になるまで待つ。 */
  public async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  public state(): UpdateState {
    return { changed: this.changed, error: this.error, pending: this.queue.size };
  }

  /**
   * 索引と実データを突き合わせ、食い違った分だけを入れ直す。
   *
   * 本文は運ばず id と更新日時だけを取るので、全件取得より桁で軽い。
   */
  public async reconcile(): Promise<void> {
    // 全件構築の最中は索引が育っている途中で、突き合わせれば全件が食い違って見える。
    // そこで積むと、構築の直後に同じノートを1件ずつ取り直すことになる。
    if (this.held) return;
    try {
      const stamps = await this.source.stamps();
      const known = await this.index.updatedTimes();
      for (const [id, updatedTime] of stamps) {
        if (known.get(id) !== updatedTime) this.queue.set(id, 'put');
      }
      for (const id of known.keys()) {
        if (!stamps.has(id)) this.queue.set(id, 'remove');
      }
    } catch (error) {
      this.error = messageOf(error);
      return;
    }
    await this.drain();
    await this.idle();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (this.held) return Promise.resolve();
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    while (!this.held && this.queue.size > 0) {
      const [id, action] = this.queue.entries().next().value as [string, 'put' | 'remove'];
      this.queue.delete(id);
      try {
        await this.apply(id, action);
        this.changed++;
        this.error = null;
      } catch (error) {
        // 1件の失敗で処理列を止めない。次の id へ進む。
        this.error = messageOf(error);
      }
    }
  }

  private async apply(id: string, action: 'put' | 'remove'): Promise<void> {
    if (action === 'remove') {
      await this.index.remove(id);
      this.hooks.onRemove?.(id);
      return;
    }
    const note = await this.source.get(id);
    // 取得できないものは消されたものとして扱う。削除イベントが来ない経路がある。
    if (!note) {
      await this.index.remove(id);
      this.hooks.onRemove?.(id);
      return;
    }
    await this.index.put(note);
    this.hooks.onPut?.(note);
  }
}
