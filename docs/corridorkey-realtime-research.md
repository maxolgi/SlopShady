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
- **Two serving tiers:** (1) *browser quick-key* — MediaPipe SelfieSegmenter
  (Apache-2.0) inside SlopShady's frontend, zero sidecar, Meet-tier quality;
  (2) *quality tier* — the `livekey` sidecar on the 5090 (capture → student TRT
  engine → NVENC → SRT), hair-grade quality, works today over SlopShady's
  existing streaming-input layers.
- **SlopShady integration = convention, not code:** point a streaming-input layer
  at `srt://<keyer-box>:<port>`. No cargo feature that spawns/distributes the
  sidecar (couples release cycles; CorridorKey's license forbids commercial
  software integration without agreement — keep the repos strictly separate).
- **M0 ships a usable screenless keyer with zero ML work** (stock RVM behind the
  sidecar) — validate the whole serving path before training anything.

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

## 4. Architecture: two tiers, two modes

```
Tier 1 — browser quick-key (inside SlopShady, no sidecar)
  MediaPipe SelfieSegmenter (Apache-2.0, 256², ~1.5ms-class)
  → Meet-tier composite for webcam layers; runs on laptops.

Tier 2 — livekey sidecar (separate repo, runs on the 5090 box)
  camera/file → NVDEC → student engine (TRT fp16) → NVENC H.264 → SRT
  modes: --mode chroma | screenless   (two checkpoints, same code)
  → SlopShady streaming-input layer (srt://host:port) — zero SlopShady code
```

Why recurrent (RVM-class) students for Tier 2, both modes: O(1) causal state
(beats segmentation→matting cascades, which flicker per-frame, and temporal
transformers, which are overkill here); ONNX/TRT-proven with known gotchas;
720p degradation for weaker GPUs is one parameter. **Browser-tier honesty:** in
2026, onnxruntime-web/WebGPU handles 512² matting nets at ~10–25 fps on
laptops; 1024² variants OOM; recent ORT-WebGPU int8 bugs pushed sites to WASM
fallbacks. Hair-grade 1080p60 stays on the sidecar. SlopShady's COOP/COEP
headers coexist fine with getUserMedia/WebGPU.

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

**"Build option for SlopShady" = documentation + convention.** v0 (works today):
streaming-input layer → `srt://<keyer-box>:<port>`. Optional later: a static
help page in SlopShady listing keyer recipes + the built-in browser tier.
Rejected on purpose: a cargo feature that spawns/connets the sidecar — it
couples release cycles and risks SlopShady distributing/launching
NC-SA-lineage code (license forbids commercial integration without agreement).

**Alpha transport (decide at M0):** SRT/H.264 carries no alpha. Recommended:
**side-by-side packed RGB‖α frames** (2× pixels, alpha preserved for in-shader
re-compositing — natural fit for SlopShady's layer/shader system, e.g. key over
any background with `iLayerVideo`). Alternative: composite-at-sidecar (locks
background, simplest). Dual streams: wasteful. NVENC H.264 at 1080p60 handles
the doubled width fine (≈3840×1080).

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
| **M0** | wk 1 | `livekey` sidecar serves **stock RVM** (screenless, zero training) over SRT; keyed performer appears as a SlopShady layer. Validate serving + alpha-transport choice. Gig-usable day one. |
| **M1** | wk 2 | CorridorKey teacher running on 5090; per-stage benchmark table; labeling mode chosen. Browser quick-key tier (SelfieSegmenter) wired in SlopShady frontend. |
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

1. Create the `livekey` repo; `serve/` skeleton: ffmpeg capture → stock RVM
   torch → NVENC → SRT; confirm 1080p60 into a SlopShady streaming-input layer.
2. Decide RGB‖α packing vs composite-at-sidecar from real footage tests.
3. On the 5090: CorridorKey Phase-0 benchmarks (per-stage timing table).
4. SlopShady side (this repo): browser quick-key tier + a `docs/` recipe page
   linking `livekey` — the only SlopShady-side work in scope.
