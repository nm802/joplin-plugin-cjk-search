---
title: joplin-ngram-search
date: 2026-09-05
type: ToDo
status: open
notion_page_id: 3d2cfcf4-f7df-818c-ba80-ea3016c1d3fc
---

# joplin-ngram-search

Joplin の検索が日本語・日英混在テキストで取りこぼす問題を、独自 n-gram 索引を持つプラグインで解決する。

## 背景・課題

joplin CLI（本物の `@joplin/lib` SearchEngine）で実測し、現行 Joplin の検索が3つの独立した理由で取りこぼすことを確認した。詳細と実測値は `docs/requirements.md` に記録済み。

1. **クエリの文字種だけで検索経路が決まる。** CJK を含めば LIKE 経路、含まなければ FTS 経路。ノート側が日本語かどうかは見ていない
2. **FTS 経路**は FTS4 の `simple` トークナイザが日本語を切れないため、日本語文中の英数語が索引の奥に埋まる。`型番QZ-4700の熱設計` は `型番qz` と `4700の熱設計` の2トークンになり、`QZ-4700` でも `ST` でも引けない
3. **LIKE 経路**はクエリだけを正規化して生の `notes` テーブルに当てるため、全角英数で書かれた本文が全角でも半角でも引けない。加えて markdown 記号と改行が複合語を分断する

「FTS で0件なら LIKE にフォールバック」は不可。FTS が1件でも返した時点で LIKE 側の一致が全部消えるため、部分的に当たるクエリほど大量に取りこぼす。経路の切り替えではなく、**言語非依存の単一経路**に置き換える必要がある。

## 影響箇所

本プラグイン単体で完結する。Joplin 本体は変更しない（upstream PR は別途検討、このリポジトリの対象外）。

参照した本体コード:

- `packages/lib/services/search/SearchEngine.ts` — `determineSearchType_()`, `normalizeText_()`, `processNonFtsSearchResults_()`
- `packages/lib/services/search/queryBuilder.ts:351` — LIKE 対象が生の `notes`
- `packages/lib/JoplinDatabase.ts:882` — `notes_fts` が `fts4(...)` のデフォルトトークナイザ
- `packages/app-desktop/plugins/GotoAnything.tsx:397-415` — 20件上限
- `packages/lib/string-utils.ts` — `scriptType()`, `removeDiacritics()`

## 方針

**正規化は NFKC + casefold。索引は n-gram（既定2-gram）。索引時とクエリ時に同一関数を通す。**

NFKC が観測された全ケース（全角英数・半角カナ・全角スペース・NFD濁点・全角数字・丸数字）を両側で一致させられることは検証済み。

**検索コアとプラグイン外殻を分離する。**

- 検索コア: 正規化・n-gram 生成・索引・クエリ実行。Joplin API 非依存の純 Node + SQLite。ヘッドレスで単体テスト可能
- プラグイン外殻: `joplin.data`、`joplin.require('sqlite3')`、UI、コマンド登録。デスクトップ上でのみ確認可能

この分離で、保護のためのテスト（T-1〜T-13）を Joplin デスクトップ無しに RPi 上で回せる。

## タスク

### フェーズ1: 検索コア（Joplin 非依存・RPi で完結）

- [ ] リポジトリ初期化（TypeScript + jest + sqlite3）
- [ ] 正規化関数 `normalize()` の実装（NFKC + casefold + markdown 除去）
- [ ] n-gram 生成の実装
- [ ] 索引構築・クエリ実行の実装（FTS4 + n-gram 展開）
- [ ] 保護のためのテスト T-1〜T-13 を実装（先に Red を確認してから通す）
- [ ] 改行の扱い（除去 vs 空白畳み）を実データで比較し方式を確定
- [ ] Joplin 同梱 sqlite3 で FTS5 trigram が使えるか確認（使えれば自前展開を廃止できる）

### フェーズ2: 索引サイズ・性能の実測

- [ ] 実ノート約2750件相当のコーパスで索引構築時間と DB サイズを計測
- [ ] `content=""` / position 削減で索引サイズを圧縮できるか検証
- [ ] 検索応答時間を現行 Joplin の LIKE 全表スキャンと比較

### フェーズ3: プラグイン外殻（デスクトップ必須）

- [ ] `generator-joplin` でプラグイン雛形を作成
- [ ] `joplin.data` からのノート全件取得とページング
- [ ] `joplin.require('sqlite3')` で `dataDir()` 配下に索引 DB を作成
- [ ] `onNoteChange()` / `onSyncComplete()` による差分更新
- [ ] 初回索引構築のバックグラウンド実行と進捗表示
- [ ] 検索 UI（インクリメンタル検索・キーボード選択・ジャンプ）
- [ ] IME ガード（`compositionstart` / `compositionend`）
- [ ] コマンド登録と Ctrl+P 再割り当て手順の README 化

### フェーズ4: 検証と配布

- [ ] 変更確認項目（`docs/requirements.md` 6-2）を実機で消化
- [ ] Joplin 本体 DB が変更されないことを確認
- [ ] プラグインリポジトリへの公開を検討

## 検証環境

RPi 上に joplin CLI（本物の `@joplin/lib`）+ 検証用プロファイルを構築済み。Data API がポート 41184 で稼働し、現行 Joplin の挙動をいつでも再測できる。

```
/mnt/hdd/data/tmp/joplin-cli/           joplin CLI 一式
/mnt/hdd/data/tmp/joplin-cli/prof/      検証用プロファイル（テストノート12件・索引構築済み）
```

## 未決事項

- n-gram の n（2 が既定）
- 索引サイズ。RPi 予備計測では本文15M字に対し FTS4 索引 204MB（約13倍）
- 1文字クエリの扱い
- スコア式
- upstream PR を出すか、出すならどの修正から（LIKE 対象を `notes_normalized` に変える修正が最小・最も通しやすい）
