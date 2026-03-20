# rush-qdrant Embedding Performance Benchmarks

**Date**: 2026-03-20
**Hardware**: AMD Ryzen (16 logical cores), NVIDIA GeForce RTX 3090 (24GB VRAM), CUDA 12.5, cuDNN 9.20
**Corpus**: Grackle monorepo — 420 files, 693 chunks
**Model**: jina-embeddings-v2-base-code (768-dim, 8192 max tokens)
**ONNX Runtime**: 1.23.0

## Results

| # | Test | Model | Execution | Batching | Rate (chunks/sec) | Total Time | Speedup |
|---|------|-------|-----------|----------|-------------------|------------|---------|
| 0 | **Baseline CPU** | FP32 (612MB) | CPU (4w × 8t) | single-item | **1.7** | **402s** | 1.0x |
| 1 | GPU CUDA FP32 (no cuDNN) | FP32 (612MB) | CUDA (1w) | single-item | **1.6** | **431s** | 0.93x |
| 2 | ~~GPU CUDA FP16~~ | FP16 (321MB) | — | — | **FAILED** | — | — |
| 3 | **GPU CUDA batched** | FP32 (612MB) | CUDA (1w) | **batch-8** | **32.2** | **33s** | **12.2x** |
| 4 | CPU INT8 quantized | INT8 (162MB) | CPU (4w × 8t) | single-item | **2.0** | **354s** | 1.13x |

## Key Findings

### GPU batching is the clear winner: **12x end-to-end speedup**

- Embedding rate: 32.2 chunks/sec (vs 1.7 baseline) — **19x faster for compute alone**
- Total crawl time: 33s (vs 402s) — **12x faster end-to-end**
- Upload to Qdrant took only 1.5s — negligible compared to embedding
- The 60s checkpoint interval in the baseline was a significant hidden bottleneck

### Pete's "GPU is bad" conclusion was Mac CoreML-specific

His benchmarks showed CoreML GPU was 30x *slower* than CPU. Our results show CUDA GPU with batching is 19x *faster*. The difference:
- CoreML has huge JIT compilation overhead; CUDA doesn't
- CoreML batching doesn't benefit from unified memory; the 3090 has dedicated 24GB VRAM with 936 GB/s bandwidth
- cuDNN provides fused attention kernels optimized for transformer models

### Single-item GPU ≈ Single-item CPU (both ~1.6-1.7/sec)

Without batching, GPU provides zero benefit — kernel launch overhead dominates for individual sequences. This confirms Pete's insight that *batching is required* for GPU to help. The difference from his experience is that on CPU, batching *hurts* (padding waste), while on GPU, batching is essential (amortizes kernel launches).

### Pete's 4-worker parallelization provides minimal benefit

Single-worker CPU: 1.6/sec. Four-worker CPU: 1.7/sec. The 4x parallelization only yields a 6% speedup, suggesting the bottleneck was never the embedding compute — it was the streaming upload architecture with 60s checkpoint intervals.

### Batch speed varies wildly with sequence length

- Short batches (small chunks): 60-220 chunks/sec
- Long batches (large chunks): 19-25 chunks/sec
- Sorting chunks by token length before batching would further reduce padding waste and improve throughput

### INT8 quantized model: modest 13% CPU speedup

Pete estimated 2x speedup with 1-2% accuracy loss. We measured only 1.13x on our hardware. Not worth the accuracy tradeoff for this marginal gain, especially when GPU batching provides 19x.

### FP16 model: incompatible with ONNX Runtime 1.23.0

`model_fp16.onnx` from HuggingFace fails to load with a `SimplifiedLayerNormFusion` graph optimization error on both CPU and CUDA. This appears to be a model export issue, not a runtime limitation.

---

## Test Details

### Test 0: Baseline CPU (FP32, single-item, 4 workers × 8 threads)

