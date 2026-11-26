# Adaptive Asset Runtime — PoC

> Assets are not only data; they are composable, time-aware behaviors with explicit transition contracts.

映像・音響・2D/3Dアニメーション・VFX・照明などの素材を、共通の意味的要求に応答する時間付き状態遷移グラフとして扱う実験。ゲームサウンドの adaptive audio の発想を他メディアに拡張する。rigtext は交換可能な描画バックエンドの候補であり、置換を前提としない。

## Run

Node.js 20+ と Python 3 があれば依存パッケージのインストールは不要。

```sh
npm test
npm run demo
# http://127.0.0.1:8000/demo/
```

「開始」を選び、平静・親しげ・緊張を切り替える。表情は200ms周期の同期点で遷移し、音響は2秒周期のグローバル同期点で遷移する。遷移中に別の要求を出すと、実行中の遷移を完了してから最新の要求に向かう。背景を切り替えても透過キャラクター素材は変更されない。イベントログはランタイムの論理時刻を示す。

## Structure

- `src/runtime.mjs`: deterministic, renderer-independent control plane
- `demo/manifest.mjs`: independent graphs and semantic presets
- `demo/index.html`, `app.mjs`: browser demonstration (Canvas RGBA frames + Web Audio)
- `demo/assets/`: synthetic RGBA PNG atlases, alpha VP9 WebM clips, two original 2-second WAV loops
- `tools/generate_assets.py`: reproducible synthetic media generator (Pillow + FFmpeg/libvpx-vp9)
- `test/`: runtime invariants and replay tests
- `docs/design.md`: contracts, limitations and next experiments
- `AGENTS.md`: guardrails for follow-up agents

## What this demonstrates / what it doesn't

- 同じ要求を独立した媒体が別々の同期点で実行する。
- 共通の遷移契約は媒体の内容・デコーダから分離できる。
- RGBA動画素材を別背景と合成できるデータとして保存できる。デモの描画経路は等価なPNGフレームを使用し、動画デコーダ互換性を証明するものではない。
- 生成AIを用いた自然な人物動画、Godot/rigtext接続、独立レイヤーの身体的整合性、音響のサンプル精度、任意割込み、遷移素材の自動生成と検証は未実装。

See [design notes](docs/design.md) for the falsifiable next experiment.

## Regenerate media (optional)

```sh
python3 -m pip install Pillow
python3 tools/generate_assets.py
```

Generated assets are synthetic and included; no API key, external model, or service is needed. No public license selected yet.
