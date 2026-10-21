# CorridorKey 2.0 → Realtime 1080p: Research & Roadmap

Goal: green/blue-screen keying at **1080p60** quality comparable to CorridorKey 2.0,
running live, feedable into SlopShady. Hardware: one RTX 5090 (32 GB, Blackwell).
Audience: first-time model trainer (this doc doubles as the learning curriculum).

Sources: CorridorKey 2.0 source (`infer.py`, `foundations.py`, `stage1.py`, `stage2.py`
read directly from the repo), its README/VRAM tables, RVM paper/repo, ONNX/TRT
community ports. Items marked **[estimate]** are my math, to be verified in Phase 0.

---

## 1. TL;DR

- **Pure inference optimization of CorridorKey cannot reach realtime 1080p. Ever.**
  The model needs roughly **8–10 TFLOPs per 1080p frame** **[estimate, see §3]**;
  60 fps means ~500 sustained TFLOPs — 3–5× beyond a 5090 even at perfect
  utilization, and the real bottleneck (offline Hann-window batching, quadratic
  spatiotemporal attention, memory churn) is worse than the FLOP math suggests.
- **Distillation closes the gap.** Train a small *student* network to reproduce the
  *outputs* of CorridorKey (the *teacher*). The student never runs the three
  foundation models (C-RADIOv4-SO400M, MoGe-2, DeepMind RVM-MAE) or the Hann
  windows — it learns to imitate their combined behavior from RGB frames alone.
- **The "100×" decomposes cleanly** into ~20–40× from architecture (distill into a
  RVM-class recurrent student: proven 104 fps at 1080p on a *1080 Ti*) × ~3–5× from
  inference tech (fp16/fp8, TensorRT/torch.compile, CUDA graphs, decode/encode
  pipelining). Product: **60–200×**. That's the whole trick.
- **SlopShady integration needs zero SlopShady code for v0**: SlopShady already
  ingests live SRT/WebTransport video via its streaming-input layers (QuicSRT).
  The keyer runs as a sidecar on the 5090 box and streams the keyed feed to it.
- Timeline for a motivated beginner: **~4–8 weeks part-time** to student v1
  (fine-tuned RobustVideoMatting), longer for a custom student with better quality.

---

## 2. What CorridorKey 2.0 actually is (from source)

```
input RGB (+optional hint)
  ├─ foundations.py (frozen)                    → per-frame features at /64
  │   ├─ C-RADIOv4-SO400M   (input H/4·W/4, patch16, ~400M params)
  │   ├─ MoGe-2 ViT-B       (input 7H/32·7W/32, patch14)
  │   └─ DeepMind RVM MAE   (recurrent feature extractor, "small")
  ├─ stage1.py — spatiotemporal transformer     → "baton" d=512 at /16
  │   ├─ patchify RGB+hint → d=512 at /16 (~8.6K tokens/frame @1080p)
  │   ├─ 2× full-spatial attention at /16
  │   ├─ downsample → /64, concat VFM feats → d=1536
  │   ├─ 10× FULL spatiotemporal attention  ← the offline killer
  │   ├─ mid detour /64→/16→/64 (Swin blocks)
  │   ├─ upsample → /16, U-net skips, 6–8× Swin-3D (full-T windows)
  │   └─ run over overlapping Hann windows (up to 80 frames!)
  └─ stage2.py — per-frame refinement           → alpha + FG at full res
      ├─ patchify RGB 768d + baton 512d = 1280d at /16
      ├─ 10 blocks: 2× full-spatial (8.6K tokens) + Swin/CSwin
      ├─ late zero-init pixel skip (patchify_2 + gate)
      └─ depatchify 16× → (α, RGB); optional /4 ConvNeXt refine head
```

Facts that matter for us:

