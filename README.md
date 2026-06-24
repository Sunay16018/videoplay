---
title: Videoplay Studio
emoji: 🎬
colorFrom: indigo
colorTo: slate
sdk: docker
app_port: 7860
pinned: false
---

# Videoplay Studio 🚀

Ultra-smooth, professional, high-performance web-based video player and media studio. Optimized for minimal CPU/GPU usage on low-end machines, supporting offline rendering modes, dynamic scaling, and direct disk streaming.

## Features ✨

- **Aesthetic Dark Theme**: High contrast layout crafted with tailwind.
- **Dynamic Resolution Quality**: From `240p` up to `2160p` (4K) and `MAX` resolution limits.
- **Offline & Canvas Rendering Modes**: Low-power state option to convert frame drawing inside active Canvas elements for maximum fluidity on weak devices.
- **Download and Watch Simultenously**: Watch videos natively while downloading caches to local disk.
- **Interactive Download HUD**: Visual % indicators and total sizes tracked in real-time.

---

## Deploy to Hugging Face Spaces 🛸

This repository is configured to deploy directly to Hugging Face Spaces using the provided `Dockerfile`.

### Automated GitHub Deployment Setup

We have included a GitHub Actions workflow that deploys every new commit automatically to your Hugging Face space!

1. Go to your GitHub Repository: `Sunay16018/videoplay`
2. Open **Settings** -> **Secrets and variables** -> **Actions**.
3. Create a **New repository secret**:
   - Name: `HF_TOKEN`
   - Value: (Enter your Hugging Face **Write Access Token** from [Hugging Face Settings -> Access Tokens](https://huggingface.co/settings/tokens))
4. Commit or push a new change to GitHub. GitHub Actions will handle the rest!
