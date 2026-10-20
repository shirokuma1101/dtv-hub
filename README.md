# dtv-hub

**時刻指定予約はEPGStation再起動後に録画が始まらない既知の問題があります。** 再起動後は該当予約を作り直してください。
依存更新の内容・監査範囲・残存警告は [epgstation/DEPENDENCIES.md](epgstation/DEPENDENCIES.md) を参照してください。サーバーの本番依存とブラウザ配信コードは別々に監査します。

中央 Ubuntu 録画サーバーの Milestone 1 用プロジェクトです。
既存 `192.168.2.10:40772` Mirakurun → 中央 mirakc → EPGStation → TS 録画を構成します。
登録する仮想チューナーは GR × 2、BS/CS 共用 × 2 です。上流の物理チューナーを固定指定する構成ではなく、上流 Mirakurun が割り当てます。同一多重化チャンネルは共有される場合があります。

中央側の B25 デコードはありません。上流への `decode=1` 要求で解除済み TS を受け取り、mirakc の `decoded: true` を指定します。上流の解除機能が正常であることは実機検証してください。
PX-W3PE4 / Spinel 対応は後続段階です。既存 EDCB は移行検証完了まで維持します。

## Ubuntu での準備

Docker Engine と Compose v2 が導入済みの Ubuntu に、このディレクトリを配置します。
上流への通信はCompose内のTailscale TUN経路を使用します。mirakcと上流API取得コンテナはTailscaleのネットワーク空間を共有します。中央ホスト自体へのTailscale導入は不要です。

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-yaml curl
cp .env.example .env
chmod 600 .env
```

`.env` の DB パスワード2つを別々のランダム値に変更します。特殊文字を含む値はシングルクォートで囲みます。
LANのブラウザから使用する場合、`EPGSTATION_BIND_ADDRESS` を中央 Ubuntu の LAN IP に変更してください。
mirakc は既定で localhost のみ公開し、MariaDB はポートを公開しません。EPGStation は認証なしのため、信頼するLAN内だけで使用します。
ホスト側の公開ポートは EPGStation が `13000`、mirakc API が `13001` です。既存の `.env` がある場合は `EPGSTATION_PORT=13000`、`MIRAKC_PORT=13001` に変更してください。コンテナ内部のポートと上流Mirakurunの `40772` はそのまま使用します。
イメージタグは更新されるため、運用試験後は使用した digest に `MIRAKC_IMAGE` と `MARIADB_IMAGE` を固定してください。

## Windows でのローカル試験

Docker DesktopのLinuxコンテナを使用します。公開先は `http://localhost:13000` と `http://localhost:13001` です。
`.env` にローカル用DBパスワードを設定し、録画先 `./recorded` を作成します。録画試験中はPCをスリープさせないでください。
PythonとPyYAMLが必要です。PyYAMLをプロジェクト内に導入する場合は以下を使用します。

```powershell
py -m pip --isolated install --target runtime/python PyYAML
$env:PYTHONPATH = Join-Path $PWD 'runtime/python'
docker compose up -d tailscale mariadb
docker compose logs --tail=50 tailscale
# 初期ログに表示された認証URLを開き、接続先と同じTailnetへ登録
docker compose build upstream-api
py scripts/configure.py
New-Item -ItemType Directory -Force recorded
docker compose up -d --build
```

Tailscaleの初期ログに認証URLが表示されていれば、そのURLを使用します。期限切れ時は `docker compose exec tailscale tailscale login` で再認証します。

## 1. Compose と MariaDB

```bash
docker compose config --quiet
docker compose up -d mariadb
docker compose ps
docker compose logs --tail=100 mariadb
```

MariaDB が healthy になることを確認します。DB設定は初回初期化時に反映されます。既存DBのパスワード変更にはDB側の変更も必要です。

## 2. 上流接続と mirakc 設定

### Tailscale の接続

`192.168.2.10` は通常のLAN IPなので、接続先側の既存Tailscaleサブネットルーターが、そのIPを含む経路（例: `192.168.2.0/24`）を広告し、管理コンソールで承認済みであることが前提です。
Tailnetのアクセスルールでも、このコンテナのノードから `192.168.2.10:40772` への通信を許可してください。
上流ホスト自身のTailscale IP（100.x.x.x）を直接使う場合は、`MIRAKURUN_HOST` をそのIPに変更できます。

```bash
docker compose up -d tailscale
docker compose exec tailscale tailscale login
```

