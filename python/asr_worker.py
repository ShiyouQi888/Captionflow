from __future__ import annotations

import argparse
import json
import platform
import re
import sys
import traceback
import wave
from pathlib import Path
from typing import Any


CAPTION_PUNCTUATION = re.compile(r"[，。！？；：、,.!?;:\"'“”‘’()（）\[\]【】{}<>《》…—–\-·~`]+")


def clean_caption_text(text: str) -> str:
    """Keep spoken words only in the subtitle text while retaining raw text for alignment."""
    without_punctuation = CAPTION_PUNCTUATION.sub("", text)
    return re.sub(r"\s+", " ", without_punctuation).strip()


def write_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_request(path: str) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def import_runtime() -> tuple[Any, Any]:
    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except ModuleNotFoundError as exc:
        missing = exc.name or "qwen-asr"
        raise RuntimeError(
            f"识别运行时不完整，缺少依赖：{missing}。请重新安装 CaptionFlow 完整离线版。"
        ) from exc

    return torch, Qwen3ASRModel


def pick_model_name(request: dict[str, Any]) -> str:
    model_path = request.get("model_path")
    if model_path and Path(model_path).exists():
        return str(model_path)

    mode = request.get("mode", "standard")
    if mode == "accurate":
        return "Qwen/Qwen3-ASR-1.7B"

    return "Qwen/Qwen3-ASR-0.6B"


def pick_aligner_name(request: dict[str, Any]) -> str | None:
    if not request.get("return_timestamps", True):
        return None

    aligner_path = request.get("aligner_path")
    if aligner_path and Path(aligner_path).exists():
        return str(aligner_path)

    return "Qwen/Qwen3-ForcedAligner-0.6B"


def choose_device(torch: Any) -> tuple[str, Any, dict[str, Any]]:
    if torch.cuda.is_available():
        return "cuda:0", torch.bfloat16, {"device_map": "cuda:0"}

    return "cpu", torch.float32, {"device_map": "cpu"}


def value_from_result(result: Any, key: str, default: Any = None) -> Any:
    if isinstance(result, dict):
        return result.get(key, default)
    return getattr(result, key, default)


def timestamp_to_segment(item: Any, index: int, fallback_text: str) -> dict[str, Any]:
    if isinstance(item, dict):
        text = item.get("text") or item.get("sentence") or item.get("word") or fallback_text
        start = item.get("start") or item.get("begin") or item.get("start_time") or 0
        end = item.get("end") or item.get("finish") or item.get("end_time") or start
    elif isinstance(item, (list, tuple)) and len(item) >= 2:
        start = item[0]
        end = item[1]
        text = item[2] if len(item) >= 3 else fallback_text
    else:
        text = value_from_result(item, "text", fallback_text)
        start = value_from_result(item, "start_time", value_from_result(item, "start", 0))
        end = value_from_result(item, "end_time", value_from_result(item, "end", start))

    start_ms = int(float(start) * 1000) if float(start) < 10000 else int(float(start))
    end_ms = int(float(end) * 1000) if float(end) < 10000 else int(float(end))

    return {
        "subtitle_id": f"sub_{index + 1:04d}",
        "index": index + 1,
        "start_ms": start_ms,
        "end_ms": max(end_ms, start_ms + 800),
        "text": str(text).strip(),
        "raw_text": str(text).strip(),
        "confidence": None,
        "words": [],
        "health": {
            "score": 100,
            "too_long": False,
            "too_fast": False,
            "suggest_split": False,
        },
    }


def audio_duration_ms(path: Path) -> int:
    try:
        with wave.open(str(path), "rb") as audio:
            return int(audio.getnframes() / audio.getframerate() * 1000)
    except (wave.Error, OSError, ZeroDivisionError):
        return 0


