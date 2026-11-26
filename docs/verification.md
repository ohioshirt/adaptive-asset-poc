# Initial verification

Executed during repository creation (Node 22.16.0, Python 3, Pillow 12.3.0, FFmpeg with libvpx-vp9):

- `npm test`: 9/9 pass (independent safe points, in-flight atomicity, cancellation, validation, replay, event ordering, routing, invalid edges, global clock).
- `node --check demo/app.mjs`: pass.
- All six VP9 clips: ffprobe confirms 600 ms and alpha_mode=1; first decoded frame via libvpx-vp9/alphaextract contains alpha values 0 and 255.
- All six RGBA atlases: exact pixel equality of first and last samples with declared stable PNG poses.
- Both WAV assets: exactly two seconds.
- Browser smoke test attempted using headless Chromium; navigation to localhost was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). UI playback and sound were not verified in a real browser. Run locally and check the manual steps below.

## Manual smoke test

1. `npm run demo`; open http://127.0.0.1:8000/demo/.
2. Start with audio enabled; select tense, then wait for both tracks to reach target. Confirm separate timestamps and hear the tone change.
3. Select friendly during a face transition; confirm the active edge completes and latest target is reached.
4. Switch among three backgrounds; confirm visible transparency and no rectangular background on the character.
5. Reload and use silent mode; repeat transitions.

These tests establish only control-plane and synthetic media properties; natural generated animation, cross-media compatibility, browser/engine decoding portability and sample-accurate audio remain unverified.