表示されたURLから自分のTailnetへログインします。必要に応じて管理コンソールで端末を承認してください。初回認証の待ち時間は30分に設定しています。
無人初期登録の場合は、代わりに `.env` の `TS_AUTHKEY` へ非ephemeralの認証キーを設定して起動できます。
認証状態は `tailscale-state` ボリュームへ保存します。端末キーの期限切れ・失効時は再認証が必要です。
Tailscaleはkernel/TUN方式を使用するため、Dockerホストの `/dev/net/tun` と `NET_ADMIN` capabilityが必要です。Docker DesktopではLinuxコンテナを使用します。mirakc公開ポートは共有ネットワークを持つTailscaleサービス側で設定しています。EPGStationからの `mirakc` DNS名はそのネットワークのエイリアスです。
healthcheckはTailnet IPの取得を確認するもので、上流到達性は次のAPIで確認します。

```bash
docker compose exec tailscale tailscale status
docker compose build upstream-api
docker compose run --rm upstream-api
docker compose run --rm upstream-api --fail --silent --show-error --max-time 20 http://192.168.2.10:40772/api/tuners
python3 scripts/configure.py
mkdir -p recorded
docker compose build mirakc
docker compose up -d mirakc
docker compose logs --tail=100 mirakc
curl --fail http://127.0.0.1:13001/api/channels
```

設定生成は上流の `/api/channels` を読むだけで、上流設定を変更しません。
`configure.py` も `upstream-api` コンテナを使うため、ホストから上流に直接到達する必要はありません。
すでに生成済みの設定がある場合も、Tailscale経路を反映するため再生成してmirakcを再起動してください。
Tailscaleを再作成した場合はネットワーク空間を共有するmirakcも再作成してください。`docker compose up -d --force-recreate tailscale mirakc epgstation` でまとめて反映できます。通信断中の録画復旧、複数TS同時録画時の帯域・dropは実機で確認してください。
受信地域固有のチャンネル番号は上流から取得します。生成後に必要なチャンネルだけを残してPoCを小さく始めることもできます。
外部保存した JSON は `python3 scripts/configure.py --channels-file channels.json` で利用できます。
設定を生成し直した後は `docker compose restart mirakc epgstation` で反映します。
チューナー定義は実際の上流 `/api/tuners` と比較してください。既存録画との併用中は上流チューナーを競合利用するため、余裕がある時間帯で試験します。

## 3. EPGStation

```bash
docker compose build epgstation
docker compose up -d epgstation
docker compose logs --tail=100 epgstation
docker compose exec epgstation ffmpeg -version
```

`http://中央UbuntuのLAN-IP:13000` を開きます。localhost公開の場合は中央ホスト自身から `http://localhost:13000` にアクセスします。
EPGStationはDocker DNSの `http://mirakc:40772/` のみを参照します。
FFmpeg / ffprobe をコンテナに含め、TS保存、MP4視聴とHLSライブ視聴を設定しています。ライブHLS・ライブMP4・録画TSのMP4視聴で144p / 240p / 360p / 480p / 720p / 1080pを手動選択できます。既存設定との対応を保つため、先頭は720pです。回線に応じた自動画質切り替えではありません。
設定上の映像ビットレートは順に150 / 300 / 650 / 1200 / 2500 / 5000 kbpsで、音声と配信の付加データ分が別途必要です。入力より高い解像度は拡大変換であり、元映像の細部は増えません。高解像度ほどCPU負荷が増えるため、ホストの性能に応じて選択してください。
HLSは映像と主音声を選択し、`/app/streams` に出力します。録画後の自動エンコードは設定していません。

既存環境で画質設定を反映する場合は、`git pull --ff-only` 後に `sudo python3 scripts/configure.py` で設定を再生成し、録画していない時間に `sudo docker compose restart epgstation` を実行してください。再生成はmirakc側の設定も書き直します。独自編集は事前に退避してください。時刻指定予約がある場合は、既知の復元問題のため再起動後に作り直してください。

## 4. EPG・ライブ・録画の検証

1. `curl --fail http://127.0.0.1:13001/api/services` で受信サービスが取得されることを確認。
2. `curl --fail http://127.0.0.1:13001/api/programs` で番組が取得され、EPGStationの番組表に表示されることを確認。起動直後のEPG収集には時間がかかります。mirakcログで収集ジョブを追跡します。
3. GR / BS / CS を各1つ選び、ライブ視聴を確認。契約サービスは上流側で視聴可能なものを使用。
4. 短い番組の手動予約・時刻予約を作り、開始/終了時刻と `.ts` 保存を確認。
5. `docker compose exec epgstation ffprobe -v error -show_streams /recorded/ファイル名.ts` で映像・音声を確認し、実際に再生して解除済みであることを確認。ffprobeの成功だけでは解除済みを証明できません。
6. GR2局、BS/CS2局を同時録画し、競合・drop・終了後のチューナー解放を上流と中央のログで確認。同一多重化チャンネルだけの試験では物理チューナー数の検証になりません。
7. 録画していない時間に `docker compose restart` を実行し、番組表・予約・録画ファイルが保持されることを確認。Ubuntu再起動後も確認します。Dockerサービス自動起動が必要です。

