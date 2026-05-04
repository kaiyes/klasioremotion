#!/usr/bin/env bash
nohup /home/kaiyes/projects/llama.cpp/build-vulkan/bin/llama-server \
  --model /home/kaiyes/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 18080 \
  --device Vulkan0 \
  --n-gpu-layers 99 \
  --ctx-size 8192 \
  > /tmp/llama-server.log 2>&1 &
echo "llama-server started (PID $!)"
