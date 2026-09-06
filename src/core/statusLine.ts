/**
 * ダイアログの状態行に出す1行を組み立てる。
 *
 * webview 側（dialog.js）で組み立てていたが、あちらは jest から触れない。
 * 文字列の決め方はここに置き、dialog.js は受け取った文字列を出すだけにする。
 */

export interface StatusInput {
  /** 一致した総数。クエリが空のときは undefined。 */
  total?: number;
  /** 実際に画面へ並べた件数。 */
  shown?: number;
  /** 索引を構築中か。 */
  indexing?: boolean;
  /** 索引に入っているノート数。 */
  indexedCount?: number;
  /** プラグインの版。 */
  version?: string;
  /** 直近の索引更新で出た例外のメッセージ。無ければ undefined。 */
  lastError?: string;
}

export function statusLine(input: StatusInput): string {
  const { total, shown, indexing, indexedCount, version, lastError } = input;

  if (total === undefined) {
    const head = indexing
      ? `v${version} — indexing… (${indexedCount} notes so far)`
      : `v${version} — ${indexedCount} notes indexed`;
    // 更新が止まっていることは、検索できてしまう分だけ気づけない。必ず添える。
    return lastError ? `${head} — last update failed: ${lastError}` : head;
  }

  // 上限で切ったことを出す。件数だけだと「無い」と区別が付かない。
  return (shown ?? total) < total ? `${total} 件中 ${shown} 件を表示` : `${total} 件`;
}
