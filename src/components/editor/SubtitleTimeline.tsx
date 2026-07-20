import { Minus, Plus, Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import type { SubtitleLine } from "../../types/app";
import { readAudioWaveform } from "../../services/desktop";

interface SubtitleTimelineProps {
  audioPath: string | null;
  currentTime: number;
  duration: number;
  lines: SubtitleLine[];
  selectedId: string;
  onLinesChange: (lines: SubtitleLine[]) => void;
  onSeek: (seconds: number) => void;
  onSelect: (id: string) => void;
  onSplit: () => void;
}

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  mode: DragMode;
  pointerX: number;
  start: number;
  end: number;
  subtitleId: string;
}

interface PendingClipUpdate {
  subtitleId: string;
  start: number;
  end: number;
}

const MIN_DURATION = 0.18;
const fallbackPeaks = Array.from({ length: 320 }, (_, index) => 0.18 + (((index * 23) % 38) / 55));

export function SubtitleTimeline({
  audioPath,
  currentTime,
  duration,
  lines,
  selectedId,
  onLinesChange,
  onSeek,
  onSelect,
  onSplit,
}: SubtitleTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingClipRef = useRef<PendingClipUpdate | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [peaks, setPeaks] = useState(fallbackPeaks);
  const safeDuration = Math.max(duration, 1);
  const waveformPath = useMemo(() => buildWaveformPath(peaks), [peaks]);
  const playheadRatio = clamp(currentTime / safeDuration, 0, 1);
  const rulerTicks = useMemo(() => buildRulerTicks(safeDuration, zoom), [safeDuration, zoom]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  useEffect(() => {
    if (!audioPath) {
      setPeaks(fallbackPeaks);
      return;
    }
    const sourcePath = audioPath;
    let cancelled = false;
    async function loadPeaks() {
      try {
        const bucketCount = Math.min(6_000, Math.max(1_200, Math.round(zoom * 900)));
        const waveform = await readAudioWaveform(sourcePath, bucketCount);
        if (!cancelled) setPeaks(waveform);
      } catch {
        if (!cancelled) setPeaks(fallbackPeaks);
      }
    }
    void loadPeaks();
    return () => { cancelled = true; };
  }, [audioPath, zoom]);

  function updateClip(id: string, start: number, end: number) {
    onLinesChange(lines.map((line) => (
      line.id === id
        ? { ...line, start: formatTimestamp(start), end: formatTimestamp(end) }
        : line
    )));
  }

  function flushClipUpdate() {
    const pending = pendingClipRef.current;
    pendingClipRef.current = null;
    animationFrameRef.current = null;
    if (pending) updateClip(pending.subtitleId, pending.start, pending.end);
  }

  function queueClipUpdate(subtitleId: string, start: number, end: number) {
    pendingClipRef.current = { subtitleId, start, end };
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(flushClipUpdate);
    }
  }

  function beginDrag(event: PointerEvent<HTMLElement>, line: SubtitleLine, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const start = timestampToSeconds(line.start);
    const end = Math.max(start + MIN_DURATION, timestampToSeconds(line.end));
    dragRef.current = { mode, pointerX: event.clientX, start, end, subtitleId: line.id };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(line.id);
    onSeek(start);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width <= 0) return;

    const delta = ((event.clientX - drag.pointerX) / rect.width) * safeDuration;
    let start = drag.start;
    let end = drag.end;
    if (drag.mode === "move") {
      const length = end - start;
      start = clamp(start + delta, 0, Math.max(0, safeDuration - length));
      end = start + length;
    } else if (drag.mode === "resize-start") {
      start = clamp(start + delta, 0, end - MIN_DURATION);
    } else {
      end = clamp(end + delta, start + MIN_DURATION, safeDuration);
    }
    queueClipUpdate(drag.subtitleId, start, end);
  }

  function endDrag() {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      flushClipUpdate();
    }
    dragRef.current = null;
  }

  function seekTimeline(event: PointerEvent<HTMLElement | SVGSVGElement>) {
    if (dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(clamp(((event.clientX - rect.left) / rect.width) * safeDuration, 0, safeDuration));
  }

  function updateZoom(nextZoom: number) {
    setZoom(clamp(nextZoom, 1, 8));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const viewport = event.currentTarget;
    const rect = viewport.getBoundingClientRect();
    const cursorRatio = (viewport.scrollLeft + event.clientX - rect.left) / Math.max(viewport.scrollWidth, 1);
    const nextZoom = clamp(zoom + (event.deltaY < 0 ? 0.25 : -0.25), 1, 8);
    if (nextZoom === zoom) return;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = cursorRatio * viewport.scrollWidth - (event.clientX - rect.left);
    });
  }

  return (
    <div className="timeline panel">
      <div className="timeline-heading">
        <span>字幕轨道</span>
        <div className="timeline-tools">
          <button aria-label="拆分当前字幕，快捷键 Ctrl+B" className="timeline-split-button" disabled={!lines.length} onClick={onSplit} title="拆分当前字幕 (Ctrl+B)" type="button">
            <Scissors aria-hidden="true" size={13} />
            <span>拆分</span>
            <kbd>Ctrl+B</kbd>
          </button>
          <span>{lines.length ? `${lines.length} 段` : "等待识别结果"}</span>
          <button aria-label="缩小时间线" className="timeline-zoom-button" disabled={zoom <= 1} onClick={() => updateZoom(zoom - 0.25)} title="缩小时间线" type="button"><Minus size={13} /></button>
          <output>{Math.round(zoom * 100)}%</output>
          <button aria-label="放大时间线" className="timeline-zoom-button" disabled={zoom >= 8} onClick={() => updateZoom(zoom + 0.25)} title="放大时间线" type="button"><Plus size={13} /></button>
        </div>
      </div>
      <div className="timeline-viewport" onWheel={handleWheel}>
        <div className="timeline-canvas" style={{ width: `${zoom * 100}%` }}>
          <svg aria-hidden="true" className="waveform" onPointerDown={seekTimeline} preserveAspectRatio="none" viewBox="0 0 1000 60">
            <path className="waveform-fill" d={waveformPath} />
          </svg>
          <div className="timeline-ruler" onPointerDown={seekTimeline}>
            {rulerTicks.map((tick) => <span className={tick.major ? "major" : "minor"} key={tick.seconds} style={{ left: `${(tick.seconds / safeDuration) * 100}%` }}>{tick.major ? <b>{formatClock(tick.seconds)}</b> : null}</span>)}
          </div>
          <div className="caption-track" onPointerDown={seekTimeline} ref={trackRef}>
            <div className="caption-lane-label">字幕</div>
            {lines.map((line) => {
              const start = clamp(timestampToSeconds(line.start), 0, safeDuration);
              const end = clamp(timestampToSeconds(line.end), start + MIN_DURATION, safeDuration);
              const left = (start / safeDuration) * 100;
              const width = Math.max(((end - start) / safeDuration) * 100, 1.1);
              return (
                <button
                  className={`timeline-clip ${line.id === selectedId ? "selected" : ""}`}
                  key={line.id}
                  onPointerDown={(event) => beginDrag(event, line, "move")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={line.text}
                  type="button"
                >
                  <span aria-label="调整开始时间" className="timeline-handle start" onPointerDown={(event) => beginDrag(event, line, "resize-start")} />
                  <span className="timeline-clip-label">{line.index}. {line.text}</span>
                  <span aria-label="调整结束时间" className="timeline-handle end" onPointerDown={(event) => beginDrag(event, line, "resize-end")} />
                </button>
              );
            })}
            {lines.length === 0 ? <span className="timeline-empty">识别字幕后，可在这里拖动片段并拉伸两端时间</span> : null}
          </div>
          <div className="timeline-cursor" style={{ left: `${playheadRatio * 100}%` }}><i /></div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildWaveformPath(peaks: number[]) {
  const width = 1000;
  const center = 30;
  const amplitude = 29;
  const upper = peaks.map((peak, index) => {
    const x = (index / Math.max(peaks.length - 1, 1)) * width;
    const y = center - Math.min(Math.max(peak, 0), 1) * amplitude;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const lower = peaks.map((_, index) => {
    const sourceIndex = peaks.length - 1 - index;
    const peak = peaks[sourceIndex];
    const x = (sourceIndex / Math.max(peaks.length - 1, 1)) * width;
    const y = center + Math.min(Math.max(peak, 0), 1) * amplitude;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M 0 ${center} L ${upper.join(" L ")} L ${width} ${center} L ${lower.join(" L ")} Z`;
}

function buildRulerTicks(duration: number, zoom: number) {
  const targetSpacing = duration / Math.max(6 * zoom, 1);
  const intervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const majorInterval = intervals.find((interval) => interval >= targetSpacing) ?? 300;
  const minorInterval = majorInterval / 5;
  const ticks: { seconds: number; major: boolean }[] = [];
  for (let second = 0; second <= duration + minorInterval / 2; second += minorInterval) {
    const rounded = Math.min(duration, Math.round(second * 1000) / 1000);
    ticks.push({ seconds: rounded, major: Math.abs(second / majorInterval - Math.round(second / majorInterval)) < 0.001 });
  }
  return ticks;
}

function timestampToSeconds(timestamp: string) {
  const [hours = "0", minutes = "0", seconds = "0"] = timestamp.split(":");
  return Math.max(0, Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds));
}

function formatTimestamp(seconds: number) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
