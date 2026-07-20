# CaptionFlow 本地智能字幕

<p align="center">
  <img src="public/captionflow-icon.png" width="132" alt="CaptionFlow 图标" />
</p>

<p align="center">一款面向桌面端创作者的本地字幕识别、编辑与导出工具。</p>

<p align="center">
  <a href="https://github.com/ShiyouQi888/Captionflow/releases/latest">下载发行版</a>
  · <a href="#快速开始">快速开始</a>
  · <a href="#版权与许可">版权与许可</a>
</p>

## 简介

CaptionFlow 是一款运行在 Windows 本地的智能字幕软件。它将视频导入、音频提取、Qwen3-ASR 语音识别、字幕断句、时间线编辑、字幕样式调节和导出集中到一个桌面应用中。

所有项目媒体、字幕与导出文件均由软件在本机处理。完整离线发行版会把应用运行环境、FFmpeg 和本地识别运行时封装在安装包内，普通用户无需自行安装 Python、pip 或开发依赖。

## 功能一览

- 导入本地视频或音频，读取时长、尺寸和音轨等媒体信息
- 使用 Qwen3-ASR 本地识别中文语音字幕，并清理识别文本中的标点
- 按字幕长度、语义和时间范围重新断句，避免单条字幕过长
- 视频预览与字幕画布同步显示，支持 16:9、9:16、1:1、4:5 和原始比例
- 字幕列表、字幕编辑器、波形时间线和播放头联动
- 拖拽字幕块、调整开始和结束时间、字幕拆分、撤销和自动保存
- 编辑字体、字号、文字颜色、描边颜色、内描或外描、透明度和位置
- 扫描并选择系统字体；样式变化同步反映在预览和导出中
- 导出 SRT、ASS 字幕文件，或使用 FFmpeg 生成带烧录字幕的视频
- 使用独有的 `.captionflow` 工程文件保存项目，可在本软件中再次打开
- 在设置页查看本地运行环境、模型状态、项目目录和软件版权信息

## 快速开始

### 使用发行版

从 [Releases](https://github.com/ShiyouQi888/Captionflow/releases/latest) 下载 `CaptionFlow_0.1.0_x64-setup.exe`，运行安装程序后即可使用。

推荐工作流程：

1. 新建项目并选择项目保存位置。
2. 导入视频或音频素材。
3. 点击“识别字幕”，等待本地模型完成识别与时间对齐。
4. 在字幕列表、预览画布或时间线上修改文本和时间。
5. 在右侧字幕样式面板调整字体、颜色、描边、位置与透明度。
6. 导出 `.srt`、`.ass` 或带字幕的 MP4 视频。

### 打开已有工程

CaptionFlow 项目目录包含 `project.captionflow` 工程文件。通过工作台的“打开工程”选择该文件，即可恢复项目配置、字幕、样式和媒体引用。

请尽量不要移动工程目录内的文件。如果原始媒体文件已被移动，重新导入同一媒体即可继续编辑。

## 系统要求

- Windows 10 或 Windows 11 64 位
- 建议至少 8 GB 内存，处理长视频或大模型时建议 16 GB 及以上
- 可用磁盘空间：安装和模型运行需要数 GB 空间
- CPU 可运行本地识别；具备独立 GPU 的设备可作为后续加速扩展目标

## 本地处理与隐私

- 项目视频、音频、字幕、工程文件和导出结果默认保存在本地。
- 识别任务由本地 Python Worker 和 Qwen3-ASR 模型执行。
- 软件不会为识别流程建立云端项目协作或上传用户媒体。
- 用户应确保导入、处理、导出及传播的所有内容拥有合法授权。

## 导出说明

| 类型 | 用途 |
| --- | --- |
| SRT | 通用字幕文件，适合播放器、剪辑软件和平台上传。 |
| ASS | 保留字体、描边、颜色、透明度与位置等更丰富样式。 |
| 带字幕 MP4 | 通过 FFmpeg 将字幕烧录进视频画面，适用于直接发布。 |

不同播放器对字体和 ASS 特性的支持存在差异。需要保证视觉一致性时，建议导出带字幕 MP4。

## 技术架构

| 层级 | 技术 |
| --- | --- |
| 桌面应用 | Tauri 2、Rust |
| 用户界面 | React、TypeScript、Vite |
| 本地识别 | Qwen3-ASR、Qwen3-ForcedAligner、Python Worker |
| 媒体处理 | FFmpeg、FFprobe |
| 工程格式 | CaptionFlow `.captionflow` + 本地项目数据 |

## 从源码运行

### 前置要求

- Node.js 与 pnpm
- Rust 工具链
- Windows WebView2 Runtime

安装依赖并启动桌面开发环境：

```powershell
pnpm install
pnpm tauri dev
```

构建前端与检查 Rust：

```powershell
pnpm build
Set-Location src-tauri
cargo check
```

## 构建完整离线安装包

源码仓库不会提交大体积的 Python 运行时、模型权重和 FFmpeg 二进制。发布构建时运行下列脚本，它们会下载并准备相应资源，然后由 Tauri 打入安装程序。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-offline-runtime.ps1 -UseLocalModelCache
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-bundled-ffmpeg.ps1
pnpm tauri build --bundles nsis
```

安装程序默认输出到：

```text
src-tauri/target/release/bundle/nsis/CaptionFlow_0.1.0_x64-setup.exe
```

构建完整离线版会下载数 GB 的运行时和模型资源，请确保网络稳定并预留足够磁盘空间。

## 目录结构

```text
src/                    React 界面与编辑器组件
src-tauri/              Rust 命令、桌面能力与打包配置
python/asr_worker.py    Qwen3-ASR 本地识别 Worker
scripts/                离线运行时与 FFmpeg 准备脚本
public/                 应用图标与静态资源
```

## 致谢

CaptionFlow 的实现依赖并感谢以下开源项目及社区：

- [Tauri](https://tauri.app/)：跨平台桌面应用框架
- [Rust](https://www.rust-lang.org/)：高性能本地应用能力
- [React](https://react.dev/) 与 [Vite](https://vite.dev/)：用户界面与开发工具链
- [FFmpeg](https://ffmpeg.org/)：音视频解析、音频提取与字幕烧录
- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)：本地语音识别能力
- Qwen3-ForcedAligner：字幕时间对齐能力
- [Lucide](https://lucide.dev/)：界面图标

上述组件、模型及其衍生资源均适用各自的许可证、使用条款和发布政策。感谢所有维护者与贡献者的工作。

## 版权与许可

Copyright © 2026 齐世有。保留所有权利。

- 作者：齐世有
- 联系邮箱：[blacklaw@foxmail.com](mailto:blacklaw@foxmail.com)
- 软件名称：CaptionFlow 本地智能字幕

本仓库源代码、软件安装程序、商标标识和相关材料的使用应遵守仓库内的 [LICENSE.txt](LICENSE.txt) 说明。第三方开源组件、FFmpeg 发行构建及 Qwen 模型的权利和许可不属于本项目作者，使用者应分别遵守其官方许可与适用法律。

本软件按“现状”提供。在法律允许的最大范围内，作者不对使用或无法使用本软件所产生的直接或间接损失承担责任。

## 联系与支持

如有功能建议、问题反馈或合作意向，可通过邮箱联系作者，也可使用下方二维码联系。

<p align="center">
  <img src="public/weichat-qr.svg" width="180" alt="齐世有微信二维码" />
</p>

<p align="center">感谢你的关注与支持。</p>
