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
		const input = document.getElementById('cjk-search-input');
		const list = document.getElementById('cjk-search-results');
		const status = document.getElementById('cjk-search-status');
		if (!input || !list || !status) return;

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
					void open();
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

		const open = async () => {
			const item = results[selected];
			if (!item) return;
			await webviewApi.postMessage({ type: 'open', noteId: item.id });
			// ノートを開くにはダイアログを閉じる必要がある。ボタンバーの Close を押す。
			const button = document.querySelector('.dialog-modal-layer button, .button-bar button');
			if (button) button.click();
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
				event.preventDefault();
				void open();
			}
		});

		input.focus();
		// 起動直後に索引の状態を出す。無反応に見えないようにするため。
		void run();
	});
})();
