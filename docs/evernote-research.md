# 調査: Evernote の検索アーキテクチャ

「Evernote では検索に違和感がなかった」という体験の裏付けを取り、本プラグインの設計判断の根拠にする。

## 1. 確定している事実

### 1-1. Evernote の検索エンジンは Apache Lucene

Evernote 自身が Lucene/Solr Revolution 2014 で発表した内容（Christian Kohlschütter, Evernote）。

- MySQL の MyISAM FTS から Apache Lucene へ移行した
- **1ユーザーにつき1つの Lucene インデックス**
- 559 シャード（1シャードあたり20万ユーザー）、31億ノート
- Lucene 2.9 → 4.5 へ移行し、ディスク I/O 全体で -81%、キーワード検索で -96%
- 索引圧縮で 1.9 TB を削減

出典: <https://www.slideshare.net/lucidworks/search-architechture-at-evernote-presented-by-christian-kohlschtter-evernote>

**このプレゼンにアナライザ・トークナイザ・CJK の記述は無い。** 検索経路の詳細は非公開。

### 1-2. Evernote の公開検索仕様

出典: <https://dev.evernote.com/doc/articles/search_grammar.php>

- 既定は **AND**（各語にマッチするノートの積集合）。`any:` で OR に切り替わる
- **ワイルドカードは語末のみ。** 「スケーラビリティ上の理由で、語頭・語中には許可しない」と明記
- 大文字小文字を区別しない
- フレーズ検索あり
- 正規化手順: XMLマークアップ除去 → 空白と句読点で語に分割 → 大文字小文字の正規化 → 語列の一致
- 「句読点はクエリと文書を語に分割するために使うが、テキスト一致では無視される」

**CJK・日本語・中国語・韓国語への言及は一切ない。** 公開仕様は空白区切り言語を前提に書かれている。

### 1-3. Lucene の CJK 標準解法

Evernote が具体的に何を使っていたかは非公開だが、Lucene で CJK を扱う標準は `CJKAnalyzer` であり、その構成は公開されている。

出典: <https://lucene.apache.org/core/8_3_1/analyzers-common/org/apache/lucene/analysis/cjk/CJKAnalyzer.html>

```
StandardTokenizer   Unicode のテキスト分割規則で分割（スクリプト境界で切れる）
CJKWidthFilter      全角ASCIIを半角に、半角カタカナを全角カナに畳む
LowerCaseFilter     小文字化
CJKBigramFilter     CJK文字列を重なり2文字に分解
StopFilter          ストップワード除去
```

`CJKBigramFilter` の例として公式ドキュメントが挙げているのは `我是中国人` → `我是－是中－中国－国人`。

## 2. ここから読み取れること

### 2-1. 我々が独立に決めた設計は Lucene の CJKAnalyzer とほぼ同じ

昨日の実測から決めた方針は「NFKC + casefold + 2-gram」だった。Lucene の CJKAnalyzer は「CJKWidthFilter + LowerCaseFilter + CJKBigramFilter」。

- CJKWidthFilter が全角ASCII→半角、半角カナ→全角カナ = **NFKC の幅畳み込みそのもの**
- LowerCaseFilter = casefold
- CJKBigramFilter = 2-gram

同じ問題に同じ答えが出ている。偶然ではなく、これが CJK 全文検索の定石であることを示している。

### 2-2. Evernote で違和感が無かった理由の説明

Joplin の FTS4 `simple` トークナイザとの決定的な差は**スクリプト境界で切るかどうか**。

`simple` トークナイザは区切り文字を「ASCII 英数字以外かつ 0x80 未満」と定義する。日本語文字はすべて 0x80 以上なので区切りにならず、周囲の英数語を飲み込む。

```
Joplin FTS4(simple)  「型番メモ 型番QZ-4700の熱設計を検討する」
  → ['型番メモ', '型番qz', '4700の熱設計を検討する']
     QZ-4700 も QZ も 熱設計 も引けない

Lucene CJKAnalyzer相当  同じ文
  → ['型番','番メ','メモ','型番','qz','4700','の熱','熱設','設計','計を','を検','検討','討す','する']
     QZ-4700 も QZ も 4700 も 熱設計 も引ける
```

