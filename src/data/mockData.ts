import type { AsrModel, FontItem, ProjectSummary, SubtitleLine } from "../types/app";

export const projects: ProjectSummary[] = [
  {
    id: "project-01",
    name: "课程口播样片",
    path: "E:\\字幕软件\\projects\\课程口播样片",
    duration: "12:48",
    aspectRatio: "16:9",
    updatedAt: "今天 11:32",
    status: "ready",
  },
  {
    id: "project-02",
    name: "短视频竖屏测试",
    path: "E:\\字幕软件\\projects\\短视频竖屏测试",
    duration: "01:26",
    aspectRatio: "9:16",
    updatedAt: "今天 10:14",
    status: "draft",
  },
  {
    id: "project-03",
    name: "访谈字幕导出验证",
    path: "E:\\字幕软件\\projects\\访谈字幕导出验证",
    duration: "34:20",
    aspectRatio: "16:9",
    updatedAt: "昨天 18:05",
    status: "exported",
  },
];

export const subtitles: SubtitleLine[] = [
  {
    id: "sub-001",
    index: 1,
    start: "00:00:01.200",
    end: "00:00:03.100",
    text: "今天我们来做一个",
    confidence: 0.97,
    health: "good",
  },
  {
    id: "sub-002",
    index: 2,
    start: "00:00:03.100",
    end: "00:00:05.600",
    text: "本地智能字幕软件的识别测试",
    confidence: 0.94,
    health: "good",
  },
  {
    id: "sub-003",
    index: 3,
    start: "00:00:05.600",
    end: "00:00:08.200",
    text: "重点是每一句字幕都要断得刚刚好",
    confidence: 0.91,
    health: "warning",
  },
  {
    id: "sub-004",
    index: 4,
    start: "00:00:08.200",
    end: "00:00:11.000",
    text: "不能让一整段话全部挤在屏幕底部影响阅读",
    confidence: 0.89,
    health: "danger",
  },
];

export const models: AsrModel[] = [
  {
    id: "qwen3-asr-06b",
    name: "Qwen3-ASR-0.6B",
    purpose: "默认识别模型",
    size: "约 1.4 GB",
    status: "installed",
    speed: "快",
    hardware: "CPU / GPU",
  },
  {
    id: "qwen3-asr-17b",
    name: "Qwen3-ASR-1.7B",
    purpose: "高精度识别模型",
    size: "约 3.8 GB",
    status: "missing",
    speed: "中",
    hardware: "推荐 GPU",
  },
  {
    id: "qwen3-aligner",
    name: "Qwen3-ForcedAligner-0.6B",
    purpose: "时间戳增强",
    size: "约 1.3 GB",
    status: "installed",
    speed: "中",
    hardware: "CPU / GPU",
  },
];

export const fonts: FontItem[] = [
  { id: "font-01", name: "Microsoft YaHei", source: "system", format: "TTF", favorite: true },
  { id: "font-02", name: "Source Han Sans SC", source: "imported", format: "OTF", favorite: true },
  { id: "font-03", name: "HarmonyOS Sans", source: "built-in", format: "TTF", favorite: false },
  { id: "font-04", name: "SimSun", source: "system", format: "TTC", favorite: false },
];
