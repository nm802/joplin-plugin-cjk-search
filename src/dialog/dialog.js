/* 検索ダイアログの中身。webviewApi 経由でプラグイン本体とやり取りする。 */
(function () {
	// Joplin はプラグインのスクリプトを setHtml の後から script タグで差し込む。
	// その時点で readyState は既に complete なので、DOMContentLoaded を待つと永久に動かない。
	// 本体の UserWebviewIndex.js も同じ理由で docReady を用意している。
	function docReady(fn) {
		if (document.readyState === 'complete' || document.readyState === 'interactive') {
			setTimeout(fn, 1);
		} else {
			document.addEventListener('DOMContentLoaded', fn);
		}
	}

	docReady(function () {
		const form = document.getElementById('cjk-search-form');
		const input = document.getElementById('cjk-search-input');
		const noteIdField = document.getElementById('cjk-search-note-id');
		const list = document.getElementById('cjk-search-results');
		const status = document.getElementById('cjk-search-status');
		if (!form || !input || !noteIdField || !list || !status) return;

		// ダイアログの寸法は「iframe の中で測った実寸」が外へ伝わって決まる（片方向）。
		// 外の窓の大きさは iframe からは見えないので、親が読めるときは親の幅を、
		// 読めないとき（webview 隔離が有効だと同一オリジンでなくなる）は画面の幅を使う。
		const outerSize = () => {
			try {
				if (window.parent && window.parent.innerWidth) {
					return { width: window.parent.innerWidth, height: window.parent.innerHeight };
				}
			} catch (error) {
				/* 隔離時は参照できない。画面の大きさで代用する。 */
			}
			return { width: window.screen.availWidth, height: window.screen.availHeight };
		};

		const applySize = () => {
			const outer = outerSize();
			const width = Math.max(560, Math.min(1100, Math.round(outer.width * 0.6)));
			const height = Math.max(200, Math.min(600, Math.round(outer.height * 0.5)));
			document.getElementById('cjk-search-root').style.width = `${width}px`;
			list.style.maxHeight = `${height}px`;
		};

		let composing = false;
		let selected = 0;
		let results = [];
		let timer = null;
		let seq = 0;

		const render = () => {
			list.innerHTML = '';
			results.forEach((item, i) => {
				const li = document.createElement('li');
				li.className = 'cjk-search-item' + (i === selected ? ' selected' : '');
				const title = document.createElement('div');
				title.className = 'cjk-search-title';
				title.textContent = item.title || '(untitled)';
				li.appendChild(title);
				if (item.snippet) {
					const snippet = document.createElement('div');
					snippet.className = 'cjk-search-snippet';
					snippet.textContent = item.snippet;
					li.appendChild(snippet);
				}
				li.addEventListener('click', () => {
					selected = i;
					submitSelected();
				});
				list.appendChild(li);
			});
			const visible = list.children[selected];
			if (visible) visible.scrollIntoView({ block: 'nearest' });
		};

		const run = async () => {
			const query = input.value;
			const mine = ++seq;
			let response;
			try {
				response = await webviewApi.postMessage({ type: 'search', query });
			} catch (error) {
				status.textContent = 'error: ' + (error && error.message ? error.message : error);
				return;
			}
			// 打鍵が続いている間に古い応答が後から届くことがある。追い越されていたら捨てる。
			if (mine !== seq) return;
			results = (response && response.results) || [];
			selected = 0;
			status.textContent =
				query.trim() === '' ? (response && response.hint) || '' : `${response.total} 件`;
			render();
		};

		const schedule = () => {
			// IME 変換中は走らせない。本体の Goto Anything にはこのガードが無く、
			// 確定前の中間状態ごとに検索が走る。
			if (composing) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(run, 80);
		};

		/** 選択中のノート id をフォームへ載せる。ダイアログはこの値ごと閉じる。 */
		const setSelectedNoteId = () => {
			const item = results[selected];
			noteIdField.value = item ? item.id : '';
			return !!item;
		};

		// プラグインからダイアログを閉じる API は無い。フォームを submit すると
		// Joplin が form-submit を受けて閉じ、そのときフォームの中身が open() の
		// 戻り値に入る。ノート id はその経路で渡す。
		const submitSelected = () => {
			if (!setSelectedNoteId()) return;
			form.requestSubmit();
		};

		input.addEventListener('compositionstart', () => {
			composing = true;
		});
		input.addEventListener('compositionend', () => {
			composing = false;
			schedule();
		});
		input.addEventListener('input', schedule);

		input.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				selected = Math.min(selected + 1, results.length - 1);
				render();
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				selected = Math.max(selected - 1, 0);
				render();
			} else if (event.key === 'Enter') {
				// Joplin 自身が document の keydown で Enter を拾って submit する。
				// ここでは値を載せるだけにして、伝播を止めない。止めると閉じなくなる。
				setSelectedNoteId();
			}
		});

		applySize();
		window.addEventListener('resize', applySize);
		input.focus();
		// 起動直後に索引の状態を出す。無反応に見えないようにするため。
		void run();
	});
})();