def caption_chunks(text: str, max_chars: int = 18) -> list[str]:
    chunks: list[str] = []
    buffer = ""
    break_chars = "。！？!?；;，,、"

    for char in text.strip():
        buffer += char
        if char in break_chars and len(buffer) >= 6:
            chunks.append(buffer.strip())
            buffer = ""
        elif len(buffer) >= max_chars:
            split_at = max((buffer.rfind(mark) for mark in "，,、"), default=-1)
            if split_at >= 5:
                chunks.append(buffer[: split_at + 1].strip())
                buffer = buffer[split_at + 1 :].strip()
            else:
                chunks.append(buffer.strip())
                buffer = ""

    if buffer.strip():
        chunks.append(buffer.strip())
    return [chunk for chunk in chunks if chunk]


def timestamps_include_text(timestamps: list[Any]) -> bool:
    for item in timestamps:
        if isinstance(item, dict) and any(item.get(key) for key in ("text", "sentence", "word")):
            return True
        if isinstance(item, (list, tuple)) and len(item) >= 3 and isinstance(item[2], str) and item[2].strip():
            return True
        if str(value_from_result(item, "text", "")).strip():
            return True
    return False


def segments_from_timestamps(timestamps: list[Any], reference_text: str) -> list[dict[str, Any]]:
    tokens = [timestamp_to_segment(item, index, "") for index, item in enumerate(timestamps)]
    tokens = [token for token in tokens if token["text"]]
    if not tokens:
        return []

    segments: list[dict[str, Any]] = []
    buffer: list[str] = []
    start_ms = tokens[0]["start_ms"]
    end_ms = start_ms
    reference_index = 0
    punctuation = "。！？!?；;，,、"

    def flush() -> None:
        nonlocal buffer, start_ms, end_ms
        raw_text = "".join(buffer).strip()
        text = clean_caption_text(raw_text)
        if not text:
            buffer = []
            return
        index = len(segments) + 1
        segments.append(
            {
                "subtitle_id": f"sub_{index:04d}",
                "index": index,
                "start_ms": start_ms,
                "end_ms": max(end_ms, start_ms + 160),
                "text": text,
                "raw_text": raw_text,
                "confidence": None,
                "words": [],
                "health": {
                    "score": 100,
                    "too_long": len(text) > 20,
                    "too_fast": False,
                    "suggest_split": len(text) > 20,
                },
            }
        )
        buffer = []

    for token in tokens:
        token_start = token["start_ms"]
        if buffer and token_start - end_ms > 700:
            flush()
            start_ms = token_start
        while reference_index < len(reference_text) and reference_text[reference_index] in punctuation:
            buffer.append(reference_text[reference_index])
            reference_index += 1
            flush()
            start_ms = token_start
        buffer.append(token["text"])
        reference_index += len(token["text"])
        end_ms = max(end_ms, token["end_ms"])
        text = "".join(buffer).strip()
        if (text and text[-1] in "。！？!?；;") or len(text) >= 18:
            flush()
            start_ms = end_ms

    while reference_index < len(reference_text) and reference_text[reference_index] in punctuation:
        buffer.append(reference_text[reference_index])
        reference_index += 1
    flush()
    return segments


def segments_from_text(text: str, duration_ms: int) -> list[dict[str, Any]]:
    chunks = caption_chunks(text)
    if not chunks:
        return []

    duration_ms = max(duration_ms, len(chunks) * 800)
    total_weight = sum(len(chunk) for chunk in chunks)
    cursor = 0
    segments: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        remaining = duration_ms - cursor
        if index == len(chunks) - 1:
            end = duration_ms
        else:
            allocation = max(800, round(duration_ms * len(chunk) / total_weight))
            end = min(duration_ms, cursor + min(allocation, remaining))
        segments.append(
            {
                "subtitle_id": f"sub_{index + 1:04d}",
                "index": index + 1,
                "start_ms": cursor,
                "end_ms": max(end, cursor + 800),
                "text": clean_caption_text(chunk),
                "raw_text": chunk,
                "confidence": None,
                "words": [],
                "health": {
                    "score": 100,
                    "too_long": len(chunk) > 20,
                    "too_fast": False,
                    "suggest_split": len(chunk) > 20,
                },
            }
        )
        cursor = end
    return segments


