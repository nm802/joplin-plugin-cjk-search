# joplin-plugin-cjk-search

Language-agnostic full-text search for [Joplin](https://joplinapp.org/).

Joplin's built-in search picks its code path from the **query's** script, not the note's. Queries containing CJK characters fall back to a `LIKE '%...%'` scan over the raw note table; everything else goes to an SQLite FTS4 index whose `simple` tokenizer cannot split CJK text. Both paths drop results, and they drop different ones.

This plugin maintains its own bigram index in a separate SQLite file and searches through a single path, regardless of language.

## License

MIT. See `LICENSE`.

## Documents

- `docs/requirements.md` — requirements, measured evidence, protection tests
- `docs/evernote-research.md` — how Evernote/Lucene solve the same problem, and the resulting design decisions

## What the built-in search misses

Measured against the real `@joplin/lib` SearchEngine via joplin CLI, with the FTS index fully built.

```
note: 型番メモ 型番QZ-4700の熱設計を検討する
  search "QZ-4700"  -> 0 results
  search "QZ"       -> 0 results
  search "4700"     -> found

note: JoplinのプラグインAPIを調べた
  search "API"      -> 0 results
  search "ＡＰＩ"    -> found        (fullwidth query falls into the LIKE path)

note: この機能のＡＰＩは別紙参照
  search "API"      -> 0 results
  search "ＡＰＩ"    -> 0 results     (fullwidth body is unreachable either way)

note: 屋根の**防水**工事を実施した
  search "防水"      -> found
  search "防水工事"   -> 0 results     (markdown emphasis splits the compound)

note: 雨漏り　対応を業者へ依頼した       (ideographic space U+3000)
  search "雨漏り　対応" -> 0 results
```

The FTS4 `simple` tokenizer treats any character below U+0080 that is not an ASCII alphanumeric as a separator, and everything at or above U+0080 as part of a token. Japanese text is therefore never split, and it swallows adjacent Latin words:

```
"型番メモ 型番QZ-4700の熱設計を検討する"
  -> ['型番メモ', '型番qz', '4700の熱設計を検討する']
```

## Approach

A single analyzer, with the same pipeline as Lucene's `CJKAnalyzer`: split on script
boundaries, fold width (NFKC), fold case, form overlapping bigrams over CJK runs, keep
Latin words whole. This is a reimplementation, not a port; Lucene itself is Java and
unavailable to a Joplin plugin.

Bigramming every character of the normalized text was measured and rejected: `PI` would
match `API`, which costs precision for no recall the CJK path does not already provide.

Tokens are indexed into FTS5 with positions, and queries of two characters or more are
run as phrase queries. An AND of the bigrams would match `国産の日産車` for the query
`国産車`; positions are what make the match exact.

Normalization is **NFKC + casefold**, applied identically at index time and query time. Joplin's own `normalizeText_()` normalizes the query but matches it against the un-normalized `notes` table, which is why fullwidth text is currently unreachable.

## Install

Download `publish/io.github.nm802.cjk-search.jpl` from a release or build it yourself:

```
npm install
npm run dist
```

Then in Joplin: **Tools → Options → Plugins → the gear icon → Install from file**, pick the
`.jpl`, and restart Joplin.

The index is built in the background on first start. Until it finishes, searches return
whatever is indexed so far.

## Versioning

The version shown in the search dialog is the one that is actually running. Use it to
confirm which build Joplin has loaded after replacing the `.jpl`.

```
npm run version        # print the current version
npm run bump patch     # 0.1.1 -> 0.1.2 (also: minor, major)
npm run dist           # builds and writes publish/<id>-<version>.jpl
```

`npm run dist` produces two files: `<id>.jpl` (the name Joplin expects) and
`<id>-<version>.jpl` (a copy that keeps the version in the filename).

## Shortcut

**`Ctrl+Shift+F`** opens this plugin's search dialog. It is unbound in Joplin's default
keymap on Windows, so nothing is taken away.

`Ctrl+P` is deliberately left alone: it still opens Joplin's own Goto Anything, so the two
can be compared side by side on the same query. `Ctrl+Shift+P` is not used because it is
Joplin's command palette.

To swap them, edit **Tools → Options → Keyboard Shortcuts**. Joplin will not let two
commands share an accelerator, so clear `Goto Anything` first.

## Plugin metadata

```
id:   io.github.nm802.cjk-search
name: CJK Search
```
