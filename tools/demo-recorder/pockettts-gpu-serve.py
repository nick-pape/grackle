#!/usr/bin/env python3
"""Start PocketTTS HTTP server with GPU acceleration when available."""
import os
import sys

try:
    import torch

    if torch.cuda.is_available():
        print(
            f"[pockettts] GPU detected: {torch.cuda.get_device_name(0)}",
            flush=True,
        )

        from pocket_tts.model import TTSModel

        _original_func = TTSModel.load_model.__func__

        @classmethod
        def _gpu_load(cls, *args, **kwargs):
            model = _original_func(cls, *args, **kwargs)
            model = model.to("cuda")
            print("[pockettts] Model moved to CUDA", flush=True)
            return model

        TTSModel.load_model = _gpu_load
    else:
        print("[pockettts] No GPU detected, using CPU", flush=True)
except Exception as exc:
    print(f"[pockettts] GPU setup failed ({exc}), using CPU", flush=True)

# Invoke pocket-tts serve via its CLI entrypoint
port = os.environ.get("POCKETTTS_PORT", "8890")
sys.argv = ["pocket-tts", "serve", "--port", port]

from pocket_tts.main import cli_app

cli_app()
