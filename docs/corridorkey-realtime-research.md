# Realtime 1080p Keying for SlopShady — Research & Roadmap (v2)

Goal: **live 1080p keying of people** feedable into SlopShady as a video layer,
in two modes: **chroma** (green/blue screen, CorridorKey-class quality) and
**screenless** (video-call-style salient human matting, no color background).
Hardware: one RTX 5090 (32 GB, Blackwell). Audience: first-time model trainer.

v2 changes (after agent review + new requirements): dual-mode scope, separate
repo (`livekey`), two-tier serving (browser quick-key + 5090 sidecar), screenless
teacher switched from CorridorKey to a license-clean BiRefNet ensemble, new M0
milestone (usable keyer with zero training), VRAM claim corrected, fp8/custom-v2
cut. v1 of this doc is superseded.

v2.1 pivot (after UX discussion): **the keyer is a layer effect that produces
alpha**, not an external video source. SlopShady's compositor already supports
this (`mix(base, layer, alpha)`). Tiers 0–1 (chroma shader, browser ML) live
inside SlopShady; the sidecar survives only as a **matte factory** for hair-grade
quality, shipping a small grayscale alpha stream — video never round-trips.

Verified vs estimated: model facts were read from CorridorKey 2.0 source
(`infer.py`, `foundations.py`, `stage1.py`, `stage2.py`) and the HF model card;
2025–26 SOTA claims were web-verified (BiRefNet, BEN2, MatAnyone, MediaPipe).
Items marked **[estimate]** remain my math, to be confirmed in M1 benchmarks.

---

## 1. TL;DR

- CorridorKey cannot run realtime 1080p by optimization alone: ~8–10 TFLOPs per
  frame (review-confirmed order of magnitude) ⇒ 60 fps needs ~400–600 sustained
  TFLOPs vs a 5090's ~210 dense fp16 peak. **Distillation is the path.**
- **Two modes, two teachers:** chroma mode distills from CorridorKey (nothing
  else does screen-unmixing + FG reconstruction + temporal stability). Screenless
  mode **does not touch CorridorKey at all** — wrong task (its domain is rendered
  chroma screens) and wrong license (would taint the student CC BY-NC-SA). It
  distills from an MIT-licensed BiRefNet + BEN2 ensemble instead.
- **One student family:** RVM-class recurrent conv-GRU nets (proven 104 fps @
  1080p on a 1080 Ti; ONNX/TensorRT-proven; O(1) streaming state; graceful
  720p fallback via `downsample_ratio`). Two checkpoints: `chroma`, `screenless`.
- **The keyer is a LAYER EFFECT (v2.1 pivot):** it produces alpha; SlopShady's
  compositor already does the rest — layers composite as `mix(base, layer, alpha)`
  with per-layer blend modes (verified in `src/js/config/shaders.js`), so a keyed
  layer reveals whatever is below it. Three implementations of the same effect,
  by compute location: **Tier 0** chroma shader (pure WebGL, in SlopShady — needs
  a real green/blue screen, perfect on well-lit screens, free forever);
  **Tier 1** screenless browser model (MediaPipe SelfieSegmenter-class,
  Apache-2.0, Meet-tier, in SlopShady); **Tier 2** hair-grade screenless via the
  `livekey` sidecar on the 5090 — which ships **only a small matte stream**
  (grayscale, e.g. 540p); the layer's video never round-trips.
- **SlopShady gains a small, permissively-licensed key effect** (our GLSL +
  Apache-2.0 model wrapper — no CorridorKey lineage, so no license issue). The
  `livekey` repo stays strictly separate and holds everything
  CorridorKey-lineage plus the Tier-2 engine. Still rejected: cargo features
  that spawn/distribute sidecar binaries.
- **M0 ships usable keying with zero ML training**, in-layer: Tier-0 chroma
  shader + Tier-1 SelfieSegmenter effect in SlopShady; the sidecar (stock RVM
  matte stream) is optional quality headroom, not a prerequisite.

