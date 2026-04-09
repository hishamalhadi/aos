"""Align transcript to storyboard timestamps for 'shown but not said' detection.

The core insight: if you want to know whether a frame conveys information the
speaker doesn't verbalize, you need to compare what's on screen at time T
against what's being said between time T and T+window.

This module takes a transcript (with timestamps) and a list of frame timestamps
and returns paired chunks so Claude can do the comparison efficiently.
"""

import re
from typing import Any


# Matches [MM:SS.ff] or [HH:MM:SS.ff] or [MM:SS] timestamps in transcripts
TIMESTAMP_PATTERN = re.compile(
    r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\]"
)


def parse_transcript_segments(transcript: str) -> list[dict]:
    """Parse a timestamped transcript into segments.

    Handles YouTube caption format like:
        [00:00.16] First line of text.
        [00:02.56] Second line.

    Returns:
        [{start_time, text}] — sorted by start_time
    """
    if not transcript:
        return []

    segments = []
    # Split on timestamp boundaries, preserving the timestamps
    parts = TIMESTAMP_PATTERN.split(transcript)
    # parts structure: [pre_text, h1, m1, s1, frac1, text1, h2, m2, s2, frac2, text2, ...]
    # Actually TIMESTAMP_PATTERN has 4 groups → [pre, g1, g2, g3, g4, text, g1, g2, g3, g4, text...]

    i = 1  # skip leading text before first timestamp
    while i < len(parts) - 4:
        g1, g2, g3, g4 = parts[i], parts[i + 1], parts[i + 2], parts[i + 3]
        text = parts[i + 4] if i + 4 < len(parts) else ""

        # Parse timestamp
        if g3:  # HH:MM:SS
            hours, minutes, seconds = int(g1), int(g2), int(g3)
            total = hours * 3600 + minutes * 60 + seconds
        else:  # MM:SS
            minutes, seconds = int(g1), int(g2)
            total = minutes * 60 + seconds

        if g4:
            total += int(g4) / (10 ** len(g4))

        text = text.strip()
        if text:
            segments.append({"start_time": round(total, 2), "text": text})

        i += 5

    return segments


def chunks_near_timestamps(
    transcript: str,
    timestamps: list[float],
    window: float = 10.0,
) -> list[dict]:
    """For each timestamp, return the transcript text around it.

    Args:
        transcript: Raw timestamped transcript
        timestamps: List of frame timestamps (seconds)
        window: Seconds on each side of the timestamp to include

    Returns:
        [{timestamp, text_at_time, context_before, context_after}]

    Each entry contains:
      - timestamp: the frame timestamp
      - text_at_time: transcript text within ±window/2 of the frame
      - context_before: text from window..window*2 before (broader context)
      - context_after: text from window..window*2 after (broader context)
    """
    segments = parse_transcript_segments(transcript)
    if not segments:
        return [{"timestamp": ts, "text_at_time": "", "context_before": "",
                 "context_after": ""} for ts in timestamps]

    results = []
    half = window / 2

    for ts in timestamps:
        at_time = []
        before = []
        after = []

        for seg in segments:
            t = seg["start_time"]
            if ts - half <= t <= ts + half:
                at_time.append(seg["text"])
            elif ts - window <= t < ts - half:
                before.append(seg["text"])
            elif ts + half < t <= ts + window:
                after.append(seg["text"])

        results.append({
            "timestamp": ts,
            "text_at_time": " ".join(at_time),
            "context_before": " ".join(before),
            "context_after": " ".join(after),
        })

    return results


def build_alignment_table(
    transcript: str,
    sprite_frames: list[dict],
    chapters: list[dict] | None = None,
) -> list[dict]:
    """Build a full alignment table: frame → timestamp → spoken text → chapter.

    For each sprite frame, returns:
      - timestamp
      - chapter (if available)
      - spoken text within ±5s of the frame
      - whether the frame is near a chapter boundary (+/- 15s)

    This is what Claude consumes when doing "shown but not said" analysis.

    Args:
        transcript: Timestamped transcript
        sprite_frames: [{timestamp, path}] from storyboard split
        chapters: Optional [{start_time, title}] from metadata

    Returns:
        [{
            timestamp, frame_path, chapter, is_chapter_boundary,
            spoken, context_before, context_after
        }]
    """
    chapters = chapters or []
    timestamps = [f["timestamp"] for f in sprite_frames]
    frame_paths = {f["timestamp"]: f.get("path", "") for f in sprite_frames}

    aligned = chunks_near_timestamps(transcript, timestamps, window=10.0)

    def find_chapter(ts: float) -> tuple[str, bool]:
        """Find the chapter containing ts and whether ts is near a boundary."""
        current = ""
        boundary = False
        for ch in chapters:
            ch_start = ch.get("start_time", 0)
            if ch_start <= ts:
                current = ch.get("title", "")
            if abs(ts - ch_start) <= 15:
                boundary = True
        return current, boundary

    table = []
    for entry in aligned:
        ts = entry["timestamp"]
        chapter, boundary = find_chapter(ts)
        table.append({
            "timestamp": ts,
            "frame_path": frame_paths.get(ts, ""),
            "chapter": chapter,
            "is_chapter_boundary": boundary,
            "spoken": entry["text_at_time"],
            "context_before": entry["context_before"],
            "context_after": entry["context_after"],
        })

    return table
