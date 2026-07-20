# CaptionFlow 本地智能字幕

本项目是本地桌面字幕软件 MVP，技术栈为 Tauri 2 + React + TypeScript + Rust。

## 当前能力

- 本地桌面应用框架
- 工作台、字幕编辑器和设置页面；字体、模型、导出集中在字幕编辑器右侧检查器
- 检测 FFmpeg / FFprobe
- 扫描系统字体
- 创建本地项目目录和 `project.json`
- 选择本地视频/音频文件
- 使用 `ffprobe` 读取媒体信息
- 使用 `ffmpeg` 提取 16kHz 单声道 WAV 音频

## 开发命令

安装依赖：

```bash
pnpm install
```

浏览器预览：

```bash
pnpm dev
```

Tauri 桌面开发：

```bash
pnpm tauri dev
```

构建前端：

```bash
pnpm build
```

检查 Rust：

```bash
cd src-tauri
cargo check
```

## 本地模型规划

- 默认识别：Qwen3-ASR-0.6B
- 高精度识别：Qwen3-ASR-1.7B
- 时间戳增强：Qwen3-ForcedAligner-0.6B

## 完整离线版

面向最终用户的完整离线安装包内置 Python 运行时、CPU 版 PyTorch、Qwen3-ASR Worker、Qwen3-ASR-0.6B 和 Qwen3-ForcedAligner-0.6B 权重。用户安装后即可识别字幕，不需要安装 Python、pip、PyTorch 或模型依赖。

在发布完整离线版前，开发机运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-offline-runtime.ps1 -UseLocalModelCache
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-bundled-ffmpeg.ps1
pnpm tauri build --bundles nsis
```

该步骤会生成数 GB 级别的安装包。默认使用 CPU 通用运行时；后续 GPU 加速将以可选扩展包提供，避免普通用户下载不必要的 CUDA 依赖。

Python 运行时、模型权重和 FFmpeg 二进制不提交到 Git 仓库；它们由上述准备脚本在发布构建时下载并放入安装包。FFmpeg 固定使用 Gyan.dev 的 8.0.1 Essentials Build。

安装包构建命令：

```bash
pnpm tauri build --bundles nsis
```

安装程序输出位置：

```text
src-tauri/target/release/bundle/nsis/CaptionFlow_0.1.0_x64-setup.exe
```

Worker 文件：

```text
python/asr_worker.py
```

建议使用独立 Python 3.12 环境安装依赖：

```bash
pip install -r python/requirements-qwen-asr.txt
```

如果需要指定 Python 解释器，可设置环境变量：

```bash
set CAPTIONFLOW_PYTHON=C:\path\to\python.exe
pnpm tauri dev
```

当前调用链：

```text
Tauri / Rust
  -> python/asr_worker.py
  -> qwen_asr.Qwen3ASRModel
  -> Qwen3-ASR-0.6B / Qwen3-ASR-1.7B
  -> Qwen3-ForcedAligner-0.6B
  -> cache/qwen_asr_output.json
  -> subtitles/subtitles.json
```