### 2-3. Evernote の制約は Evernote の規模に由来する

「ワイルドカードは語末のみ、スケーラビリティ上の理由で」という明記が重要。31億ノート・全ユーザー分の索引を持つ側の制約であって、**個人の2750ノートには当てはまらない**。

Evernote の設計をそのまま写すのではなく、なぜその制約があるのかを見て、自分の規模で正しい選択をする。

## 3. 方式比較の実測

Joplin が落ちる9ケースを、2方式で検証した。

### 3-1. 取りこぼし（両方式とも全ケース通過）

```
                      Joplin実測   Lucene相当   素朴bigram
検索 'QZ-4700'          0件          d1           d1
検索 'ST'               0件          d1           d1
検索 '4700'             m1のみ       d1           d1
検索 '熱設計'            LIKE経由     d1           d1
検索 'API'              0件          d2,d3        d2,d3
検索 'ＡＰＩ'            半角本文のみ  d2,d3        d2,d3
検索 '防水工事'          n5のみ       d4,d5        d4,d5
検索 '雨漏り 対応'       全角落ち     d6           d6
検索 '漏り'             ok           d6           d6
```

recall では差が出ない。差は次の2点に出る。

### 3-2. 索引サイズと応答（500ノート × 約3000字 = 2.2M字、RPi 上）

```
Lucene CJKAnalyzer相当   構築 4.9s   索引 17MB (本文の 7.9倍)
    検索 'QZ-4700'  ->  4.4ms
    検索 'PI'       ->  0件          ← ラテン語の語中一致はできない
    検索 'api'      ->  3.2ms

素朴 bigram(全文字)      構築 3.2s   索引 21MB (本文の 9.5倍)
    検索 'QZ-4700'  -> 11.1ms
    検索 'PI'       -> ヒットする     ← ラテン語も任意部分一致
    検索 'api'      ->  4.2ms
```

素朴 bigram のコストは索引 +24%、検索 +7ms。得るのはラテン語の語中一致。

## 4. 設計判断

### 決定1: n = 2（bigram）

ユーザーの主訴は「ヒットしない」であり、recall を優先する。3-gram は索引が小さくなるが2文字クエリが引けなくなり、日本語では2文字語が多いため損失が大きい。

### 決定2: 素朴 bigram（全文字に適用）を採る

Lucene 方式（スクリプト境界で切り、CJK だけ bigram、ラテン語は語のまま）ではなく、正規化後の全文字に bigram を張る。

理由:

- コストは索引 +24%・検索 +7ms。2750ノート規模では誤差の範囲
- ラテン語の語中一致が得られる。Evernote が語末ワイルドカードに限っているのは31億ノート側の制約であり、こちらには当てはまらない
- 実装が単純で、スクリプト判定のバグが入り込む余地がない

索引サイズが実データで問題になった場合に Lucene 方式へ寄せる余地は残す。切り替えは索引生成関数の差し替えで済むよう分離しておく。

### 決定3: 正規化は NFKC + casefold

Lucene の CJKWidthFilter + LowerCaseFilter と同等以上。NFKC は幅畳み込みに加えて NFD 濁点の合成と丸数字の展開も行うため、観測された全ケースをカバーする。

### 決定4: 索引前に markdown 記号を除去し、改行を畳む

Evernote の公開仕様も「XMLマークアップ除去」を正規化の第一段に置いている。同じ位置づけで markdown を落とす。

## 5. 未解決

- Evernote が実際に CJKAnalyzer を使っていたかは非公開。状況証拠のみ
- 現行 Evernote（Bending Spoons 傘下）はセマンティック検索を導入しており、当時とは別物になっている
- 改行を除去して連結するか空白に畳むかは、誤ヒット率を実データで測って決める