以上の実機検証がすべて通った時点で Milestone 1 完了です。このプロジェクトの作成だけでは受信・録画の成功を確認できません。

## ストレージ・ログ・ロールバック

### Discord Webhookによる録画通知

`.env` に `DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/…'` を設定すると、録画開始・終了・録画中エラー・録画準備失敗を通知します。空欄なら無効です。URLは認証情報なのでGitへ登録しないでください。
番組名・放送局・開始／終了時刻（JST）・録画IDを表示し、終了時はエラー／ドロップ／スクランブル数を表示します。カウンターが取得できない場合は「不明」となり、正常とは判定しません。終了通知は録画処理の終了を示し、全編録画や映像・音声の品質を保証しません。手動停止も終了通知になる場合があります。

既存Ubuntu環境への反映（録画していない時間に実行）:

```bash
git pull --ff-only
# .envへDISCORD_WEBHOOK_URLを設定
sudo python3 scripts/configure.py
sudo docker compose up -d --build --no-deps epgstation
```

イメージの再ビルドとコンテナの再作成が必要です。再起動だけでは新しい通知スクリプト・環境変数は反映されません。時刻指定予約は既知の復元問題のため反映後に作り直してください。独自の設定編集がある場合は再生成前に退避してください。

通知失敗で録画を停止しません。送信のタイムアウトは1回10秒、一時的なHTTPエラーは最大1回再試行します。永続キューはなく、通信断やプロセス停止時の通知は失われる場合があります。再試行により重複する場合もあります。通知フックの終了コードは `/app/logs/Operator/system.log` などに記録されます。カウンターの取得可否は上流の対応状況によります。

開発用テストは `node --test epgstation/notify.test.cjs`。ローカルのモック受信先だけを使用し、実際のDiscordへは送信しません。

### Nginx Proxy Manager 経由のリモート視聴

ローカル試験PCは `192.168.1.44:13000`、NPMは `192.168.1.10` を使用します。
このPCの `.env` は `EPGSTATION_BIND_ADDRESS=192.168.1.44` に設定しています。localhostへの公開ではないため、直接開く際も `http://192.168.1.44:13000` を使用してください。
NPMのProxy HostはScheme `http`、Forward Hostname/IP `192.168.1.44`、Forward Port `13000`、Websockets SupportをONに設定します。
ドメイン名とTLS証明書は既存NPM環境に合わせて設定してください。外出先端末にはTailscale経由でNPMへ到達する経路と、そのドメインの名前解決が必要です。
NPMから接続できない場合はWindows Firewallの受信許可を確認し、必要な場合は送信元 `192.168.1.10` のTCP 13000だけを許可してください。
NPM側の設定と外出先端末での実再生は未確認です。

録画は既定で `./recorded` に保存し、DB・EPGキャッシュ・サムネイル・ログはDockerボリュームに永続化します。
TrueNAS導入時はホストにNFS等をマウントし、`RECORDING_DIRECTORY=/mnt/recorded` に変更します。
起動前に `mountpoint /mnt/recorded` と書き込みを確認してください。マウント消失時のローカルディスクへの誤保存を防ぐため、本番化前にsystemdでマウント依存を設定してください。

```bash
docker compose logs --tail=200 mirakc
docker compose logs --tail=200 epgstation
docker compose logs --tail=200 mariadb
docker compose logs --tail=200 tailscale
docker compose stop epgstation mirakc
```

問題発生時は中央のEPGStation/mirakcを停止し、EDCB側の予約を再有効化します。二重録画を避けるため予約単位で切り替えます。
`docker compose down` はボリュームを保持します。`down -v` はDB等を削除するため使用しないでください。
バックアップには録画領域とMariaDBの論理バックアップ、`.env`、生成済み設定を含めます。

## 参照

2026-10-18時点で2局同時録画とライブ配信を確認済みですが、長時間安定性・Ubuntu本番ホスト・外出先実機での検証は未完了です。依存更新後の検証は [epgstation/DEPENDENCIES.md](epgstation/DEPENDENCIES.md) を参照してください。

- [mirakc公式設定（上流HTTPチューナー、decoded）](https://github.com/mirakc/mirakc/blob/main/docs/config.md)
- [Tailscale Docker公式設定（SOCKS5・認証・状態永続化）](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Tailscaleサブネットルーター](https://tailscale.com/docs/features/subnet-routers)
- [EPGStation公式設定テンプレート](https://github.com/l3tnun/EPGStation/blob/master/config/config.yml.template)
