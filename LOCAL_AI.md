# Local AI setup

AI Design Studio can create poster copy and artwork without a cloud API key by connecting to local Ollama and ComfyUI services. Prompts and generated images stay on this computer in local mode. The application does not download or install either runtime or any model automatically.

## Hardware and disk space

The current PC has an NVIDIA GPU with at least 12 GB of VRAM, 8–15 GB of system RAM, and less than 10 GB of free disk space. The GPU is suitable for a lightweight local image checkpoint, but the current free space is not enough to safely install both runtimes and their models. Free space or choose another local drive before installing; keep several gigabytes beyond the downloaded models for runtime files, caches, and generated images. Do not put model weights in the project folder.

## Install Ollama for text

1. Install [Ollama for Windows](https://ollama.com/download/windows). The official Windows installer requires Windows 10 22H2 or newer and runs its API on `http://localhost:11434`.
2. Open Command Prompt and download a small text model:

   ```cmd
   ollama pull qwen2.5:3b
   ```

3. Check the model is available:

   ```cmd
   ollama list
   ```

4. If the model cache must live on another drive, set the `OLLAMA_MODELS` user environment variable to a folder on that drive, then restart Ollama before pulling the model. See the [Ollama Windows filesystem guide](https://docs.ollama.com/windows#filesystem-requirements).

## Install ComfyUI for artwork

1. Install the official [ComfyUI Windows portable build](https://docs.comfy.org/installation/desktop_windows) for NVIDIA, or follow the [ComfyUI manual Windows installation](https://docs.comfy.org/installation/manual_install).
2. Keep the runtime and its model folders on a drive with enough free space. In ComfyUI, place a compatible Stable Diffusion 1.5 checkpoint under `ComfyUI/models/checkpoints/`.
3. Start ComfyUI with its NVIDIA launcher. This app expects its API at `http://127.0.0.1:8188` and a working `CheckpointLoaderSimple` node. Do not expose either service to the public internet or a LAN; this application only connects to loopback.

The built-in ComfyUI workflow uses one 768 × 1024 image, 20 Euler sampling steps, and omits rendered text so poster copy remains editable. Generation time depends on the checkpoint and GPU.

## Select local mode in the app

1. Start Ollama and ComfyUI.
2. Open **AI settings** from the assistant and leave **Local AI · Ollama + ComfyUI** selected.
3. Select `qwen2.5:3b` as the text model, then click **Check local services**.
4. Select an installed ComfyUI checkpoint and save settings.
5. Reopen the production assistant. Poster generation becomes available when both selected models are detected.

Local mode supports poster plans, artwork generation, marketing copy, layout advice, format adaptation, and the existing local background-removal models. Image editing and image variations are currently only available through remote provider mode. If a model or service is missing, the app reports that instead of silently falling back to a cloud provider.

## Remote provider (optional)

Switch **Active AI mode** to **Remote API provider** to use an OpenAI-compatible service. In remote mode, prompts and generated or edited images are sent to that configured provider. The API key is stored in the operating-system credential store, not in the project. No remote API key is required for local mode.

## Troubleshooting

- **Ollama not running:** start Ollama and verify `http://127.0.0.1:11434/api/tags` responds locally.
- **Text model not installed:** run `ollama pull qwen2.5:3b`, or enter the exact model name shown by `ollama list`.
- **ComfyUI not running:** start its NVIDIA launcher and verify `http://127.0.0.1:8188/object_info/CheckpointLoaderSimple` responds locally.
- **No checkpoint listed:** confirm the checkpoint file is in `ComfyUI/models/checkpoints/`, then restart or refresh ComfyUI and use **Check local services** again.
- **Insufficient disk space:** move the model folders to a different local drive or free space before downloading. The app does not manage model downloads.
- **GPU out of memory:** use a smaller SD 1.5 checkpoint, close other GPU-heavy programs, or reduce the workflow resolution before retrying.