- Stage 1's `/64` body attends across **all frames of a Hann window jointly**
  (80 frames × ~540 tokens = ~43K tokens, quadratic attention ×10 blocks).
  That's why 48 GB cards are busy at 1080p. This is a *batch* design; it is
  fundamentally at odds with per-frame streaming. (`recurrent_64_sites` hints a
  recurrent memory option exists, but shipped configs don't rely on it.)
- Stage 2 has **no temporal mixing** — everything temporal lives in stage 1.
- The runtime has a `--model_scale` Lanczos hook: run the whole teacher at e.g.
  0.75× or 0.5× resolution. Untested quality tradeoff — ablate in Phase 0.
- Outputs we need for labels: `alpha` and `fg` (or `cutout`), writable as
  ProRes 4444 (`yuva444p12le`) — i.e., the teacher already emits exactly the
  lossless-with-alpha training format we want.

## 3. The speed math (why realtime teacher is impossible)

Padded 1080p (1920×1152, shape quantum 128): **8,640 tokens/frame at /16**,
540 at /64. Per-frame cost, big-ticket items **[estimates — verify Phase 0]**:

| Component | ~TFLOPs/frame | Notes |
|---|---|---|
| Foundations (C-RADIO ~0.6 + MoGe ~0.1 + RVM) | ~0.8 | per-frame, no temporals |
| Stage-1 enc_16 (2× full-spatial @ 8.6K tok) | ~0.7 | |
| Stage-1 body_64 @ Hann 80/40, amortized | ~2.5–3.5 | 43K-token full attention ×10 |
| Stage-1 Swin stacks + mid detour | ~0.5 | windowed, cheap |
| Stage-2 (10 blocks, d=1280, 2 full-spatial) | ~3.5–4.5 | |
| **Total** | **~8–10** | ⇒ 60 fps needs ~500 sustained TFLOPs |

A 5090 peaks around ~100–200 fp16/bf16 tensor TFLOPs; sustained real-world
utilization on attention-heavy models is far lower. With `hann_chunk=1` the
body_64 cost collapses (~5 TFLOPs/frame total) — still ≥150 TFLOPs for 60 fps,
*and* you'd forfeit the temporal model that makes CorridorKey good.
**Conclusion: no retraining-free path exists. The model itself must shrink.**

Student budget, for contrast: RVM (mobilev3) does 1080p at 104 fps on a 1080 Ti
(~0.2 TFLOPs/frame). On a 5090 that class of model has ~10× headroom — we can
afford a student 3–5× heavier than RVM if it buys quality, and still hit
60–100 fps after TensorRT.

## 4. Phase 0 — Reproduce & measure (weekend 1)

On the 5090 box (Blackwell needs torch ≥ 2.7 cu128; the repo pins 2.9.1 — good):

```bash
git clone https://github.com/nikopueringer/CorridorKey2.0 && cd CorridorKey2.0
python -m venv venv && source venv/bin/activate
pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
python scripts/download_weights.py            # ~5 GB teacher + foundations
```

1. Run a 1080p test clip end-to-end (`infer.py --input t.mp4 --output_dir out`).
2. **Profile per-stage** (wrap each in `torch.cuda.Event` timing or use
   `torch.profiler`): foundations vs stage1 vs stage2, at `hann_chunk`
   80/40, 8/4, 1/1, and `model_scale` 1.0 / 0.75 / 0.5. Fill in the §3 table
   with real numbers — every later decision hangs on this.
3. Record quality of each config on 2–3 clips (screenshots of alpha edges) —
   this tells us the cheapest acceptable **labeling mode**.

Deliverable: a one-page benchmark table (mode → fps, VRAM, quality).

## 5. Phase 1 — Make the teacher fast *enough to label data* (not realtime)

Same work doubles as the labeling engine. Realistic gains, stacked:

| Lever | Expected gain **[est.]** | Notes |
|---|---|---|
| `hann_chunk` 8/4 or 4/2 for labeling | 2–4× | per-window attention collapses |
| `model_scale 0.75` (ablate first) | ~1.7× | teacher upsamples labels back to source res — check edges |
| bf16 → **fp8** inference (torchao, or TRT-fp8 on Blackwell) | 1.3–2× | attention layers are the win |
| `torch.compile` + CUDA graphs + channels_last | 1.2–1.5× | kills the pervasive `.permute().contiguous()` churn |
| Batch clips / multiple CUDA streams | 1.5–2× throughput | labeling is offline; throughput > latency |

Even a conservative **5–10× total** takes the teacher from ~1–2 fps to ~10–20 fps
labeling throughput ⇒ a 100-hour corpus (360K frames) labels in **5–10
GPU-hours**. That's an overnight job, not a bottleneck. Do not spend more than
a week here; realtime-serving polish belongs to the student, not the teacher.

## 6. Phase 2 — Distillation (the actual 100×)

### 6.1 Architecture: replace bidirectional attention with causality

The core move: CorridorKey's quality = *semantic + geometric + temporal* context,
delivered by huge offline attention. A **recurrent** student delivers temporal
context with O(1) state — that's exactly how RVM is realtime. The student learns
to reproduce teacher behavior causally from RGB alone.

**Student v1 (recommended start): fine-tune PeterL1n/RobustVideoMatting**
- ~6.7M params (mobilev3) / ~30M (resnet50), recurrent, trimap-free.
- Official ONNX/TensorRT exports already exist (community-verified ONNX→TRT path).
- Fine-tuning a pretrained matter on teacher labels is a *dramatically* easier
  first project than training from scratch — days, not weeks, to first result.
- It will not match the teacher; expect it to close maybe half the quality gap
  vs stock RVM on green-screen-specific failure modes (spill, hair, glass).

**Student v2 (if v1 quality caps out): custom small recurrent net**
- Encoder: MobileNetV3-Small/Large or EfficientNet-B0 to /8–/16.
- Temporal: 1–2 conv-GRU cells in the decoder (RVM pattern) or a tiny causal
  transformer at /32.
- Decoder: light FPN + pixel-shuffle to (α, FG). Target 30–80M params,
  ≤0.8 TFLOPs/frame @1080p ⇒ 60+ fps on 5090 after TRT fp16.
- Train from scratch OR warm-start from RVM weights where shapes allow.

### 6.2 Data engine (two tiers)

**Tier A — synthetic composites, effectively infinite, perfectly labeled.**
Take any existing alpha-matte assets and composite onto procedural screens:
- Matte sources: RVM's VideoMattes (CC-BY 4.0), Distinctions-646, PPM-100,
  PhotoMatte85K (check each license; personal VJ use is safe).
- Screen simulation: green/blue/magenta/cyan casts, radial + gradient lighting
  unevenness, spill on subject edges (alpha-weighted bleed), noise, motion blur,
  slight defocus, shadows, H.264 re-compression artifacts, camera shake.
- This teaches the *task* with zero teacher cost and infinite domain coverage.

**Tier B — teacher pseudo-labels on real footage (the quality carrier).**
- Curate 50–150 h: real green/blue screen clips (stock sites, CC YouTube,
  Corridor's own BTS footage), plus hard cases — wrinkle screens, spill-heavy,
  semi-transparent fabric, hair, fast motion.
- Run Phase-1 labeling engine (`--outputs alpha fg`, ProRes 4444, or FFV1
  `yuva444p16le` for ~lossless at lower bitrate). **Always run the teacher at
  its best quality mode** — student quality is capped by label quality.
- Blend Tier A and B roughly 50/50 early; shift toward B for final epochs.

Storage math: 100 h ≈ source H.264 (~8 Mbps) + alpha FFV1 (~80–150 Mbps)
≈ **~2 TB** — get a 4 TB SSD for the 5090 box.

### 6.3 Losses

- `L1(α, α̂)` + **compositional loss**: `L1(α·F over random bg, α̂·F̂ over same bg)`
  (mimics RVM training; directly optimizes what you see).
- **Laplacian pyramid loss** on the composited image — edge quality without
  trimaps.
- Temporal: run student on 8–16-frame clips; L1 over clip + optional flow-warp
  consistency penalty (Raft-small optical flow) to suppress flicker.
- No hint conditioning — train the hint-free mode.

### 6.4 Training setup (first-timer notes)

- Plain **PyTorch + torch.compile + bf16 AMP**, AdamW, cosine schedule.
- Crops: 512² random crops of 1080p frames, batch 8–16 (fits 32 GB easily),
  ~100–200K steps; final finetune at 960²–1080p tiles for edge sharpness.
- **Week-1 sanity check that saves weeks**: overfit the student on ONE 10-second
  clip until near-perfect. If it can't memorize one clip, something's broken —
  fix before scaling. (This is the single most important beginner habit.)
- Track with Weights & Biases (free). Eval: SAD / MSE / Grad / Conn on a held-out
  real-clip set + side-by-side alpha viewer vs stock RVM vs teacher.
- Fine-tuning RVM: freeze nothing, LR ~1e-4 → 1e-5, expect first credible
  results in a couple of evenings on the 5090.

### 6.5 Honest quality expectations

Distillation closes most of the gap on *common* cases; the teacher's advantage
persists on brutal edges (wet hair against bright green, motion blur, glass).
Target: "student ≥ teacher on 80% of frames, visibly worse on 5%" — for live
VJ use that's a great trade. Measure it, don't guess it.

## 7. Phase 3 — Serving + SlopShady integration

Pipeline on the 5090 box:

```
camera/file → NVDEC decode → student (TensorRT fp16/fp8, CUDA graphs)
           → α·RGB composite (or α+FG) → NVENC H.264 → SRT out
```

- Export student ONNX → TensorRT engine (`trtexec --fp16`; try `--fp8` —
  Blackwell supports it; fall back if alpha banding appears). For RVM keep
  `downsample_ratio` static (known ONNX→TRT gotcha, issue #219).
- Budget @1080p60 **[est.]**: decode ~1ms + student 5–10ms + encode ~1ms
  ⇒ ~2–3 frame end-to-end latency. Fine for VJ.
- **SlopShady v0 needs nothing new**: its streaming-input layers already
  ingest SRT/WebTransport (QuicSRT). Point one at `srt://<5090-box>:<port>`
  and the keyed subject is a live layer, mixable with shaders (`iLayerVideo`
  / `iVideo` uniforms), scanimate, etc.
- Later (optional): a small "ML keyer" panel in SlopShady to spawn/configure
  the sidecar and set despill/color parameters client-side.

## 8. License notes (read before publishing anything)

- CorridorKey code+weights: CC BY-NC-SA 4.0 variant. "Build on the code and
  model" ⇒ a distilled student is *arguably a derivative of the model's
  behavior*; the safe posture is to release student weights under the same
  terms (free, non-commercial, "CorridorKey-distill" naming). Personal/live
  use: unambiguous. Selling it or a hosted API: prohibited.
- SlopShady stays AGPL and merely *consumes a video stream* — no CorridorKey
  code or weights in this repo, so the licenses never mix. Keep it that way.
- Foundation models have their own terms (NVIDIA Open Model License, MIT,
  Apache-2/CC-BY) — irrelevant once the student is trained, but relevant while
  the teacher runs.

## 9. Risk register

| Risk | Mitigation |
|---|---|
| Teacher labels too slow to scale | Phase 1 levers; start with 10 h corpus, expand after |
| Student plateaus below usable quality | Two-tier data; v2 custom student; hybrid: student + classic despill/chroma assist |
| Temporal flicker in student | Clip-based training + warp-consistency loss; recurrent (not per-frame) student |
| Teacher artifacts baked into student | Inspect labels (checker output) before each corpus expansion |
| 5090/Blackwell toolchain quirks (fp8, TRT) | torch 2.9+cu128 pinned by the repo; keep an fp16 fallback path |
| Scope creep | Phases 0–1 have a hard 2-week cap; the prize is Phase 2 |

## 10. Roadmap for a first-time trainer

| Week | Outcome |
|---|---|
| 1 | Teacher runs on 5090; per-stage benchmark table; labeling mode chosen |
| 2 | Labeling engine automated (watch-folder → labeled clips); 10 h corpus v0 |
| 3 | PyTorch training loop running; ONE-clip overfit sanity check passes |
| 4–5 | RVM fine-tune on Tier A+B; first A/B vs stock RVM; iterate data mix |
| 6 | 1080p tile finetune; eval suite; pick student v1 checkpoint |
| 7 | ONNX→TensorRT; SRT sidecar serving 1080p60; view in SlopShady |
| 8+ | Decide: ship v1, or invest in custom student v2 |

**Definition of done (v1):** 1080p60 sustained on the 5090, ≤3 frames latency,
side-by-side alpha quality clearly better than stock RVM on your test clips,
streaming into a SlopShady layer over SRT.
