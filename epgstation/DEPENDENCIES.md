# 依存関係更新（2026-10-18）

EPGStation本体はv2.10.0を維持し、依存関係を `dependencies/` のpackage.json / package-lock.jsonで固定する。
ビルド時の `npm ci` でこれらを使用する。アプリ本体の新しいタグへ変更する際は互換修正も再検証する。

## 更新内容

- Node.js 20 → 22.23.3。
- Axios 1.20.0、Express 4.22.3、body-parser 1.20.8、Multer 2.4.0。
- Mirakurunクライアント4.1.5、Socket.IO 4.8.4とparser 4.2.7。
- TypeORM 0.3.31、SQLite3 6.0.1、file-type 21.3.4、js-yaml 5.5.0、Lodash 4.18.1。
- 間接依存の修正をlockfileへ反映。サーバー側のbrace-expansion・uuid・js-yamlをoverridesで固定。
- Web画面はVue 2.7.16と対応するcompiler、Vue CLI 5.0.9、sass-loader 13.3.3へ更新。
- マルチステージビルドと `npm prune --omit=dev` で開発専用依存とWebビルド用node_modulesを実行イメージから除去。TypeORMのpeer依存として残るTypeScriptなど、本番依存として解決されるパッケージは残る。
- SQLiteは実行イメージと同じDebian/Node環境でソースビルドする。

## 互換修正

`update-dependencies.cjs` が適用する。

- file-typeの `fromFile()` → `fileTypeFromFile()`。Node 22のESMロード対応を利用。
- openapi-frameworkの廃止済み `safeLoad()` → `load()`。
- TypeORMが拒否する空条件DELETEを明示的なDELETEクエリへ変更。MySQLのTRUNCATEによるトランザクションの暗黙コミットを避ける。

## 監査範囲と残存警告

サーバーの本番依存：`npm audit --omit=dev` 50件 → **0件**を検証環境で確認。
Web画面の本番依存：13件 → **3件**（High 1 / Low 2）。

残るパッケージ：

- vue：Vue 2のHTML解析に関するReDoS（Low）。
- vuetify：Vuetify 2のprototype pollution / VDatePicker XSS等（High）。
- vuetify-datetime-picker：Vue 2への依存による警告（Low）。

これらの警告は抑制・除外していない。Vue 2／Vuetify 2の互換更新だけでは解消せず、Vue 3／Vuetify後継版への画面移行と日時入力部品の置換が必要。
ビルド専用の開発依存は別途警告が残る。実行イメージから除去しても、ビルド環境の安全性が保証されるわけではない。
`npm audit` はnpmレジストリの監査であり、OSパッケージやコンテナ全体の脆弱性検査ではない。

「サーバー側0件」を「画面・ビルド環境・OSを含めた全警告0件」と解釈しないこと。

## 再監査

```bash
docker compose exec epgstation npm audit --omit=dev
docker compose exec epgstation sh -c 'cd client && npm audit --omit=dev --package-lock-only'
```

監査データベースは変化するため、上記件数は確認時点の結果。

## 更新後の検証

- Node 22でサーバーコンパイル成功。Web画面はVue CLI 5でlegacy/moduleの両ビルド成功。
- 独立した検証DBで、起動・112チャンネル登録・番組情報更新を確認。
- 30秒の時刻指定録画が終了し、保存TSをMPEG-2映像/AAC音声として解析できた。
- ライブMP4のHTTP 200と映像データ取得を確認。
- 録画ファイルのRange取得はHTTP 206、Content-Typeはvideo/mp2t。
- Multer 2で検証用TSアップロードHTTP 200。
- ストレージ容量API、チャンネルAPI、録画済みAPIはHTTP 200。
- クリーンビルドの開発依存除去後に `npm audit --omit=dev --audit-level=low` が0件で成功。
- 稼働環境へ更新イメージを反映後も、サーバー本番依存0件、ブラウザ側3件を再確認。
- 切り替え後のWeb・チャンネル112件・録画済み2件・ストレージ・Socket.IO APIはHTTP 200。既存データを保持。
- 切り替え後のHLSプレイリストと映像セグメントもHTTP 200、606,488バイトのセグメント取得を確認。
- 検証用コンテナと検証DBは削除済み。既存DBバックアップはGit除外済みの `runtime/db-before-dependency-update.sql` に保存。

時刻指定予約の再起動復元不具合は今回の依存更新の修正対象ではなく、引き続き未解決。
