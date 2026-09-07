# CJK Search

Language-agnostic full-text search for [Joplin](https://joplinapp.org/).

**Joplin's built-in search cannot find some of your notes.** It picks its code path from the *query's* script, not the note's. A query containing CJK characters falls back to a `LIKE '%…%'` scan over the raw note table; anything else goes to an SQLite FTS4 index whose `simple` tokenizer cannot split CJK text. Both paths drop results, and they drop different ones.

```
note: 型番メモ 型番QZ-4700の熱設計を検討する
  search "QZ-4700"  -> 0 results
  search "熱設計"    -> 0 results

note: この機能のＡＰＩは別紙参照        (fullwidth Latin)
  search "API"      -> 0 results
  search "ＡＰＩ"    -> 0 results       unreachable either way
```

This plugin keeps its own bigram index in a separate SQLite file and searches through a single path, whatever the language. Press **`Ctrl+Shift+F`**.

Measured against the real `@joplin/lib` SearchEngine with the FTS index fully built — see `docs/requirements.md` for the full log.

---

## なぜ作ったか

**Joplin 標準の検索は、日本語のノートを取りこぼす。** しかも「遅い」ではなく「出てこない」。実測すると原因は3つあった。

**1. 検索の経路がクエリの文字種で分かれている。** `SearchEngine.determineSearchType_()` はクエリに CJK 文字が含まれるかどうかだけを見て、含まれれば生の `notes` テーブルへの `LIKE '%…%'`、含まれなければ FTS4 索引へ投げる。**ノート側が日本語かどうかは見ていない。** 同じノート集合に別々の方法で問い合わせるので、結果が一貫しない。

**2. FTS4 の `simple` トークナイザは日本語を切れない。** 区切りと見なすのは「U+0080 未満で英数字でない文字」だけで、日本語の文字はすべて U+0080 以上なので区切りにならず、隣の英数語ごと1つのトークンに飲み込む。

```
"型番メモ 型番QZ-4700の熱設計を検討する"
  -> ['型番メモ', '型番qz', '4700の熱設計を検討する']
```

`熱設計` はトークンの途中にあるので、前方一致でも届かない。同じ型番でも本文の書き方で結果が変わる。

**3. LIKE 経路はクエリだけを正規化して、本文は生のまま突き合わせている。** クエリには NFC・小文字化がかかるのに、当てる先は正規化済みの `notes_normalized` ではなく生の `notes`。だから全角で書かれた本文は、全角で検索しても半角で検索しても引けない。

このプラグインは、**索引時とクエリ時に同じ正規化・同じトークン化を通す1本の経路**に置き換える。

## どう直したか

- **正規化は NFKC + 小文字化 + かなの畳み込み。** 全角英数・半角カナ・NFD 濁点・丸数字が揃い、ひらがなとカタカナも1つに畳まれる（`さーばー` で `サーバー` が引ける）
- **トークン化は Lucene の `CJKAnalyzer` と同じ構成。** スクリプト境界で分割し、CJK は重なり bigram、ラテン語・数字は1語のまま。全文字を bigram にする案は `PI` が `API` に当たるため採らない
- **索引は FTS5 に位置情報つき。** 2文字以上はフレーズ検索で引く。bigram の AND では `国産の日産車` が `国産車` で誤ヒットする
- **markdown 記号は詰め、改行は語の区切りにする。** `屋根の**防水**工事` は `防水工事` で引ける。`昨日は雨\n傘を買った` は `雨傘` では引けない（存在しない複合語を作らない）
- **打鍵中の語は前方一致。** `mahaakassap` で `mahaakassapa` に当たる。空白を打てばその語は確定して完全一致になる
- **索引は変更のあったノートだけを入れ直す。** イベントが来ない経路（同期で降ってきたノート、一括操作）は60秒ごとの突き合わせで埋める

Joplin 本体の DB には書き込まない。ノートの取得は `joplin.data` API 経由だけで、索引は `joplin.plugins.dataDir()` 配下の独立した SQLite ファイルに置く。

## 導入

Joplin の **ツール → オプション → プラグイン** で `CJK Search` を検索して導入する。

`.jpl` から入れる場合は、リリースの `io.github.nm802.cjk-search.jpl` を落として **プラグイン画面の歯車 → ファイルからインストール** を選び、Joplin を再起動する。自分でビルドするなら次の通り。

```
npm install
npm run dist        # publish/<id>-<version>.jpl ができる
```

**初回起動時に索引を作る。** バックグラウンドで進み、UI は止まらない。終わるまでは、その時点までに入った分が返る。ダイアログの状態行に版と索引件数が出る。

## 使い方

**`Ctrl+Shift+F`** でダイアログが開く。Windows の既定キーマップでは未割り当てなので、何も奪わない。

`Ctrl+P` はあえて触っていない。**本体の Goto Anything がそのまま残るので、同じクエリで結果を並べて比べられる。** 入れ替えたければ **ツール → オプション → キーボードショートカット** で変更する。Joplin は同じキーを2つのコマンドに割り当てさせないので、先に `Goto Anything` を空にする。

- 半角スペース区切りは AND。全角スペースでも同じ
- 1文字でも引ける
- 結果は関連度順（タイトル一致 → BM25 → 更新日時）。表示は50件までで、超えたときは状態行に `55 件中 50 件を表示` と出る

## ドキュメント

- `docs/requirements.md` — 要件、現行 Joplin の実測結果、守るべき不変条件
- `docs/evernote-research.md` — Evernote/Lucene が同じ問題をどう解いているか、そこから決めた設計

## 開発

```
npm test               # jest
npm run typecheck
npm run version        # 現在の版を表示
npm run bump patch     # 0.1.1 -> 0.1.2 （minor / major も可）
npm run dist           # ビルドして publish/ へ
```

ダイアログの状態行に出る版が、実際に動いている版だ。`.jpl` を入れ替えたあと、Joplin がどのビルドを読んだかはここで確かめる。

## License

MIT. See `LICENSE`.
