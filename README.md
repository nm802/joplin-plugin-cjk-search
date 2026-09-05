# joplin-plugin-cjk-search

Language-agnostic full-text search for [Joplin](https://joplinapp.org/).

Joplin's built-in search picks its code path from the **query's** script, not the note's. Queries containing CJK characters fall back to a `LIKE '%...%'` scan over the raw note table; everything else goes to an SQLite FTS4 index whose `simple` tokenizer cannot split CJK text. Both paths drop results, and they drop different ones.

This plugin maintains its own bigram index in a separate SQLite file and searches through a single path, regardless of language.

## Status

Requirements and design are fixed; implementation has not started.

- `docs/requirements.md` — requirements, measured evidence, protection tests
- `docs/evernote-research.md` — how Evernote/Lucene solve the same problem, and the resulting design decisions
- `.claude/plans/260905_cjk-search-plan.md` — implementation plan

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

Two analyzers, selectable in settings.

**`cjk` (default)** — the same pipeline as Lucene's `CJKAnalyzer`: split on script boundaries, fold width (NFKC), fold case, form overlapping bigrams over CJK runs, keep Latin words whole. This is a reimplementation, not a port; Lucene itself is Java and unavailable to a Joplin plugin.

**`full-bigram`** — bigrams over every character of the normalized text. Also matches inside Latin words (`PI` finds `API`). Costs about 24% more index space.

Normalization is **NFKC + casefold**, applied identically at index time and query time. Joplin's own `normalizeText_()` normalizes the query but matches it against the un-normalized `notes` table, which is why fullwidth text is currently unreachable.

## Plugin metadata

```
id:   io.github.nm802.cjk-search
name: CJK Search
```

## License

Not yet decided.