## 2. What CorridorKey 2.0 is (chroma teacher)

```
input RGB (+optional hint)
  ├─ foundations (frozen)                       → features at /64
  │   ├─ C-RADIOv4-SO400M (H/4·W/4 in, patch16, ~400M params)
  │   ├─ MoGe-2 ViT-B (7H/32·7W/32 in, patch14)
  │   └─ DeepMind RVM-MAE (recurrent, "small")
  ├─ stage1 — spatiotemporal transformer        → "baton" d=512 @ /16
  │   ├─ 2× full-spatial attention @ /16 (~8.6K tok/frame @1080p)
  │   ├─ /64 body: 10× FULL spatiotemporal attention over Hann windows
  │   │   (up to 80 frames × ~540 tok = ~43K tokens, quadratic) ← offline killer
  │   ├─ mid /64→/16→/64 Swin detour, U-net skips, 6–8× Swin-3D
  ├─ stage2 — per-frame refinement (no temporal) → α + FG @ full res
  │   └─ 10 blocks d=1280 @ /16, 2 full-spatial, depatchify 16×
```

Facts that matter:

- Trained **entirely on in-house 3D-rendered data** (per the HF model card) —
  strong precedent for our synthetic-composite data strategy.
- VRAM is **not** the constraint (official: 4 GB @1440p, 6 GB @4K; the Hann
  window auto-sizing manages memory fine). The constraint is pure compute
  throughput. *(v1 of this doc wrongly claimed 48 GB cards struggle at 1080p.)*
- `--model_scale` (Lanczos) lets the teacher label at reduced res — ablate once.
- Outputs `alpha`/`fg`/`cutout` as ProRes 4444 / FFV1 `yuva444p16le` — exactly
  the labeled training format we want.
- License (CC BY-NC-SA 4.0 variant) adds: no paid API, no commercial-software
  integration without written agreement, keep the "CorridorKey" name, $20M-org
  seat clause. Teacher *outputs* (labels) used personally are unencumbered;
  anything derived from the model itself inherits its terms.

## 3. Speed math (why realtime teacher is impossible)

Padded 1080p (1920×1152): 8,640 tokens/frame @ /16; 540 @ /64. **[estimates,
order confirmed by review]**

| Component | ~TFLOPs/frame |
|---|---|
| Foundations (C-RADIO ~0.6 + MoGe ~0.1 + RVM) | ~0.8 |
| Stage-1 enc_16 (2× full-spatial @ 8.6K tok) | ~0.7 |
| Stage-1 body_64 @ Hann 80/40, amortized | ~2.5–3.5 |
| Stage-1 Swin stacks + mid detour | ~0.5 |
| Stage-2 (10 blocks d=1280, 2 full-spatial) | ~3.5–4.5 |
| **Total** | **~8–10** ⇒ 60 fps ≈ 400–600 TF sustained |

Even `hann_chunk=1` (forfeiting temporal context) leaves ~5 TF/frame — still
150+ TF for 60 fps. Conclusion stands: **the model itself must shrink.**

Student budget: RVM measured 104 fps HD on a 1080 Ti ⇒ ≤0.1 TF/frame (v1's
"0.2" was ~2× optimistic; headroom conclusion unchanged). A student 3–5×
heavier than RVM still clears 60–100 fps on a 5090 after TensorRT fp16.

## 4. Architecture: the key is a layer effect (three tiers)

UX north star: **the keyer is an effect on a layer.** It computes alpha;
SlopShady's compositor already does the reveal — every layer composites as
`mix(base, layer, alpha)` with per-layer blend modes (verified in
`src/js/config/shaders.js`). Video stays where it already lives in SlopShady
(webcam / video / stream layers); the effect only adds alpha.

