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

**Joplin 標準の検索は、日本語のノートを取りこぼします。** しかも「遅い」のではなく「出てこない」という形で起こります。実測したところ、原因は3つありました。

**1. 検索の経路がクエリの文字種で分かれています。** `SearchEngine.determineSearchType_()` はクエリに CJK 文字が含まれるかどうかだけを見て、含まれていれば生の `notes` テーブルへの `LIKE '%…%'`、含まれていなければ FTS4 索引へ投げます。**ノート側が日本語かどうかは見ていません。** 同じノート集合に別々の方法で問い合わせるため、結果が一貫しません。

**2. FTS4 の `simple` トークナイザは日本語を切れません。** 区切りと見なすのは「U+0080 未満で英数字でない文字」だけです。日本語の文字はすべて U+0080 以上なので区切りにならず、隣接する英数語ごと1つのトークンに飲み込まれます。

```
"型番メモ 型番QZ-4700の熱設計を検討する"
  -> ['型番メモ', '型番qz', '4700の熱設計を検討する']
```

`熱設計` はトークンの途中にあるため、前方一致でも届きません。同じ型番でも、本文の書き方によって引けたり引けなかったりします。

**3. LIKE 経路はクエリだけを正規化して、本文は生のまま突き合わせています。** クエリには NFC・小文字化がかかるのに、当てる先は正規化済みの `notes_normalized` ではなく生の `notes` です。そのため全角で書かれた本文は、全角で検索しても半角で検索しても引けません。

このプラグインは、**索引時とクエリ時に同じ正規化・同じトークン化を通す1本の経路**に置き換えます。

## どう直したか

- **正規化は NFKC + 小文字化 + かなの畳み込みです。** 全角英数・半角カナ・NFD 濁点・丸数字が揃い、ひらがなとカタカナも1つに畳まれます（`さーばー` で `サーバー` が引けます）
- **トークン化は Lucene の `CJKAnalyzer` と同じ構成です。** スクリプト境界で分割し、CJK は重なり bigram、ラテン語・数字は1語のまま保ちます。全文字を bigram にする案は、`PI` が `API` に当たってしまうため採用していません
- **索引は FTS5 に位置情報つきで作ります。** 2文字以上はフレーズ検索で引きます。bigram の AND では `国産の日産車` が `国産車` で誤ヒットするためです
- **markdown 記号は詰め、改行は語の区切りとして扱います。** `屋根の**防水**工事` は `防水工事` で引けます。一方 `昨日は雨\n傘を買った` は `雨傘` では引けません（存在しない複合語を作らないためです）
- **打鍵中の語は前方一致で引きます。** `mahaakassap` で `mahaakassapa` に当たります。空白を打てばその語は確定したものとして扱われ、完全一致になります
- **索引は変更のあったノートだけを入れ直します。** イベントが届かない経路（同期で降ってきたノート、一括操作など）は、60秒ごとの突き合わせで埋めます

Joplin 本体の DB には書き込みません。ノートの取得は `joplin.data` API 経由のみで、索引は `joplin.plugins.dataDir()` 配下の独立した SQLite ファイルに置きます。

## 導入

Joplin の **ツール → オプション → プラグイン** で `CJK Search` を検索してインストールしてください。

`.jpl` から入れる場合は、リリースの `io.github.nm802.cjk-search.jpl` をダウンロードし、**プラグイン画面の歯車 → ファイルからインストール** を選んで Joplin を再起動します。自分でビルドする場合は次の通りです。

```
npm install
npm run dist        # publish/<id>-<version>.jpl ができます
```

**初回起動時に索引を作ります。** バックグラウンドで進むため UI は止まりません。完了するまでは、その時点までに索引へ入った分が返ります。ダイアログの状態行に、版と索引件数が表示されます。

## 使い方

**`Ctrl+Shift+F`** でダイアログが開きます。Windows の既定キーマップでは未割り当てなので、既存の操作を奪いません。

`Ctrl+P` はあえて変更していません。**本体の Goto Anything がそのまま残るので、同じクエリで結果を並べて比べられます。** 入れ替えたい場合は **ツール → オプション → キーボードショートカット** で変更してください。Joplin は同じキーを2つのコマンドに割り当てられないため、先に `Goto Anything` の割り当てを外す必要があります。

- 半角スペース区切りは AND です。全角スペースでも同じように働きます
- 1文字でも引けます
- 結果は関連度順（タイトル一致 → BM25 → 更新日時）です。表示は50件までで、超えた場合は状態行に `55 件中 50 件を表示` と出ます

## ドキュメント

- `docs/requirements.md` — 要件、現行 Joplin の実測結果、守るべき不変条件
- `docs/evernote-research.md` — Evernote/Lucene が同じ問題をどう解いているか、そこから決めた設計

## 開発

```
npm test               # jest
npm run typecheck
npm run version        # 現在の版を表示
npm run bump patch     # 0.1.1 -> 0.1.2 （minor / major も指定できます）
npm run dist           # ビルドして publish/ へ出力
```

ダイアログの状態行に出る版が、実際に動いている版です。`.jpl` を入れ替えたあと、Joplin がどのビルドを読み込んだかはここで確認できます。

## License

MIT. See `LICENSE`.
