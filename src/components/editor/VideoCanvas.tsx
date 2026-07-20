import { Fullscreen, Minimize, Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { SubtitleLine } from "../../types/app";
import { toMediaUrl } from "../../services/desktop";

export interface SubtitleStyle {
  fontFamily: string;
  fontPath?: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  strokeMode: "outer" | "inner";
  opacity: number;
  positionX: number;
  positionY: number;
}

export interface CanvasPreset {
  id: "source" | "landscape" | "portrait" | "square" | "social";
  label: string;
  ratio: number | null;
}

interface VideoCanvasProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  mediaSource: string | null;
  canvasPreset: CanvasPreset;
  sourceAspectRatio?: number | null;
  selectedSubtitle: SubtitleLine;
  style: SubtitleStyle;
  captionDraft: string;
  isCaptionEditing: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onPlayToggle: () => void;
  onCaptionDraftChange: (value: string) => void;
  onCaptionEditCommit: () => void;
  onCaptionEditStart: () => void;
  onSeek: (seconds: number) => void;
  onTimeUpdate: (seconds: number) => void;
  onMetadataLoaded: (duration: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
}

export function VideoCanvas({
  currentTime,
  duration,
  isPlaying,
  mediaSource,
  canvasPreset,
  sourceAspectRatio,
  captionDraft,
  selectedSubtitle,
  style,
  isCaptionEditing,
  videoRef,
  onMetadataLoaded,
  onCaptionDraftChange,
  onCaptionEditCommit,
  onCaptionEditStart,
  onPlayToggle,
  onPlayingChange,
  onSeek,
  onTimeUpdate,
}: VideoCanvasProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewHeight, setPreviewHeight] = useState(720);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const previewFontFamily = useMemo(() => style.fontPath ? `CaptionFlowPreview${style.fontPath.replace(/[^a-z0-9]/gi, "").slice(-18)}` : null, [style.fontPath]);
  useEffect(() => {
    if (!style.fontPath || !previewFontFamily) return;
    let active = true;
    const face = new FontFace(previewFontFamily, `url("${toMediaUrl(style.fontPath)}")`);
    face.load().then((loaded) => { if (active) document.fonts.add(loaded); }).catch(() => undefined);
    return () => { active = false; };
  }, [previewFontFamily, style.fontPath]);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setPreviewHeight(entry.contentRect.height || 720));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === previewRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);
  const previewScale = previewHeight / 720;
  const captionStyle: CSSProperties = {
    color: style.color,
    fontFamily: previewFontFamily ? `"${previewFontFamily}", "${style.fontFamily}"` : style.fontFamily,
    fontSize: `${style.fontSize * previewScale}px`,
    WebkitTextStroke: `${style.strokeWidth * previewScale}px ${style.strokeColor}`,
    paintOrder: style.strokeMode === "outer" ? "stroke fill" : "fill stroke",
    left: `calc(50% + ${style.positionX}%)`,
    bottom: `${style.positionY}%`,
    opacity: style.opacity,
  };
  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const effectiveRatio = canvasPreset.ratio ?? sourceAspectRatio;
  async function toggleFullscreen() {
    const preview = previewRef.current;
    if (!preview) return;
    if (document.fullscreenElement === preview) {
      await document.exitFullscreen();
    } else {
      await preview.requestFullscreen();
    }
  }

  return (
    <div
      className={`video-preview ${mediaSource ? "has-media" : ""} ${effectiveRatio ? "canvas-constrained" : ""}`}
      style={effectiveRatio ? { "--canvas-ratio": String(effectiveRatio) } as CSSProperties : undefined}
      ref={previewRef}
    >
      {mediaSource ? (
        <video
          className="source-video"
          onEnded={() => onPlayingChange(false)}
          onLoadedMetadata={(event) => onMetadataLoaded(event.currentTarget.duration)}
          onPause={() => onPlayingChange(false)}
          onPlay={() => onPlayingChange(true)}
          onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
          ref={videoRef}
          src={mediaSource}
        />
      ) : (
        <div className="video-empty-state">
          <Play aria-hidden="true" size={28} />
          <strong>导入视频后开始编辑</strong>
          <span>本地视频将在这里预览，字幕会实时叠加显示。</span>
        </div>
      )}
      <div className="safe-area" />
      {mediaSource ? (
        isCaptionEditing ? (
          <textarea
            aria-label="编辑预览字幕"
            autoFocus
            className="preview-caption preview-caption-editor"
            onBlur={onCaptionEditCommit}
            onChange={(event) => onCaptionDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur(); }}
            rows={2}
            style={captionStyle}
            value={captionDraft}
          />
        ) : <div className="preview-caption" onDoubleClick={onCaptionEditStart} style={captionStyle} title="双击编辑字幕">{selectedSubtitle.text}</div>
      ) : null}
      {mediaSource ? (
        <div className="video-controls">
          <button aria-label={isPlaying ? "暂停" : "播放"} className="video-control-button" onClick={onPlayToggle} type="button">
            {isPlaying ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
          </button>
          <span>{formatClock(currentTime)}</span>
          <input
            aria-label="视频进度"
            className="video-scrubber"
            max={Math.max(duration, 0)}
            min="0"
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
            style={{ "--progress": `${progress}%` } as CSSProperties}
            step="0.01"
            type="range"
            value={Math.min(currentTime, duration || 0)}
          />
          <span>{formatClock(duration)}</span>
          <Volume2 aria-hidden="true" size={16} />
          <button aria-label={isFullscreen ? "退出全屏" : "全屏预览"} className="video-control-button video-fullscreen-button" onClick={() => void toggleFullscreen()} type="button">
            {isFullscreen ? <Minimize aria-hidden="true" size={16} /> : <Fullscreen aria-hidden="true" size={16} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