```
Tier 0 — chroma shader effect (in SlopShady, pure WebGL)
  Layer fragment shader: color-distance key → alpha + despill + matte/edge
  controls. Needs a real green/blue screen. Perfect on well-lit screens,
  realtime at any resolution forever, zero infrastructure.

Tier 1 — screenless browser model (in SlopShady, WASM/WebGPU)
  MediaPipe SelfieSegmenter-class (Apache-2.0, 256², ~ms-class): runs on the
  layer's video, mask texture multiplies the layer's alpha. Meet-tier quality,
  no screen needed, no sidecar. This is the "video-call app" experience.

Tier 2 — hair-grade screenless / distilled chroma (livekey sidecar, 5090 box)
  Stock RVM now, distilled students later. Ships ONLY the matte: a small
  grayscale sub-stream (e.g. 540p H.264 over SRT) that the same layer effect
  samples as its alpha source. The layer's video never round-trips when the
  camera is local to SlopShady. If the camera is attached to the keyer box,
  the sidecar sends packed RGB‖α in one stream instead (perfect sync).
```

Why the sidecar exists at all: CorridorKey-class and hair-grade models cannot
execute in a browser — their compute must live in a separate process on a big
GPU. The sidecar is a **matte factory**, not a video mixer. Matte-only shipping
keeps SlopShady the source of truth for pixels and compositing; only the
decision (alpha) travels.

Why tiers 0–1 weren't the v2.0 default: the project began as "CorridorKey at
realtime," which forced sidecar-first thinking. Corrected — the effect UX is
the product; external compute is an optional quality upgrade.

Tier-2 sync note: a network matte arrives ~2–3 frames behind local video.
Invisible for mostly-static performers; for fast motion use packed RGB‖α
(single stream, guaranteed sync) or accept slight edge lag. Decide from live
tests at M0. **Browser-tier honesty:** in 2026, onnxruntime-web/WebGPU handles
512² matting nets at ~10–25 fps on laptops; 1024² variants OOM; recent
ORT-WebGPU int8 bugs pushed sites to WASM fallbacks. Hair-grade 1080p60 stays
on the sidecar. SlopShady's COOP/COEP headers coexist fine with
getUserMedia/WebGPU.

Why recurrent (RVM-class) students for Tier 2, both modes: O(1) causal state
(beats segmentation→matting cascades, which flicker per-frame, and temporal
transformers, which are overkill here); ONNX/TRT-proven with known gotchas;
720p degradation for weaker GPUs is one parameter.

