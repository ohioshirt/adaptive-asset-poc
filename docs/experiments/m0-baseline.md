# M0 — Reproducible baseline: 実験ノート

対象: [Issue #2](https://github.com/ohioshirt/adaptive-asset-poc/issues/2)（親: Issue #1 のロードマップ）。計測日は 2026-11-27 (JST)。

## 判定

**M0 の完了条件は満たした。** ローカルの Chrome と Firefox に加え、GitHub Actions の `browser` ジョブが初回実行で通過した（[run 45867810650](https://github.com/ohioshirt/adaptive-asset-poc/actions/runs/45867810650)、コミット `18af984`）。M1 へ進む技術的な障害は見つかっていない。

この判定が含まないものは「検証していないこと」に挙げた。主なものは、人の目と耳による確認、Safari、動画での記録である。CI についてこのノートが記録しているのは初回の 1 回分で、繰り返し実行したときの失敗率は測っていない。

| Issue #2 の完了条件 | 状態 | 根拠 |
|---|---|---|
| tests pass | 満たした | `npm test` 20 件通過（Node 20.19.2 / 22.16.0 / 24.2.0） |
| reproducible trace | 満たした | 同じスクリプトの論理トレースが、tick 間隔の異なる run・音声クロックの run・Chrome と Firefox のすべてで同一 |
| screenshot/video | スクリーンショットのみ | `m0/chrome/` の PNG 3 枚。動画は撮っていない |
| PNG アトラスと実際の WebM 再生の区別 | 満たした | デモは PNG アトラスだけを描画する。WebM は別ページのプローブで実際にデコードして計測した |
| browser/OS と実再生結果の記録 | 満たした（Chrome・Firefox） | 下の「結果」。macOS と Linux の Chrome、macOS の Firefox。Safari は実行できていない |
| CI のブラウザスモークテスト | 満たした | `browser` ジョブが 27 / 27 チェックで通過。secrets と有料推論は使っていない。下の「Chrome（GitHub Actions）」 |

## 何を作ったか

ランタイム（`src/runtime.mjs`）は変更していない。追加したのはアプリケーション層と検証用の道具だけである。

- `demo/session.mjs`: 要求に論理時刻を刻印してトレースを記録する層。スクリプト化した要求は、フレームが遅れて届いても指定の論理時刻ちょうどに適用する。
- `demo/scenario.mjs`: 基準シナリオ。`130:tense,350:friendly,2000:tense,2900:neutral,3000:friendly`、4700 ms で確定。
- `demo/app.mjs`: URL パラメータ（`script` / `until` / `maxFps` / `autostart` / `bg` / `report`）、トレース保存ボタン、`window.__adaptiveAsset`。
- `demo/webm-probe.html`: 同梱の透過 VP9 WebM を `<video>` で再生し、デコード結果を読み戻して PNG アトラスと照合する。ランタイムからは駆動しない。
- `smoke/`: 依存パッケージなしのスモークテスト。静的サーバー、Node 組み込み WebSocket による最小の CDP クライアント、ハーネス。
- `.github/workflows/test.yml`: `runtime` ジョブ（Node 20 / 22）と `browser` ジョブ（ランナー同梱の Chrome）。

## 再現手順

```sh
npm test                                   # Node 20+
npm run test:browser                       # Node 22+ と Chrome。ヘッドレス
SMOKE_HEADLESS=0 SMOKE_OUT=artifacts/browser-smoke/chrome-headed npm run test:browser
SMOKE_BROWSER=firefox SMOKE_REQUIRE_WEBM=1 npm run test:browser
SMOKE_BROWSER=safari npm run test:browser  # 画面ロックを解除し、Safari を前面に出した状態で
SMOKE_BROWSER=manual npm run test:browser  # 表示された URL を任意のブラウザで開く
```

成果物は `artifacts/browser-smoke/<名前>/` に出力される（git 管理外）。このノートが参照する実行分は `docs/experiments/m0/` にコピーしてある。

- `summary.json`: 実行環境、チェックごとの合否、run ごとの計測値、WebM プローブの要約
- `console.log`: ハーネスの標準出力
- `chrome/trace-wall-native.json`, `chrome/trace-wall-4fps.json`: トレース全体（論理部分は同一、再生部分は異なる）
- `chrome/demo-mid-transition.png`, `chrome/demo-final.png`, `chrome/webm-probe.png`: スクリーンショット

## スモークテストが検証すること

1. **論理トレース**: ブラウザが記録した要求・イベント・最終状態が、Node で同じスクリプトから計算した参照リプレイと完全一致する。期待イベント列そのものは `test/session.test.mjs` で `docs/design.md` の意味論から手で導出した値と照合している。
2. **tick 間隔が実際に違ったこと**: `maxFps` 指定の run で tick 間隔の p50 が指定値相当であり、tick 数が native > 10 > 4 の順に減っている。
3. **描画**: 参照トレースに現れる各遷移について、アトラスのフレームが実際に canvas へ描かれた（上限なしの run で 12 枚中 6 枚以上、上限ありの run で 1 枚以上）。Chrome では遷移中と終了時に canvas の画素を読み戻し、アプリが選んだアトラスのフレームと照合する。
4. **対話入力**（Chrome のみ）: プリセットボタンを実際にクリックし、記録された要求を Node でリプレイした結果とイベント・最終状態が一致する。
5. **音声クロック**（Chrome のみ）: 実クリックで AudioContext を開始し、音声クロック駆動でも論理トレースが一致する。
6. **WebM の実再生**: 6 本のクリップそれぞれについて、再生が最後まで進むこと、長さが宣言値 600 ms の ±50 ms であること、アルファが保持されていること、各デコードフレームが自分のアトラスに最も近く、期待位置から 1 フレーム以内であること、誤差が上限内であること。

検出力は、作業ツリーのコピーに変異を入れて確認した。WebM を別クリップに入れ替えたもの、逆向きのクリップに入れ替えたもの、静止画 12 枚の動画に差し替えたものは、いずれも WebM のチェックが 6 本とも `content mismatch` で失敗した。遷移フレームを描かないよう `renderFace` を変えたものは描画のチェックが失敗した。

## 結果

基準シナリオの論理イベント列（全 run 共通）:

```
200 face start neutral->concern
800 face end neutral->concern
800 face start concern->smile
1400 face end concern->smile
2000 audio start calm->alert
2000 face start smile->concern
2400 audio end calm->alert
2600 face end smile->concern
3000 face start concern->neutral
3600 face end concern->neutral
3600 face start neutral->smile
4000 audio start alert->calm
4200 face end neutral->smile
4400 audio end alert->calm
```

### Chrome（ヘッドレス）

- ブラウザ: `Chrome/158.0.8127.37`
- 実行環境: darwin 27.0.0 arm64 / Apple M1 Pro 10 コア / 32 GB / Node v24.2.0
- 開始時刻 (UTC): 2026-11-26T15:53:37.144Z
- 結果: PASS（27 / 27 チェック）
- 論理トレース sha256: `396ccb86d5811005b238fb06375a3464733fd4221748a4435b34389517490ee7`（スクリプト実行の全 run で一致: true）
- `canPlayType`: vp9=`probably`, webm=`maybe`
- 最終ポーズの canvas 照合: `smile.png` に対し 2 以上ずれた画素 0、±1 の画素 52、不透明画素 15606、左上アルファ 0
- 遷移中の canvas 照合（8 回）: `neutral_concern:0`, `neutral_concern:0`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`。2 以上ずれた画素の最大 0
- ページ例外・コンソールエラー: 0 件

| run | clock | tick 数 | tick 間隔 p50 ms | p95 ms | 最大 ms | start 遅延 n | start 遅延 p50 ms | 最大 ms | 描画した別個のフレーム数 |
|---|---|---|---|---|---|---|---|---|---|
| wall-native | wall | 283 | 16.7 | 16.7 | 16.8 | 7 | 4 | 4 | 63 |
| wall-10fps | wall | 48 | 100 | 100.1 | 100.1 | 7 | 12 | 12 | 33 |
| wall-4fps | wall | 20 | 250 | 250.1 | 250.1 | 7 | 6 | 206 | 16 |
| audio-native | audio | 290 | 16.7 | 16.8 | 16.8 | 7 | 5 | 8 | 63 |
| visual | wall | 283 | 16.7 | 16.8 | 16.8 | 7 | 12 | 12 | 63 |
| interactive | wall | 151 | 16.7 | 16.7 | 16.8 | 1 | 3 | 3 | 14 |

| clip | 判定 | 長さ s | 提示フレーム | 採取フレーム | アルファ保持 | 内容一致 | index ずれ最大 | 特徴領域の差 最大 | 全体の色差 最大 | アルファ差 最大 |
|---|---|---|---|---|---|---|---|---|---|---|
| neutral_smile | OK | 0.6 | 12 | 11 | true | true | 0 | 1.11 | 0.62 | 0.07 |
| neutral_concern | OK | 0.6 | 12 | 8 | true | true | 0 | 1.14 | 0.63 | 0.07 |
| smile_neutral | OK | 0.6 | 12 | 7 | true | true | 0 | 1.06 | 0.61 | 0.07 |
| smile_concern | OK | 0.6 | 12 | 6 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| concern_neutral | OK | 0.6 | 12 | 7 | true | true | 1 | 1.16 | 0.63 | 0.07 |
| concern_smile | OK | 0.6 | 12 | 7 | true | true | 0 | 1.1 | 0.62 | 0.07 |

### Chrome（ウィンドウ表示、画面ロック中）

- ブラウザ: `Chrome/158.0.8127.37`
- 実行環境: darwin 27.0.0 arm64 / Apple M1 Pro 10 コア / 32 GB / Node v24.2.0
- 開始時刻 (UTC): 2026-11-26T15:54:08.414Z
- 結果: PASS（27 / 27 チェック）
- 論理トレース sha256: `396ccb86d5811005b238fb06375a3464733fd4221748a4435b34389517490ee7`（スクリプト実行の全 run で一致: true）
- `canPlayType`: vp9=`probably`, webm=`maybe`
- 最終ポーズの canvas 照合: `smile.png` に対し 2 以上ずれた画素 0、±1 の画素 52、不透明画素 15606、左上アルファ 0
- 遷移中の canvas 照合（8 回）: `neutral_concern:0`, `neutral_concern:0`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`, `neutral_concern:1`。2 以上ずれた画素の最大 0
- ページ例外・コンソールエラー: 0 件

| run | clock | tick 数 | tick 間隔 p50 ms | p95 ms | 最大 ms | start 遅延 n | start 遅延 p50 ms | 最大 ms | 描画した別個のフレーム数 |
|---|---|---|---|---|---|---|---|---|---|
| wall-native | wall | 564 | 8.3 | 10.2 | 16.8 | 7 | 1 | 7 | 63 |
| wall-10fps | wall | 48 | 100 | 108.1 | 108.6 | 7 | 20 | 97 | 32 |
| wall-4fps | wall | 20 | 250 | 258.6 | 258.6 | 7 | 24 | 214 | 16 |
| audio-native | audio | 580 | 8.3 | 10 | 10.5 | 7 | 5 | 8 | 63 |
| visual | wall | 563 | 8.3 | 9.6 | 33.4 | 7 | 1 | 3 | 63 |
| interactive | wall | 301 | 8.3 | 9.8 | 10.4 | 1 | 5 | 5 | 14 |

| clip | 判定 | 長さ s | 提示フレーム | 採取フレーム | アルファ保持 | 内容一致 | index ずれ最大 | 特徴領域の差 最大 | 全体の色差 最大 | アルファ差 最大 |
|---|---|---|---|---|---|---|---|---|---|---|
| neutral_smile | OK | 0.6 | 12 | 11 | true | true | 0 | 1.11 | 0.62 | 0.07 |
| neutral_concern | OK | 0.6 | 12 | 11 | true | true | 0 | 1.14 | 0.63 | 0.07 |
| smile_neutral | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| smile_concern | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| concern_neutral | OK | 0.6 | 12 | 11 | true | true | 0 | 1.16 | 0.63 | 0.07 |
| concern_smile | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |

### Firefox（ヘッドレス）

- ブラウザ: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:162.0) Gecko/20100101 Firefox/162.0`
- 実行環境: darwin 27.0.0 arm64 / Apple M1 Pro 10 コア / 32 GB / Node v24.2.0
- 開始時刻 (UTC): 2026-11-26T15:54:40.040Z
- 結果: PASS（16 / 16 チェック）
- 論理トレース sha256: `396ccb86d5811005b238fb06375a3464733fd4221748a4435b34389517490ee7`（スクリプト実行の全 run で一致: true）
- `canPlayType`: vp9=`probably`, webm=`maybe`

| run | clock | tick 数 | tick 間隔 p50 ms | p95 ms | 最大 ms | start 遅延 n | start 遅延 p50 ms | 最大 ms | 描画した別個のフレーム数 |
|---|---|---|---|---|---|---|---|---|---|
| wall-native | wall | 559 | 8.3 | 9.5 | 25.1 | 7 | 3 | 6 | 63 |
| wall-10fps | wall | 48 | 100 | 108.6 | 108.7 | 7 | 12 | 44 | 33 |
| wall-4fps | wall | 20 | 250 | 257.7 | 257.7 | 7 | 15 | 206 | 16 |

| clip | 判定 | 長さ s | 提示フレーム | 採取フレーム | アルファ保持 | 内容一致 | index ずれ最大 | 特徴領域の差 最大 | 全体の色差 最大 | アルファ差 最大 |
|---|---|---|---|---|---|---|---|---|---|---|
| neutral_smile | OK | 0.6 | 12 | 12 | true | true | 0 | 1.11 | 0.62 | 0.07 |
| neutral_concern | OK | 0.6 | 12 | 12 | true | true | 0 | 1.14 | 0.63 | 0.07 |
| smile_neutral | OK | 0.6 | 12 | 12 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| smile_concern | OK | 0.6 | 12 | 12 | true | true | 1 | 1.1 | 0.62 | 0.07 |
| concern_neutral | OK | 0.6 | 12 | 12 | true | true | 0 | 1.16 | 0.63 | 0.07 |
| concern_smile | OK | 0.6 | 12 | 12 | true | true | 1 | 1.1 | 0.62 | 0.07 |

### Chrome（GitHub Actions、ヘッドレス）

- 実行: [run 45867810650](https://github.com/ohioshirt/adaptive-asset-poc/actions/runs/45867810650)、コミット `18af984`、ランナーイメージ `ubuntu-24.04` 20261122.23.1。`runtime (20)` と `runtime (22)` のジョブも通過した。
- 証跡: `m0/ci-chrome/summary.json`（ジョブの成果物 `browser-smoke-chrome` からコピー。成果物そのものは 2027-02-24 に失効する）
- ブラウザ: `Chrome/158.0.8127.36`（`--no-sandbox` 付き、ヘッドレス）
- 実行環境: linux 7.0.0-1018-aws x64 / Intel(R) Xeon(R) 6975P-C 4 コア / 15 GB / Node v22.23.5
- 開始時刻 (UTC): 2026-11-26T17:27:10.459Z
- 結果: PASS（27 / 27 チェック）
- 論理トレース sha256: `396ccb86d5811005b238fb06375a3464733fd4221748a4435b34389517490ee7`（スクリプト実行の全 run で一致: true、5 run）
- `canPlayType`: vp9=`probably`, webm=`maybe`
- 最終ポーズの canvas 照合: `smile.png` に対し 2 以上ずれた画素 0、±1 の画素 0、不透明画素 15606、左上アルファ 0
- 遷移中の canvas 照合（8 回）: `neutral_concern:0`, `neutral_concern:0`, `neutral_concern:0`, `neutral_concern:0`, `neutral_concern:3`, `neutral_concern:3`, `neutral_concern:3`, `neutral_concern:3`。2 以上ずれた画素の最大 0
- ページ例外・コンソールエラー: 0 件

| run | clock | tick 数 | tick 間隔 p50 ms | p95 ms | 最大 ms | start 遅延 n | start 遅延 p50 ms | 最大 ms | 描画した別個のフレーム数 |
|---|---|---|---|---|---|---|---|---|---|
| wall-native | wall | 285 | 16.7 | 16.8 | 16.8 | 7 | 5 | 6 | 63 |
| wall-10fps | wall | 48 | 100 | 100.1 | 100.1 | 7 | 20 | 20 | 33 |
| wall-4fps | wall | 20 | 250 | 250.1 | 250.1 | 7 | 6 | 206 | 16 |
| audio-native | audio | 287 | 16.7 | 16.7 | 16.8 | 7 | 9 | 11 | 63 |
| visual | wall | 278 | 16.7 | 16.7 | 100 | 7 | 7 | 7 | 61 |
| interactive | wall | 152 | 16.7 | 16.7 | 16.8 | 1 | 16 | 16 | 14 |

| clip | 判定 | 長さ s | 提示フレーム | 採取フレーム | アルファ保持 | 内容一致 | index ずれ最大 | 特徴領域の差 最大 | 全体の色差 最大 | アルファ差 最大 |
|---|---|---|---|---|---|---|---|---|---|---|
| neutral_smile | OK | 0.6 | 12 | 11 | true | true | 0 | 1.11 | 0.62 | 0.07 |
| neutral_concern | OK | 0.6 | 12 | 11 | true | true | 0 | 1.14 | 0.63 | 0.07 |
| smile_neutral | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| smile_concern | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |
| concern_neutral | OK | 0.6 | 12 | 11 | true | true | 0 | 1.16 | 0.63 | 0.07 |
| concern_smile | OK | 0.6 | 12 | 11 | true | true | 0 | 1.1 | 0.62 | 0.07 |

表の読み方:

- **start 遅延**は、遷移開始イベントの論理時刻から、それを処理した tick の時計までの差である。1 run あたり 7 件しかなく、入力から画面表示までの遅延ではない。Issue #1 が求める p50/p95 の遅延計測には当たらない。
- **提示フレーム**は `requestVideoFrameCallback` が報告した合成済みフレーム数、**採取フレーム**はコールバックで実際に読み戻せた枚数である。コールバックは全フレームに届く保証がない。
- 差の値は 0〜255 の平均絶対差。特徴領域は眉と口を含む矩形で、合成ポーズ間の違いが出る唯一の領域。上限は特徴領域 3、全体の色 3、アルファ 1 で、実測の最大値に余裕を持たせて決めた。知覚品質の指標ではない。

## わかったこと

- **論理トレースの一致は、スクリプト要求を論理時刻に固定したことの帰結である。** ブラウザでの実行が加えた証拠は、同じコードが実エンジン 2 種・時計 2 種で同じ結果を出し、時計が最後まで進んだことまで。見た目は一致しない。4 fps 相当の run では遷移開始の表示が最大で 200 ms 余り遅れ、600 ms の遷移 1 本あたり 2〜3 フレームしか描かれない。
- **`maxFps` は tick の間引きであり、表示のフレームレートを変えるものではない。** 低リフレッシュレートの画面、バックグラウンドタブの抑制、メインスレッドの詰まりは再現していない。
- **安全点ちょうどに刻印した要求は、その時刻にすでに発火条件を満たしていた遷移を上書きしない。** 基準シナリオの 3000 ms で `concern → neutral` が先に始まり、同時刻の `smile` 要求は `neutral` 経由で達成される。当初の手計算はここを誤っており、テストの失敗で気づいた。`docs/design.md` に追記した。
- **対話入力の時刻はアプリケーション層が決める。** デモはクリックハンドラ内で読んだ時計を刻印する。ランタイムは入力時刻の概念を持たない。
- **Chrome と Firefox は透過 VP9 WebM をアルファ付きでデコードした。** Chrome の `requestVideoFrameCallback` はヘッドレスで 12 フレーム中 6〜11 枚しか届かなかった。フレーム単位の同期をこのコールバックに頼る設計は M2 で検証が要る。
- **canvas を一度読み戻すと、Chrome では以後の読み戻し値が ±1 ずれることがある。** 切り分け用の実験で、同じ canvas を 2 回読むとチャンネル値 57 個が 1 だけ違った。画素照合は ±1 を許容している（結果欄の「±1 の画素 52」は、スモークテスト本体で数えた画素数で、別の計測）。
- **音声デバイスのない CI ランナーでも `AudioContext` の時計は進んだ。** `audio-native` の run は `running`・44100 Hz を報告し、4710 ms まで進んで論理トレースが一致した。事前に最も疑っていた失敗要因は起きなかった。
- **Safari は画面ロック中に計測できなかった。** ページと素材の取得までは進んだが、タブが描画されないため結果が返らなかった。

## 検証していないこと

- **CI の安定性。** このノートが記録している GitHub Actions の実行は初回の 1 回分で、繰り返し実行したときの失敗率は測っていない。`--no-sandbox` を外してもランナーで起動できるかは試していない。
- **音。** 誰も音を聞いていない。`AudioContext` が `running` を報告したことと、音声クロックで論理トレースが一致したことしか確認していない。`--disable-audio-output` を付けても同じチェックが通るので、可聴出力やクロスフェードの正しさの証拠にはならない。
- **人の目による確認。** 計測はすべてヘッドレスか画面ロック中に行った。画面を見た人はいない。スクリーンショットは CDP で取得したものである。
- **Safari と WebKit。** 上記のとおり未実行。透過 VP9 を Safari がどう扱うかはこのリポジトリでは未確認。
- **Firefox の音声クロック・スクリーンショット・canvas 画素照合・対話クリック。** Firefox は HTTP 報告だけで駆動しており、これらは Chrome の CDP 経路にしかない。
- **ランタイム駆動の WebM 再生。** プローブは各クリップを単独で頭から再生しただけである。シーク、ループ、連結、遷移イベントとの同期、PNG 静止ポーズへの切り替えの連続性は M2 の対象。
- **デモが正しいフレームを選んでいるか。** canvas の画素照合の相手は、アプリ自身が「描いた」と申告したアトラスのフレームである。遷移の進捗から期待されるフレームを独立に計算して比べてはいない。フレームの選択順を逆にしたコピーでもスモークテストは通る（反証役のサブエージェントが実演）。
- **WebM の局所的な破損。** 全体の色差はフレーム平均なので、特徴領域の外にある小さな破損は検出できない。14×14 画素の矩形を焼き込んだクリップは通過した（同上）。検出できるのはクリップの取り違えと、フレーム全体に及ぶ破損である。
- **知覚品質と自然さ。** 画素差の上限は上記の検出用で、見た目の良し悪しを測っていない。
- **入力から表示までの遅延、フレーム落ち、メモリ。** 計測していない。
- **動画での記録。** スクリーンショットのみ。

## 変更した前提

- `docs/verification.md` の「実ブラウザでは未検証」は、Chrome と Firefox については解消した。同ファイルに追記した。
- `npm run test:browser` は Node 22 以上を要求する（組み込み WebSocket を使うため）。`npm test` は従来どおり Node 20 以上で動く。
- CI のランナーを `ubuntu-latest` から `ubuntu-24.04` に固定した。`ubuntu-latest` は別リリースへ移行中で、同梱ブラウザが予告なく変わるため。イメージ更新による Chrome のバージョン変化は残るので、ジョブで `google-chrome --version` を出力している。

## レビュー

実装後に、批判的レビューと反証の 2 つを別々のサブエージェントに依頼した。どちらも修正要求で、次を反映した。

- Chrome が途中で終了するとハーネスが待ち続ける問題と、起動失敗時にプロセスと一時ディレクトリが残る問題を修正した。
- WebM プローブが内容を判定していなかったため、フレームを内容で同定する判定を加えた。
- 遷移フレームの描画と対話クリックの経路をチェックに加えた。
- 1 ステップの失敗で後続が実行されなくなる構造を改め、失敗を記録して続行するようにした。
- 静的サーバーの配信範囲を `demo/` と `src/` に絞った。

## 残っている確認

いずれも M0 の完了条件には含まれないが、M2 で再生を扱う前に済ませておきたい。

1. CI の `browser` ジョブは通過済み。今後失敗した場合にまず疑う箇所は、WebM 内容照合の位置許容幅（±1 フレーム。ローカルでは上限の 1 に達することがある）と、対話 run の「クリックの刻印が 1500 ms 未満」の 2 つ。
2. 画面ロックを解除した状態で `SMOKE_BROWSER=safari npm run test:browser` を実行し、結果をこのノートに追記する。
3. デモを開いて、音声ありで遷移を目と耳で確認する（`docs/verification.md` の手順）。
