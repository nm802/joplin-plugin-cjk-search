/* 検索ダイアログの中身。webviewApi 経由でプラグイン本体とやり取りする。 */
document.addEventListener('DOMContentLoaded', () => {
	const input = document.getElementById('cjk-search-input');
	const list = document.getElementById('cjk-search-results');
	const status = document.getElementById('cjk-search-status');

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
				open();
			});
			list.appendChild(li);
		});
		const visible = list.children[selected];
		if (visible) visible.scrollIntoView({ block: 'nearest' });
	};

	const run = async () => {
		const query = input.value;
		const mine = ++seq;
		const response = await webviewApi.postMessage({ type: 'search', query });
		// 打鍵が続いている間に古い応答が後から届くことがある。追い越されていたら捨てる。
		if (mine !== seq) return;
		results = response.results;
		selected = 0;
		status.textContent = query.trim() === '' ? '' : `${response.total} 件`;
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
});