**Subject handling (human-centric):** salient-person students will swap
subjects mid-set (known RVM failure; MatAnyone's paper is about exactly this).
v1: single/most-salient subject + **re-lock control** — re-initialize the
recurrent state via sidecar hotkey and OSC (SlopShady already speaks OSC,
port 8101). v2 if needed: click-to-assign first-frame target mask
(MatAnyone's paradigm, reimplemented on MIT bases — MatAnyone itself is
non-commercial and may not be distilled from for a permissive release).

## 5. Teachers per mode

| Mode | Teacher | License of teacher | Student weights license |
|---|---|---|---|
| chroma | CorridorKey 2.0 (best-quality label mode; ablate `model_scale` 0.75 once) | CC BY-NC-SA variant | CorridorKey-variant terms (free, NC, name) |
| screenless | **BiRefNet (MIT) + BEN2 (MIT) ensemble** pseudo-labels on real clips; confidence = inter-teacher agreement mask | MIT | **MIT — fully clean** |

Screenless rationale: CorridorKey's no-hint mode still lives in a rendered
chroma-screen domain — wrong function *and* wrong license for this mode. The
MIT ensemble + MIT-licensed datasets (**P3M-10K, VideoMatte240K, PhotoMatte85**)
cover the task: trimap-free salient/portrait matting at SOTA-ish quality
(BiRefNet SwinT-lite ≈ 20ms/frame in TRT fp16; BEN2 94.6M params, strong hair).
Use ensemble *disagreement* as a per-pixel confidence mask to down-weight bad
labels (hair, thin structures) during distillation. Do **not** distill from
MatAnyone/MatAnyone-2 (NTU S-Lab license, non-commercial, actively enforced).

Label post-processing (screenless): BiRefNet/BEN2 are per-frame stills models →
**temporal median filter the pseudo-labels** (e.g. 5-frame window) before
training, or flicker gets baked into the student.

## 6. Students, data, training

Students: RVM mobilev3 (~6.7M) and/or resnet50 (~30M) fine-tunes; one codebase,
two checkpoints. Defer any custom student until stock-quality proves limiting.

**Chroma mode data (two tiers, as v1):**
- Tier A — synthetic composites, effectively infinite: public matte assets on
  procedural green/blue screens (color casts, uneven lighting, spill, noise,
  motion blur, compression, shadows). CorridorKey itself was trained on rendered
  data — precedent.
- Tier B — CorridorKey pseudo-labels on 10–20 h of real green-screen footage
  (halved from v1's 100 h; expand only if metrics demand it — storage drops to
  a few hundred GB).

**Screenless mode data:** VideoMatte240K + P3M-10K + PhotoMatte85 (MIT) +
ensemble-labeled **real webcam footage**. The webcam domain gap (noise, rolling
shutter, low light, compressed conferencing feeds vs film-grade composites) is
the **#1 quality risk for the human-centric use case** — put real webcam clips
in Tier B and add webcam-ish augmentation (gain noise, compression, motion blur).

Losses (both modes): L1(α) + compositional L1 over random backgrounds +
Laplacian pyramid on composite; clip-based training (8–16 frames) with L1 over
clips; optional flow-warp consistency for flicker. Chroma: also supervise FG
(suppression of spill). Screenless: confidence-masked pixel loss from §5.

Training setup (first-timer): PyTorch + torch.compile + bf16 AMP, AdamW cosine,
512² crops batch 8–16, ~100–200K steps, final finetune at 960–1080p tiles;
Weights & Biases tracking. **Week-1 sanity check: overfit ONE 10-s clip to
near-perfection before scaling.** Fine-tuned RVM converges in days on a 5090.

Honest quality target: student ≥ teacher on ~80% of frames, visibly worse on
~5% (wet hair, motion blur, glass). For live VJ use that's a good trade.

## 7. Separate repo (`livekey`) & SlopShady integration

```
livekey/
  serve/    capture → NVDEC → TRT engine → NVENC → SRT sidecar (--mode, --port,
            re-lock hotkey/OSC, engine selection)
  label/    teacher labeling pipelines (chroma: CorridorKey; screenless: BiRefNet
            +BEN2 ensemble + temporal median + confidence masks)
  train/    distillation (RVM fine-tunes, both modes)
  export/   ONNX → TRT engine builds (static downsample_ratio — known gotcha)
  docs/slopshady.md   recipes: srt:// URLs, layer setup, OSC re-lock
```

Weight channels stay **strictly separated**: chroma checkpoints (CorridorKey
license lineage) never mix data/checkpoints with screenless checkpoints (MIT
lineage). Log provenance per checkpoint. This keeps the screenless student
fully permissive regardless of what the chroma student inherits.

**"Build option for SlopShady" = the key effect ships in SlopShady; the sidecar
is a documented companion.** Tiers 0–1 live in SlopShady itself (permissively
licensable — our GLSL + Apache-2.0 weights, no CorridorKey lineage). Tier 2 is
opt-in: run `livekey` on a GPU box, point the layer effect's matte source at
`srt://<keyer-box>:<port>`. Rejected on purpose: a cargo feature that
spawns/connets the sidecar — it couples release cycles and risks SlopShady
distributing/launching NC-SA-lineage code (license forbids commercial
integration without agreement).

**Alpha transport (decide at M0):** with the effect-centric UX the default is
**matte-only** — the sidecar ships a small grayscale alpha stream (540p-class
H.264 over SRT); the layer keeps its own video, nothing round-trips, nothing
double-compresses. Use **packed side-by-side RGB‖α** (2× pixels, ≈3840×1080 at
1080p60 — trivial for NVENC) when the camera is physically attached to the
keyer box or when matte/video sync at fast motion matters. Composite-at-sidecar
(locks the background) is the last resort.

## 8. Eval protocol

- Chroma: SAD / MSE / Grad / Conn on held-out real clips; boundary vs core
  region reported separately.
- Screenless: add **dtSSD** (temporal stability) and the **YouTubeMatte**
  benchmark (32 harmonized clips, from MatAnyone's CVPR'25 paper) — permissive
  to evaluate against.
- Live acceptance: 1080p60 sustained, ≤3 frames end-to-end latency, no visible
  flicker on static subjects over 60 s, subject re-lock < 1 s.

## 9. Milestones

| ID | When | Outcome |
|---|---|---|
| **M0** | wk 1 | **Key effect lands in SlopShady, zero ML training:** Tier-0 chroma shader (green/blue pick, despill, matte/edge controls, tooltips per repo conventions) + Tier-1 SelfieSegmenter screenless mask. Optional: `livekey` sidecar streaming a stock-RVM matte for Tier-2 early validation. Gig-usable day one, in-layer. |
| **M1** | wk 2 | CorridorKey teacher running on 5090; per-stage benchmark table; labeling mode chosen. Matte-source plumbing in the key effect (SRT grayscale stream) if not done at M0. |
| **M2** | wk 3–5 | Chroma student v1: RVM fine-tune, 10–15 h corpus, Tier A/B. One-clip overfit check first. |
| **M3** | wk 6 | TRT fp16 engines, SRT 1080p60, eval suite, ship v1 (both modes; screenless still stock-or-ensemble-labeled RVM). |
| **M4** | only if stock quality insufficient | Screenless student: BiRefNet-ensemble distill into RVM with confidence-masked, median-filtered labels. |

Cut from v1: fp8/torchao teacher levers (hann_chunk + bf16 + batching reaches
labeling throughput), custom student v2, 100 h / 4 TB data tier, cargo-feature
integration.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Webcam domain gap (screenless) — #1 risk | Real webcam footage in Tier B + webcam augmentation |
| Subject swap mid-set | Re-lock (state re-init) hotkey/OSC at M0; click-to-assign only in v2 |
| Teacher label flicker baked into student | Temporal median labels; clip losses; flow-warp consistency |
| Teacher disagreement on hair/thin structures | Ensemble confidence mask in the loss |
| Chroma student plateaus | Expand corpus toward 30–50 h; heavier RVM backbone |
| ORT-WebGPU immaturity (browser tier) | Keep tier 1 to SelfieSegmenter-class models; WASM fallback |
| License contamination | Strict weight-channel separation in `livekey`; provenance log |
| 5090/Blackwell toolchain quirks | torch 2.9+cu128 (repo-pinned); fp16 fallback everywhere |
| Scope creep | M0–M3 are the product; M4 is conditional |

## 11. First actions (when we start building)

1. In SlopShady (this repo): the **key effect** — per-layer material mode or
   post-effect with Tier-0 chroma shader (color pick via eyedropper on the
   layer, tolerance, despill, choke/softness) and alpha out to the existing
   `mix(base, layer, alpha)` compositor. Tooltips for every control.
2. Tier 1 in SlopShady: SelfieSegmenter (tasks-vision, WASM/WebGPU) producing a
   mask texture consumed by the same effect. Confirm fps at 720p/1080p webcam.
3. Create the `livekey` repo; `serve/` skeleton: camera/ffmpeg → stock RVM →
   540p grayscale matte → SRT; point the key effect's matte source at it
   end-to-end. Decide matte-only vs packed RGB‖α from live sync tests.
4. On the 5090: CorridorKey per-stage benchmark table (chroma labeling mode).