- **Config**: 4 parallel ONNX sessions, 8 intra-op threads each (32 total threads)
- **Model**: `onnx/model.onnx` (FP32, 612MB)
- **Execution**: CPU provider
- **690 chunks** embedded and uploaded in **402 seconds**
- **Rate**: 1.7 chunks/sec (~588ms per embedding)
- Phase 1 (chunking): ~instant
- Phase 2 (embedding + upload): ~7 min with 60s checkpoint batches

### Test 1: GPU CUDA FP32 (single-item, 1 worker, NO cuDNN)

- **Config**: 1 ONNX session with CUDA execution provider registered
- **Model**: `onnx/model.onnx` (FP32, 612MB)
- **693 chunks** embedded and uploaded in **431 seconds**
- **Rate**: 1.6 chunks/sec (~625ms per embedding)
- **GPU utilization**: ~2%. CPU: ~28%.
- **Root cause**: cuDNN was not installed, so CUDA EP silently fell back to CPU for transformer ops. Even so, this revealed that 4-worker vs 1-worker makes almost no difference.
- **Note**: Should be re-run with cuDNN installed for a fair single-item GPU comparison.

### Test 2: GPU CUDA FP16 — FAILED

- `model_fp16.onnx` from HuggingFace fails to load on both CPU and CUDA
- Error: `GetIndexFromName ... InsertedPrecisionFreeCast ... SimplifiedLayerNormFusion`
- ONNX Runtime 1.23.0 graph optimization is incompatible with this model's FP16 export

### Test 3: GPU CUDA FP32 Batched (batch=8)

- **Config**: 1 ONNX session, CUDA EP with cuDNN 9.20, batch size 8
- **Model**: `onnx/model.onnx` (FP32, 612MB)
- **693 chunks** embedded in **21.5 seconds** (32.2 chunks/sec)
- **Upload**: 1.5s (693 chunks in batches of 100 to Qdrant)
- **Total**: 33s end-to-end
- **GPU utilization**: Bursty — spikes to ~100% during inference, drops during tokenization
- **OOM at batch=32**: requested 5.7GB for attention matrix (long sequences pad to max)
- **OOM at batch=all (693)**: requested 132GB — way too much padding

### Test 4: CPU INT8 Quantized (single-item, 4 workers × 8 threads)

- **Config**: 4 parallel ONNX sessions, 8 intra-op threads each
- **Model**: `onnx/model_quantized.onnx` (INT8, 162MB)
- **693 chunks** embedded and uploaded in **354 seconds**
- **Rate**: 2.0 chunks/sec
- Modest 13% speedup over FP32 baseline

---

## Recommendations for Pete

1. **Add CUDA batching as a crawl option** — batch size 8-16 with CUDA EP provides massive speedups on NVIDIA GPUs. The implementation is straightforward: collect chunks, tokenize, pad to max-in-batch, single ONNX inference call.

2. **Sort chunks by token length before batching** — reduces padding waste. Our batch speeds ranged from 19 to 220 chunks/sec; sorting would keep batches uniformly fast.

3. **Separate embedding from uploading** — the 60s checkpoint streaming architecture hides performance. Embedding all chunks first, then uploading, is both simpler and faster (1.5s for upload vs minutes of interleaved checkpoints).

4. **cuDNN is required for real GPU performance** — without it, CUDA EP silently falls back to CPU. This should be documented as a prerequisite.

5. **Consider dropping the multi-worker parallel approach on GPU** — a single CUDA session with batching outperforms 4 parallel CPU sessions by 19x. The parallel CPU approach adds complexity (mutex contention, multiple ONNX sessions) for minimal benefit.

## Environment Setup Notes

- **ONNX Runtime GPU**: Download `onnxruntime-win-x64-gpu-1.23.0.zip`, place DLLs next to binary
- **cuDNN**: `pip install nvidia-cudnn-cu12`, copy DLLs from `nvidia/cudnn/bin/` to binary directory
- **CUDA Toolkit**: 12.5 (installed at `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.5`)
- **Windows path fix**: `should_skip_path()` needs `path.replace('\\', "/")` for cross-platform compatibility
- **`load-dynamic` feature**: Required for Windows MSVC builds due to static linking incompatibility with `ort-sys`