def resolve_segment_overlaps(segments: list[dict[str, Any]], duration_ms: int) -> list[dict[str, Any]]:
    """Keep ASR timing boundaries continuous so subtitle events never overlap."""
    if not segments:
        return []

    minimum_duration = 120
    normalized = sorted(segments, key=lambda item: (int(item["start_ms"]), int(item["end_ms"])))
    for segment in normalized:
        start = max(0, int(segment["start_ms"]))
        end = max(start + minimum_duration, int(segment["end_ms"]))
        if duration_ms > 0:
            end = min(end, duration_ms)
        segment["start_ms"] = start
        segment["end_ms"] = max(start + 1, end)

    for index in range(1, len(normalized)):
        previous = normalized[index - 1]
        current = normalized[index]
        if current["start_ms"] >= previous["end_ms"]:
            continue
        midpoint = round((current["start_ms"] + previous["end_ms"]) / 2)
        boundary = max(previous["start_ms"] + minimum_duration, midpoint)
        boundary = min(boundary, current["end_ms"] - 1)
        previous["end_ms"] = boundary
        current["start_ms"] = boundary
        if current["end_ms"] <= current["start_ms"]:
            current["end_ms"] = current["start_ms"] + minimum_duration

    for index, segment in enumerate(normalized, start=1):
        segment["index"] = index
        segment["subtitle_id"] = f"sub_{index:04d}"
    return normalized


def normalize_result(raw_result: Any, source_audio: Path) -> dict[str, Any]:
    result = raw_result[0] if isinstance(raw_result, list) and raw_result else raw_result
    language = value_from_result(result, "language", None)
    text = value_from_result(result, "text", "") or ""
    timestamps = (
        value_from_result(result, "time_stamps", None)
        or value_from_result(result, "timestamps", None)
        or value_from_result(result, "segments", None)
        or []
    )

    if timestamps and timestamps_include_text(timestamps):
        segments = segments_from_timestamps(timestamps, str(text))
    else:
        segments = segments_from_text(str(text), audio_duration_ms(source_audio))

    duration_ms = audio_duration_ms(source_audio)
    return {
        "language": language,
        "text": clean_caption_text(str(text)),
        "segments": resolve_segment_overlaps(segments, duration_ms),
    }


def run_asr(request: dict[str, Any]) -> dict[str, Any]:
    audio_path = Path(request["audio_path"])
    if not audio_path.exists():
        raise RuntimeError(f"音频文件不存在：{audio_path}")

    torch, Qwen3ASRModel = import_runtime()
    device, dtype, device_kwargs = choose_device(torch)
    model_name = pick_model_name(request)
    aligner_name = pick_aligner_name(request)

    aligner_kwargs = None
    if aligner_name:
        aligner_kwargs = {
            "dtype": dtype,
            **device_kwargs,
        }

    model = Qwen3ASRModel.from_pretrained(
        model_name,
        dtype=dtype,
        max_inference_batch_size=1,
        max_new_tokens=int(request.get("max_new_tokens", 4096)),
        forced_aligner=aligner_name,
        forced_aligner_kwargs=aligner_kwargs,
        **device_kwargs,
    )

    language = request.get("language")
    if language == "auto":
        language = None

    raw_results = model.transcribe(
        audio=str(audio_path),
        language=language,
        return_time_stamps=bool(request.get("return_timestamps", True)),
    )
    normalized = normalize_result(raw_results, audio_path)
    normalized["runtime"] = {
        "python": platform.python_version(),
        "device": device,
        "model": model_name,
        "aligner": aligner_name,
    }
    return normalized


def main() -> int:
    parser = argparse.ArgumentParser(description="CaptionFlow Qwen3-ASR worker")
    parser.add_argument("--request", required=True, help="Path to request JSON")
    parser.add_argument("--output", required=True, help="Path to output JSON")
    args = parser.parse_args()

    try:
        request = load_request(args.request)
        result = run_asr(request)
        payload = {"ok": True, "result": result}
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        write_json(payload)
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI worker must return structured failures.
        payload = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "python": platform.python_version(),
        }
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        write_json(payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
