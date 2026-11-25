# ダンおに リングノートエディタ

[Dancing☆Onigiri (CW Edition) ](https://github.com/cwtickle/danoniplus)の **リングノート専用** エディタです。  
SKB氏の [danoni-editor](https://github.com/superkuppabros/danoni-editor) と組み合わせて使うことを想定して、ページなどの仕様やショートカットキーを合わせているほか、譜面を読み込んでリングノートと統合して出力することができます。

## 特徴

- **マウスによるリング配置**: ゲーム画面キャンバス上でクリック配置、ドラッグで位置・半径を調整（重なったリングは `Shift+クリック` で選択切り替え、右クリックで削除）
- **タイムライン**: 通常ノーツを参照表示しながら、リングや速度変化のタイミングを視覚的に編集
- **ページ単位のループ再生**: 現在のページをループ再生しながらリアルタイムに配置・調整可能
- **既存譜面との連携**: `danoni-editor` の出力フッター（`es_*`）からBPMなどの情報を取り込んだり、内容をリングノートと統合して完成譜面として出力できます
- **ドラッグ＆ドロップ対応**: 譜面（`.txt` / `.dos`）、プロジェクト（`.json`）、音源（`.mp3` / `.wav` 等）を画面にドロップして読み込み
- **自動保存**: 作業中のデータはブラウザ（`localStorage`）に自動保存され、セーブデータとしての保存・読込にも対応

## 使い方の流れ

1. **譜面読込**: 通常ノーツと組み合わせる場合は、「譜面読込」ボタンまたはドラッグ＆ドロップで既存譜面を読み込みます。
2. **タイミング確認**: 右ペインで Page / Label / BPM / Blank Frame を確認・設定します。
3. **リング配置**: 中央のキャンバスをクリックしてリングを配置します。左ペインで色・半径・音番号・出現フレームや速度変化を設定できます。
4. **試聴・調整**: タイムラインで位置を確認し、`Enter` キーでループ再生しながらタイミングや配置を調整します。
5. **出力**: 「出力」から `ring_data` スニペット、またはリングデータを埋め込んだ「完成譜面」を取得します。

## ショートカットキー

| キー | 動作 |
| --- | --- |
| `←` / `→` | ページ移動（`Shift` で5ページ移動） |
| `↑` / `↓` | 編集カーソルを分割単位で移動 |
| `Ctrl+↑` / `Ctrl+↓` | 編集カーソル位置のノートをカーソルと一緒に移動 |
| `Space` / `B` | 編集カーソルを前 / 後ろへ |
| `Enter` | ループ再生 / 停止 |
| `1`〜`7` / `Ctrl+1`〜`7` | グリッド切替（4分 / 8分 / 16分 / 12分 / 24分 / 48分 / 32分） |
| `Ctrl+Z` | 元に戻す |
| `Ctrl+Shift+Z` / `Ctrl+Y` | やり直す |
| `Ctrl+D` | 選択リングを複製 |
| `Delete` / `Backspace` | 選択リングを削除（未選択時は編集カーソル位置のリングを削除） |
| `Ctrl+X` | ページカット（現在ページの内容を切り取り） |
| `Ctrl+C` | ページコピー |
| `Ctrl+V` | ページ貼り付け（現在ページへ上書き） |
| `Ctrl+Shift+X` | ページ削除（現在ページを削除し、後続ページを1ページ分詰める） |
| `Ctrl+Shift+V` | ページ挿入（後続ページを1ページ分送る） |
| `Esc` | 選択解除 / ダイアログを閉じる |

## ローカルでの起動・開発

静的サーバで配信するだけで動作します（ビルド不要）。

```bash
node serve.mjs
# または python3 -m http.server 8080
# http://localhost:8080/
```

- サンプルデータ: `sample/sample-project.json`（セーブデータ）、`sample/sample-chart.txt`（譜面）
- 内部仕様やファイル構成などの開発者向け情報は [architecture.md](./architecture.md) を参照してください。

## ライセンス表示

リングのヒット音を本体に合わせるため、[Dancing☆Onigiri (CW Edition) ](https://github.com/cwtickle/danoniplus)のコードを一部流用しています(`js/audio.js`)。  
これらのコードは[MIT License](https://github.com/cwtickle/danoniplus/blob/b265c8514bdde622a87e3c6325938f915d8f6bd0/LICENSE)です。

## 参考リンク

- [サリング（CIRRING）](https://noia.g3.xrea.com/parastoic/crs/)
- [danoniplus Wiki: リングノート](https://github.com/cwtickle/danoniplus/wiki/dos-e0008-ring-note)
- [danoni-editor](https://github.com/superkuppabros/danoni-editor)
