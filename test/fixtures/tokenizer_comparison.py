# -*- coding: utf-8 -*-
"""Joplin FTS4(simple) / Lucene CJKAnalyzer相当 / 素朴bigram の3方式を同一文書で比較"""
import unicodedata as U, sqlite3, re

def is_cjk(ch):
    o = ord(ch)
    return (0x3040 <= o <= 0x30FF or 0x31F0 <= o <= 0x31FF or
            0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF or
            0xF900 <= o <= 0xFAFF or 0xAC00 <= o <= 0xD7AF)

def norm(s):                       # CJKWidthFilter + LowerCaseFilter 相当
    return U.normalize('NFKC', s).casefold()

def lucene_tokens(text):
    """StandardTokenizer(スクリプト境界で分割) → CJKBigramFilter"""
    t = norm(text); out = []; i = 0
    while i < len(t):
        c = t[i]
        if c.isalnum() and not is_cjk(c):          # ラテン/数字は語のまま
            j = i
            while j < len(t) and t[j].isalnum() and not is_cjk(t[j]): j += 1
            out.append(t[i:j]); i = j
        elif is_cjk(c):                            # CJK連続 → 重なりbigram
            j = i
            while j < len(t) and is_cjk(t[j]): j += 1
            run = t[i:j]
            out += [run] if len(run) == 1 else [run[k:k+2] for k in range(len(run)-1)]
            i = j
        else:
            i += 1
    return out

def naive_bigrams(text):
    t = norm(text)
    return [t[i:i+2] for i in range(len(t)-1) if not t[i:i+2].isspace()]

def strip_md(s):
    return re.sub(r'[*_`#>\[\]()~|]+', '', s).replace('\n', '')

DOCS = {
 "d1": "型番メモ 型番QZ-4700の熱設計を検討する",
 "d2": "JoplinのプラグインAPIを調べた",
 "d3": "この機能のＡＰＩは別紙参照",
 "d4": "屋根の**防水**工事を実施した",
 "d5": "屋根の防水\n工事を実施した",
 "d6": "雨漏り　対応を業者へ依頼した",
}
QUERIES = ["QZ-4700","QZ","4700","熱設計","API","ＡＰＩ","防水工事","雨漏り 対応","漏り"]

def build(mode):
    con = sqlite3.connect(":memory:")
    con.execute("CREATE VIRTUAL TABLE t USING fts4(id, tok, tokenize=simple)")
    tk = lucene_tokens if mode=="lucene" else naive_bigrams
    for k, v in DOCS.items():
        con.execute("INSERT INTO t(id,tok) VALUES (?,?)", (k, " ".join(tk(strip_md(v)))))
    return con, tk

for mode in ("lucene","naive"):
    con, tk = build(mode)
    label = "Lucene CJKAnalyzer相当" if mode=="lucene" else "素朴 bigram(全文字)"
    print(f"=== {label} ===")
    if mode=="lucene":
        print(f"  d1のトークン: {tk(DOCS['d1'])}")
        print(f"  d2のトークン: {tk(DOCS['d2'])}")
    for q in QUERIES:
        toks = tk(strip_md(q))
        m = '"' + " ".join(toks) + '"' if len(toks) > 1 else (toks[0] if toks else "")
        try:
            hits = [r[0] for r in con.execute("SELECT id FROM t WHERE t MATCH ?", (f"tok:{m}" if len(toks)<=1 else m,))]
        except Exception as e:
            hits = [f"ERR {e}"]
        print(f"  検索 {q!r:12} -> {hits or '0件'}")
    print()
