import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SubtitleLine } from "../types/app";

export interface ToolStatus {
  available: boolean;
  version?: string | null;
}

export interface AppStatus {
  default_project_dir: string;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  ffmpeg_path: string;
  python: ToolStatus;
  python_path: string;
  embedded_runtime: boolean;
  embedded_model: boolean;
  model: ToolStatus;
  model_path?: string | null;
  system_font_count: number;
}

export interface AppSettings {
  project_dir: string;
  default_model: string;
  auto_save_seconds: number;
  python_path?: string | null;
}

export interface ProjectInfo {
  name: string;
  path: string;
  created_at: number;
}

export interface OpenProjectResult {
  project: ProjectInfo;
  media_path?: string | null;
  audio_path?: string | null;
  subtitles: SubtitleLine[];
  style?: Record<string, unknown>;
  editor?: Record<string, unknown>;
}

export interface MediaInfo {
  path: string;
  file_name: string;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  frame_rate?: string | null;
  audio_streams: number;
  video_streams: number;
}

export interface AudioExtractResult {
  audio_path: string;
}

export interface ExportResult {
  output_path: string;
  format: "srt" | "ass" | "mp4";
}

export interface AsrRunResult {
  output_path: string;
  subtitles_path?: string | null;
  payload: {
    ok: boolean;
    result?: {
      language?: string | null;
      text?: string;
      segments?: AsrSegment[];
      runtime?: {
        python?: string;
        device?: string;
        model?: string;
        aligner?: string | null;
      };
    };
  };
}

export interface ModelInstallResult {
  model_path: string;
  aligner_path: string;
}

export interface AsrSegment {
  subtitle_id: string;
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence?: number | null;
  health?: {
    too_long?: boolean;
    suggest_split?: boolean;
  };
}

export interface SystemFontInfo {
  name: string;
  path: string;
  format: string;
}

export async function getAppStatus() {
  return invoke<AppStatus>("get_app_status");
}

export async function installDefaultModels() {
  return invoke<ModelInstallResult>("install_default_models");
}

export async function getSettings() {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings) {
  return invoke<AppSettings>("save_settings", { request: settings });
}

export async function createLocalProject(name: string, baseDir?: string) {
  return invoke<ProjectInfo>("create_project", {
    request: {
      name,
      base_dir: baseDir ?? null,
    },
  });
}

export async function renameLocalProject(path: string, name: string) {
  return invoke<ProjectInfo>("rename_project", { request: { path, name } });
}

export async function deleteLocalProject(path: string) {
  return invoke<void>("delete_project", { path });
}

export async function chooseProjectFile() {
  const selected = await open({ multiple: false, directory: false, filters: [{ name: "CaptionFlow 工程", extensions: ["captionflow"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function openLocalProject(path: string) {
  return invoke<OpenProjectResult>("open_project_file", { path });
}

export async function getLaunchProjectFile() {
  return invoke<string | null>("get_launch_project_file");
}

export async function saveProjectMedia(projectPath: string, mediaPath: string) {
  return invoke<void>("save_project_media", { projectPath, mediaPath });
}

export async function chooseVideoFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "媒体文件",
        extensions: ["mp4", "mov", "mkv", "avi", "mp3", "wav", "m4a"],
      },
    ],
  });

  return typeof selected === "string" ? selected : null;
}

export async function chooseProjectDirectory() {
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === "string" ? selected : null;
}

export async function choosePythonExecutable() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Python", extensions: ["exe"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseExportPath(format: "srt" | "ass" | "mp4") {
  const options = {
    srt: { name: "SRT 字幕", extension: "srt", defaultPath: "captions.srt" },
    ass: { name: "ASS 字幕", extension: "ass", defaultPath: "captions.ass" },
    mp4: { name: "带字幕视频", extension: "mp4", defaultPath: "captioned.mp4" },
  }[format];
  const selected = await save({
    defaultPath: options.defaultPath,
    filters: [{ name: options.name, extensions: [options.extension] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function probeMedia(path: string) {
  return invoke<MediaInfo>("probe_media", { path });
}

export async function extractAudio(sourcePath: string, projectPath: string) {
  return invoke<AudioExtractResult>("extract_audio", {
    sourcePath,
    projectPath,
  });
}

export async function readAudioWaveform(audioPath: string, buckets = 320) {
  return invoke<number[]>("read_audio_waveform", { audioPath, buckets });
}

export async function runQwenAsr(
  audioPath: string,
  projectPath: string,
  mode: "standard" | "accurate" = "standard",
) {
  return invoke<AsrRunResult>("run_qwen_asr", {
    request: {
      audio_path: audioPath,
      project_path: projectPath,
      language: "auto",
      mode,
      model_path: null,
      aligner_path: null,
    },
  });
}

export async function scanSystemFonts() {
  return invoke<SystemFontInfo[]>("scan_system_fonts");
}

export async function saveProjectSubtitles(projectPath: string, subtitles: SubtitleLine[]) {
  return invoke<void>("save_project_subtitles", {
    request: {
      project_path: projectPath,
      subtitles,
    },
  });
}

export async function saveProjectState({
  projectPath,
  mediaPath,
  audioPath,
  subtitles,
  style,
  editor,
}: {
  projectPath: string;
  mediaPath?: string | null;
  audioPath?: string | null;
  subtitles: SubtitleLine[];
  style: Record<string, unknown>;
  editor: Record<string, unknown>;
}) {
  return invoke<void>("save_project_state", {
    request: {
      project_path: projectPath,
      media_path: mediaPath ?? null,
      audio_path: audioPath ?? null,
      subtitles,
      style,
      editor,
    },
  });
}

export async function exportCaptions({
  projectPath,
  sourcePath,
  outputPath,
  format,
  subtitles,
  style,
  videoWidth,
  videoHeight,
}: {
  projectPath: string;
  sourcePath?: string | null;
  outputPath?: string | null;
  format: "srt" | "ass" | "mp4";
  subtitles: SubtitleLine[];
  style: { fontFamily: string; fontSize: number; color: string; strokeColor: string; strokeWidth: number; opacity: number; positionX: number; positionY: number };
  videoWidth?: number | null;
  videoHeight?: number | null;
}) {
  return invoke<ExportResult>("export_captions", {
    request: {
      project_path: projectPath,
      source_path: sourcePath ?? null,
      output_path: outputPath ?? null,
      format,
      subtitles,
      video_width: videoWidth ?? null,
      video_height: videoHeight ?? null,
      style: {
        font_family: style.fontFamily,
        font_size: style.fontSize,
        color: style.color,
        stroke_color: style.strokeColor,
        stroke_width: style.strokeWidth,
        opacity: style.opacity,
        position_x: style.positionX,
        position_y: style.positionY,
      },
    },
  });
}

export function toMediaUrl(path: string) {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path;
}
