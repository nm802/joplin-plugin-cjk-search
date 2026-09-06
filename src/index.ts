import joplin from 'api';
import { SettingItemType, ToolbarButtonLocation } from 'api/types';
import { SearchIndex } from './core/searchIndex';
import { Sqlite3Db } from './joplin/sqlite3Db';
import { fetchAllNotes } from './joplin/noteSource';
import { snippetFor } from './core/snippet';
import manifest from './manifest.json';

const COMMAND = 'cjkSearch.open';
const DIALOG = 'cjkSearch.dialog';
/** 結果は全件返るが、ダイアログに並べるのはこの件数まで。索引側に上限は設けない。 */
const DISPLAY_LIMIT = 50;

let index: SearchIndex | null = null;
/** 初回構築中でも検索を受け付ける。結果が不完全でも止めない。 */
let indexing = false;

interface NoteMeta {
  id: string;
  title: string;
  body: string;
}

const meta = new Map<string, NoteMeta>();

/** 空クエリのときにダイアログへ出す状態。無反応と索引未完了を見分けられるようにする。 */
function statusHint(): string {
  const version = (manifest as { version: string }).version;
  if (indexing) return `v${version} — indexing… (${meta.size} notes so far)`;
  return `v${version} — ${meta.size} notes indexed`;
}

async function loadNotes() {
  const notes = await fetchAllNotes(joplin.data as never);
  meta.clear();
  for (const note of notes) meta.set(note.id, { id: note.id, title: note.title, body: note.body });
  return notes;
}

async function rebuild(reason: string) {
  if (!index || indexing) return;
  indexing = true;
  try {
    console.info(`CJK Search: ${reason}`);
    const notes = await loadNotes();
    const report = await index.sync(notes);
    console.info(`CJK Search: indexed ${JSON.stringify(report)}`);
  } catch (error) {
    console.error('CJK Search: indexing failed', error);
  } finally {
    indexing = false;
  }
}

joplin.plugins.register({
  onStart: async () => {
    await joplin.settings.registerSection('cjkSearch', {
      label: 'CJK Search',
      iconName: 'fas fa-search',
    });
    await joplin.settings.registerSettings({
      'cjkSearch.rebuildOnStart': {
        section: 'cjkSearch',
        public: true,
        type: SettingItemType.Bool,
        value: false,
        label: 'Rebuild the index from scratch on next start',
        description:
          'Turn this on if search results look stale. It is turned off again automatically.',
      },
    });

    const dataDir = await joplin.plugins.dataDir();
    const dbPath = `${dataDir}/index.sqlite`;
    index = new SearchIndex(await Sqlite3Db.open(joplin.require('sqlite3'), dbPath));
    await index.create();

    const forced = await joplin.settings.value('cjkSearch.rebuildOnStart');
    if (await index.needsRebuild()) {
      const answer = await joplin.views.dialogs.showMessageBox(
        'CJK Search: the index was built by an older version and has to be rebuilt. Rebuild now?',
      );
      // showMessageBox: 0 = OK, 1 = Cancel
      if (answer === 0) await index.reset();
    } else if (forced) {
      await index.reset();
      await joplin.settings.setValue('cjkSearch.rebuildOnStart', false);
    }

    const dialog = await joplin.views.dialogs.create(DIALOG);
    // レイアウトは HTML に直接埋める。別ファイルの CSS に依存させると、読み込みが
    // 間に合わないまま大きさが決まってダイアログが潰れる。
    await joplin.views.dialogs.setHtml(
      dialog,
      `<style>
         /* Joplin はこの要素の大きさを測ってダイアログの寸法を決める（UserWebviewIndex.js）。
            既定はブロック要素なので幅が iframe に合ってしまい、中身をいくら広くしても
            測定値が変わらない。max-content にして中身の幅が伝わるようにする。 */
         #joplin-plugin-content { width: max-content; }
         /* 実寸は dialog.js が外の窓の大きさから決める。ここは読み込み直後の暫定値。 */
         #cjk-search-root { width: 720px; }
         #cjk-search-input { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 15px; }
         #cjk-search-status { font-size: 11px; opacity: 0.6; margin: 6px 2px; min-height: 14px; }
         /* 高さは中身なり。件数が減れば縮み、増えれば上限まで伸びる。 */
         #cjk-search-results { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow-y: auto; }
         .cjk-search-item { padding: 6px 10px; border-radius: 4px; cursor: pointer; }
         .cjk-search-item.selected { background: rgba(128, 160, 255, 0.28); }
         .cjk-search-title { font-size: 14px; }
         .cjk-search-snippet { font-size: 11px; opacity: 0.65; margin-top: 2px;
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
       </style>
       <form id="cjk-search-form" name="cjk">
         <div id="cjk-search-root">
           <input id="cjk-search-input" type="text" autocomplete="off" placeholder="Search notes" />
           <input id="cjk-search-note-id" type="hidden" name="noteId" value="" />
           <div id="cjk-search-status"></div>
           <ul id="cjk-search-results"></ul>
         </div>
       </form>`,
    );
    await joplin.views.dialogs.addScript(dialog, './dialog/dialog.js');
    // ボタンの id には意味がある。Enter による submit は id が ok/yes/confirm/submit の
    // ボタンがあるときだけ、Escape による dismiss は cancel/no/reject があるときだけ働く
    // （UserWebviewDialog.tsx の findSubmitButton / findDismissButton）。
    // 独自の id を付けるとどちらのキーも無反応になる。
    await joplin.views.dialogs.setButtons(dialog, [
      { id: 'ok', title: 'Open' },
      { id: 'cancel', title: 'Close' },
    ]);

    // joplin.views.dialogs には onMessage が無い。ダイアログもパネルと同じ view ハンドルで
    // 動くので、パネル側の onMessage に同じハンドルを渡して受ける。
    await joplin.views.panels.onMessage(dialog, async (message: unknown) => {
      const msg = message as { type: string; query?: string; noteId?: string };
      if (msg.type === 'search') {
        const query = msg.query ?? '';
        if (!index || query.trim() === '') {
          return { results: [], total: 0, hint: statusHint() };
        }
        const ids = await index.search(query);
        const results = ids.slice(0, DISPLAY_LIMIT).map((id) => {
          const note = meta.get(id);
          return {
            id,
            title: note?.title ?? '',
            snippet: snippetFor(note?.body ?? '', query),
          };
        });
        return { results, total: ids.length };
      }
      return { ok: false };
    });

    await joplin.commands.register({
      name: COMMAND,
      label: 'CJK Search',
      iconName: 'fas fa-search',
      execute: async () => {
        const result = await joplin.views.dialogs.open(dialog);
        const noteId = (result?.formData as { cjk?: { noteId?: string } })?.cjk?.noteId;
        if (result?.id === 'ok' && noteId) await joplin.commands.execute('openNote', noteId);
      },
    });

    await joplin.views.menuItems.create('cjkSearchMenuItem', COMMAND, undefined, {
      accelerator: 'Ctrl+Shift+F',
    });
    await joplin.views.toolbarButtons.create(
      'cjkSearchToolbarButton',
      COMMAND,
      ToolbarButtonLocation.NoteToolbar,
    );

    await joplin.workspace.onNoteChange(async () => {
      await rebuild('note changed');
    });
    await joplin.workspace.onSyncComplete(async () => {
      await rebuild('sync completed');
    });

    // UI をブロックしない。初回構築中に検索が呼ばれたら、その時点の索引で引く。
    void rebuild('initial indexing');
  },
});
