"""Storyboard visual extraction — YouTube sprite-based visual triage.

Three-layer pipeline using YouTube's pre-generated storyboard sprites:
  Layer 0: Fetch storyboard sprite sheets (free, ~2s, ~1MB for 30min video)
  Layer 1: Visual triage by Claude (classify frames as code/slide/talking_head/etc)
  Layer 2: Surgical hi-res extraction at flagged timestamps only

No video download needed for Layer 0-1. Layer 2 downloads only the relevant segments.
"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

# Storyboard tiers from YouTube (yt-dlp format IDs)
# sb0 = highest res (320x180, 3x3 grid) — best for triage
# sb1 = medium res  (160x90, 5x5 grid)  — more frames per sheet
# sb2 = low res     (80x45, 10x10 grid)  — full overview
# sb3 = tiny        (48x27, 10x10 grid)  — scrubber only
TIER_ORDER = ["sb0", "sb1", "sb2", "sb3"]


def get_storyboard_formats(url: str) -> dict:
    """Extract storyboard format info from yt-dlp metadata.

    Returns dict keyed by tier (sb0, sb1, sb2, sb3) with format details.
    """
    result = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-warnings", url],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        print(f"  yt-dlp metadata failed: {result.stderr}", file=sys.stderr)
        return {}

    data = json.loads(result.stdout)
    storyboards = {}

    for fmt in data.get("formats", []):
        fid = fmt.get("format_id", "")
        if fid.startswith("sb") and fmt.get("format_note") == "storyboard":
            storyboards[fid] = {
                "format_id": fid,
                "width": fmt.get("width"),
                "height": fmt.get("height"),
                "rows": fmt.get("rows"),
                "columns": fmt.get("columns"),
                "fps": fmt.get("fps"),
                "fragments": fmt.get("fragments", []),
            }

    return storyboards


def download_sprites(storyboards: dict, output_dir: str,
                     tier: str = "sb0", sample: int = 0) -> list[dict]:
    """Download sprite sheet JPEGs for the given tier.

    Args:
        storyboards: Output from get_storyboard_formats()
        output_dir: Directory to save sprite sheets
        tier: Which resolution tier (sb0=highest, sb2=lowest)
        sample: If > 0, download only N evenly-spaced sheets

    Returns:
        List of {path, index, duration, rows, cols, width, height}
    """
    if tier not in storyboards:
        # Fall back to next available tier
        for t in TIER_ORDER:
            if t in storyboards:
                tier = t
                break
        else:
            return []

    info = storyboards[tier]
    fragments = info["fragments"]
    rows = info["rows"]
    cols = info["columns"]
    width = info["width"]
    height = info["height"]

    if not fragments:
        return []

    # Sample evenly if requested
    if sample > 0 and sample < len(fragments):
        step = len(fragments) / sample
        indices = [int(i * step) for i in range(sample)]
    else:
        indices = list(range(len(fragments)))

    os.makedirs(output_dir, exist_ok=True)
    sheets = []

    for idx in indices:
        frag = fragments[idx]
        frag_url = frag.get("url", "")
        if not frag_url:
            continue

        filename = f"sprite_{idx:03d}.jpg"
        filepath = os.path.join(output_dir, filename)

        try:
            urllib.request.urlretrieve(frag_url, filepath)
            sheets.append({
                "path": filepath,
                "index": idx,
                "duration": frag.get("duration", 0),
                "rows": rows,
                "cols": cols,
                "frame_width": width,
                "frame_height": height,
            })
        except Exception as e:
            print(f"  Failed to download sprite {idx}: {e}", file=sys.stderr)

    return sheets


def split_sprite_sheet(sheet: dict, output_dir: str,
                       base_timestamp: float,
                       frame_duration: float) -> list[dict]:
    """Split a sprite sheet grid into individual frames.

    Args:
        sheet: Single entry from download_sprites()
        output_dir: Directory for individual frame images
        base_timestamp: Starting timestamp for this sheet
        frame_duration: Duration each frame represents

    Returns:
        List of {path, timestamp, row, col}
    """
    from PIL import Image

    img = Image.open(sheet["path"])
    rows = sheet["rows"]
    cols = sheet["cols"]
    fw = sheet["frame_width"]
    fh = sheet["frame_height"]

    os.makedirs(output_dir, exist_ok=True)
    frames = []

    for r in range(rows):
        for c in range(cols):
            ts = base_timestamp + (r * cols + c) * frame_duration
            box = (c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)
            frame_img = img.crop(box)

            # Skip black/empty frames (common at end of last sheet)
            pixels = list(frame_img.getdata())
            avg_brightness = sum(sum(p[:3]) for p in pixels) / (len(pixels) * 3)
            if avg_brightness < 5:
                continue

            filename = f"frame_{ts:07.1f}.jpg"
            filepath = os.path.join(output_dir, filename)
            frame_img.save(filepath, "JPEG", quality=90)

            frames.append({
                "path": filepath,
                "timestamp": round(ts, 1),
            })

    return frames


def fetch_storyboard(url: str, output_dir: str,
                     tier: str = "sb0", sample: int = 0,
                     split: bool = False) -> dict:
    """Full Layer 0: fetch storyboard sprites from YouTube.

    Args:
        url: YouTube video URL
        output_dir: Directory for output files
        tier: Resolution tier (sb0/sb1/sb2)
        sample: Sample N sheets (0=all)
        split: Whether to also split sheets into individual frames

    Returns:
        {
            "tier": str,
            "sheets": [{path, index, duration, rows, cols, ...}],
            "frames": [{path, timestamp}] (if split=True),
            "total_frames": int,
            "video_duration": float,
        }
    """
    storyboards = get_storyboard_formats(url)
    if not storyboards:
        return {"tier": "", "sheets": [], "frames": [], "total_frames": 0,
                "video_duration": 0, "error": "No storyboards available"}

    sheets = download_sprites(storyboards, output_dir, tier=tier, sample=sample)
    if not sheets:
        return {"tier": tier, "sheets": [], "frames": [], "total_frames": 0,
                "video_duration": 0, "error": "Failed to download sprites"}

    # Calculate timing
    info = storyboards.get(tier) or storyboards.get(next(iter(storyboards)))
    total_duration = sum(f.get("duration", 0) for f in info["fragments"])
    total_frames_count = len(info["fragments"]) * info["rows"] * info["columns"]
    frame_duration = total_duration / total_frames_count if total_frames_count > 0 else 10

    result = {
        "tier": tier,
        "sheets": sheets,
        "frames": [],
        "total_frames": total_frames_count,
        "video_duration": round(total_duration, 1),
        "frame_duration": round(frame_duration, 2),
    }

    if split:
        frames_dir = os.path.join(output_dir, "frames")
        all_frames = []
        elapsed = 0
        for sheet in sheets:
            sheet_frames = split_sprite_sheet(
                sheet, frames_dir,
                base_timestamp=elapsed,
                frame_duration=frame_duration,
            )
            all_frames.extend(sheet_frames)
            # Advance by sheet's actual frame count
            elapsed += sheet["rows"] * sheet["cols"] * frame_duration
        result["frames"] = all_frames

    return result


def extract_hires_frames(url: str, timestamps: list[float],
                         output_dir: str,
                         quality: str = "bestvideo[height<=720][ext=mp4]",
                         window: float = 3.0) -> list[dict]:
    """Layer 2: extract hi-res frames at specific timestamps — SURGICAL mode.

    Uses yt-dlp --download-sections to download ONLY the tiny video segment
    around each timestamp, not the entire video. This is what makes the
    pipeline work on long videos.

    Args:
        url: Video URL
        timestamps: List of seconds to capture
        output_dir: Directory for hi-res frame images
        quality: yt-dlp format selector (default: 720p max)
        window: Seconds of segment to download around timestamp (default 3s)

    Returns:
        List of {path, timestamp}
    """
    if not timestamps:
        return []

    os.makedirs(output_dir, exist_ok=True)
    frames = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for ts in sorted(timestamps):
            # Download a tiny segment around this timestamp
            seg_start = max(0, ts)
            seg_end = ts + window
            seg_path = os.path.join(tmpdir, f"seg_{ts:07.1f}.mp4")

            dl_result = subprocess.run(
                ["yt-dlp",
                 "--download-sections", f"*{seg_start}-{seg_end}",
                 "-f", quality,
                 "-o", seg_path,
                 "--no-warnings", "--force-overwrites", url],
                capture_output=True, text=True, timeout=60,
            )
            if dl_result.returncode != 0:
                print(f"  Segment download failed at {ts}s: {dl_result.stderr[:200]}",
                      file=sys.stderr)
                continue

            # Segment starts at 0 since we sliced to the timestamp
            frame_path = os.path.join(output_dir, f"hires_{ts:07.1f}.jpg")
            ff_result = subprocess.run(
                ["ffmpeg", "-ss", "0",
                 "-i", seg_path,
                 "-frames:v", "1",
                 "-q:v", "1",
                 "-loglevel", "error",
                 "-y", frame_path],
                capture_output=True, text=True, timeout=30,
            )

            if ff_result.returncode == 0 and os.path.exists(frame_path):
                frames.append({"path": frame_path, "timestamp": round(ts, 1)})
            else:
                print(f"  Frame extraction failed at {ts}s: {ff_result.stderr[:200]}",
                      file=sys.stderr)

    return frames
