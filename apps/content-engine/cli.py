#!/usr/bin/env python3
"""Content Engine CLI — extract content from any social media URL.

Usage:
    python3 cli.py <url>                          # Full extraction
    python3 cli.py <url> --metadata-only          # Fast metadata only
    python3 cli.py <url> --vault                  # Extract + save to vault
    python3 cli.py <url> --vault-dir ~/custom/    # Custom vault location
    python3 cli.py --batch urls.txt --vault       # Batch process URLs from file

Visual extraction (storyboards):
    python3 cli.py <url> --storyboard             # Fetch YouTube storyboard sprites
    python3 cli.py <url> --storyboard --split     # Also split into individual frames
    python3 cli.py <url> --hires-frames 12.0,45.0 # Extract hi-res frames at timestamps
"""

import argparse
import json
import sys
from pathlib import Path

from engine import extract, extract_metadata_only


def main():
    parser = argparse.ArgumentParser(description="Content Engine — social media extraction")
    parser.add_argument("url", nargs="?", help="URL to extract")
    parser.add_argument("--metadata-only", action="store_true",
                        help="Only extract metadata, skip transcription")
    parser.add_argument("--vault", action="store_true",
                        help="Save result as vault markdown note")
    parser.add_argument("--vault-dir", default=None,
                        help="Custom vault directory")
    parser.add_argument("--model", default="medium",
                        help="Whisper model size (tiny/base/small/medium/large)")
    parser.add_argument("--batch", default=None,
                        help="File containing URLs (one per line)")
    parser.add_argument("--force", action="store_true",
                        help="Reprocess even if already extracted")
    parser.add_argument("--no-ocr", action="store_true",
                        help="Skip video frame OCR (faster)")
    parser.add_argument("--json", action="store_true", dest="json_output",
                        help="Output as JSON")

    # Visual extraction (storyboards)
    parser.add_argument("--storyboard", action="store_true",
                        help="Fetch YouTube storyboard sprites for visual triage")
    parser.add_argument("--storyboard-tier", default="sb0",
                        choices=["sb0", "sb1", "sb2"],
                        help="Resolution: sb0=320x180, sb1=160x90, sb2=80x45")
    parser.add_argument("--storyboard-sample", type=int, default=0,
                        help="Sample N sprite sheets (0=all)")
    parser.add_argument("--storyboard-out", default=None,
                        help="Output directory for sprites (default: /tmp/ce-visual-{id})")
    parser.add_argument("--split", action="store_true",
                        help="Split sprite sheets into individual frames")
    parser.add_argument("--hires-frames", default=None,
                        help="Comma-separated timestamps for hi-res frame extraction")
    parser.add_argument("--visual-triage-json", default=None,
                        help="JSON string with visual triage data to merge into vault note")
    parser.add_argument("--visual-triage-file", default=None,
                        help="Path to JSON file with visual triage data (preferred over --visual-triage-json for large payloads)")

    # Link extraction
    parser.add_argument("--extract-links", action="store_true",
                        help="Extract and categorize URLs from description")

    # Merge-only mode (update existing vault note with visual data)
    parser.add_argument("--update-vault", default=None,
                        help="Path to existing vault note. Merges visual triage / link research "
                             "data without re-extracting metadata or transcript.")

    # Transcript alignment (shown-but-not-said helper)
    parser.add_argument("--align-transcript", action="store_true",
                        help="Fetch transcript, split storyboard, and output an alignment table "
                             "mapping each sprite frame timestamp to the spoken text near it. "
                             "Used for 'shown but not said' detection.")

    args = parser.parse_args()

    if not args.url and not args.batch:
        parser.print_help()
        sys.exit(1)

    # --- Storyboard mode: fetch sprites and exit ---
    if args.storyboard and args.url:
        from storyboard import fetch_storyboard
        from detect import detect_platform

        _, content_id, _ = detect_platform(args.url)
        out_dir = args.storyboard_out or f"/tmp/ce-visual-{content_id or 'unknown'}"

        result = fetch_storyboard(
            args.url, out_dir,
            tier=args.storyboard_tier,
            sample=args.storyboard_sample,
            split=args.split,
        )
        print(json.dumps(result, indent=2))
        sys.exit(0)

    # --- Merge-only mode: update existing vault note with triage data ---
    if args.update_vault:
        from pathlib import Path
        note_path = Path(args.update_vault).expanduser()
        if not note_path.exists():
            print(f"Vault note not found: {note_path}", file=sys.stderr)
            sys.exit(1)

        # Load triage data
        vdata = None
        if args.visual_triage_file:
            try:
                with open(args.visual_triage_file) as f:
                    vdata = json.load(f)
            except Exception as e:
                print(f"Failed to load triage file: {e}", file=sys.stderr)
                sys.exit(1)
        elif args.visual_triage_json:
            try:
                vdata = json.loads(args.visual_triage_json)
            except Exception as e:
                print(f"Invalid triage JSON: {e}", file=sys.stderr)
                sys.exit(1)

        if not vdata:
            print("No triage data provided. Use --visual-triage-file or --visual-triage-json",
                  file=sys.stderr)
            sys.exit(1)

        # Build the visual section markdown directly and splice into note
        content = note_path.read_text()

        # Append provenance stages to existing frontmatter
        from datetime import datetime
        import re as _re
        now_ts = datetime.now().isoformat(timespec="seconds")
        new_stages = []
        if vdata.get("triage"):
            new_stages.append({
                "stage": "visual_triage",
                "timestamp": now_ts,
                "status": "success",
                "frames": len(vdata["triage"]),
                "flagged": sum(1 for f in vdata["triage"] if f.get("has_readable_content")),
            })
        if vdata.get("hires_frames"):
            new_stages.append({
                "stage": "visual_hires",
                "timestamp": now_ts,
                "status": "success",
                "count": len(vdata["hires_frames"]),
            })
        if vdata.get("link_research"):
            new_stages.append({
                "stage": "link_research",
                "timestamp": now_ts,
                "status": "success",
                "count": len(vdata["link_research"]),
            })

        if new_stages:
            fm_match = _re.match(r"^(---\n)(.*?)(\n---\n)", content, _re.DOTALL)
            if fm_match:
                fm_body = fm_match.group(2)
                # Check if pipeline_stages block exists
                if "pipeline_stages:" in fm_body:
                    # Append new entries at end of pipeline_stages block
                    stage_lines = []
                    for s in new_stages:
                        stage_lines.append(f"  - stage: {s['stage']}")
                        stage_lines.append(f"    timestamp: \"{s['timestamp']}\"")
                        stage_lines.append(f"    status: {s['status']}")
                        for k, v in s.items():
                            if k in ("stage", "timestamp", "status"):
                                continue
                            stage_lines.append(f"    {k}: {v}")
                    # Insert at end of frontmatter (before closing ---)
                    new_fm = fm_body.rstrip() + "\n" + "\n".join(stage_lines)
                    content = fm_match.group(1) + new_fm + fm_match.group(3) + content[fm_match.end():]
                else:
                    # Add pipeline_stages block
                    stage_lines = ["pipeline_stages:"]
                    for s in new_stages:
                        stage_lines.append(f"  - stage: {s['stage']}")
                        stage_lines.append(f"    timestamp: \"{s['timestamp']}\"")
                        stage_lines.append(f"    status: {s['status']}")
                        for k, v in s.items():
                            if k in ("stage", "timestamp", "status"):
                                continue
                            stage_lines.append(f"    {k}: {v}")
                    new_fm = fm_body.rstrip() + "\n" + "\n".join(stage_lines)
                    content = fm_match.group(1) + new_fm + fm_match.group(3) + content[fm_match.end():]

        # Generate visual section from vdata
        lines = ["## Visual Analysis", ""]
        if vdata.get("summary"):
            lines.append(vdata["summary"])
            lines.append("")
        if vdata.get("flags"):
            lines.append(f"**Content types detected**: {', '.join(vdata['flags'])}")
            lines.append("")

        flagged = [f for f in vdata.get("triage", []) if f.get("has_readable_content")]
        if flagged:
            lines.append("### Key Visual Frames")
            lines.append("")
            for f in flagged:
                ts = f.get("timestamp", 0)
                m, s = int(ts // 60), int(ts % 60)
                cls = f.get("classification", "")
                desc = f.get("description", "")
                lines.append(f"- `{m:02d}:{s:02d}` [{cls}] {desc}")
            lines.append("")

        if vdata.get("hires_frames"):
            lines.append("### Extracted Content")
            lines.append("")
            for frame in vdata["hires_frames"]:
                ts = frame.get("timestamp", 0)
                m, s = int(ts // 60), int(ts % 60)
                analysis = frame.get("analysis", "")
                lines.append(f"#### `{m:02d}:{s:02d}`")
                lines.append("")
                if analysis:
                    lines.append(analysis)
                    lines.append("")

        new_visual_section = "\n".join(lines)

        # Replace existing Visual Analysis section or insert before OCR/Comments
        import re
        visual_pattern = re.compile(r"^## Visual Analysis.*?(?=^## |\Z)", re.MULTILINE | re.DOTALL)
        if visual_pattern.search(content):
            content = visual_pattern.sub(new_visual_section + "\n\n", content)
        else:
            # Insert before ## On-Screen Text, ## Top Comments, or at end
            insert_before = re.compile(r"^## (?:On-Screen Text|Top Comments|Source Context)", re.MULTILINE)
            m = insert_before.search(content)
            if m:
                content = content[:m.start()] + new_visual_section + "\n\n" + content[m.start():]
            else:
                content = content.rstrip() + "\n\n" + new_visual_section + "\n"

        note_path.write_text(content)
        print(f"Updated vault note: {note_path}", file=sys.stderr)
        print(json.dumps({"updated": str(note_path), "visual_frames_added": len(vdata.get("triage", []))}))
        sys.exit(0)

    # --- Link extraction mode: metadata + categorized URLs from description ---
    if args.extract_links and args.url:
        from links import extract_and_categorize, research_priority

        result = extract_metadata_only(args.url)
        if not result:
            sys.exit(1)

        categorized = extract_and_categorize(result.description or "")
        ranked = research_priority(categorized)

        output = {
            "title": result.title,
            "author": result.author,
            "description": result.description,
            "links": categorized,
            "research_priority": ranked,
        }
        print(json.dumps(output, indent=2))
        sys.exit(0)

    # --- Transcript alignment mode (shown-but-not-said helper) ---
    if args.align_transcript and args.url:
        from storyboard import fetch_storyboard
        from transcribe import transcribe_url
        from transcript_align import build_alignment_table
        from detect import detect_platform
        from platforms import get_handler

        _, content_id, content_type = detect_platform(args.url)
        platform_name, _, _ = detect_platform(args.url)
        handler = get_handler(platform_name)

        # Step 1: metadata (for chapters)
        metadata_result = handler.extract_metadata(args.url, content_id, content_type) if handler else None

        # Step 2: transcript
        print("  Fetching transcript...", file=sys.stderr)
        transcript, source = transcribe_url(
            args.url, platform=platform_name, content_id=content_id, model=args.model
        )

        # Step 3: sprite fetch + split
        out_dir = args.storyboard_out or f"/tmp/ce-visual-{content_id or 'unknown'}"
        print("  Fetching storyboard...", file=sys.stderr)
        sb = fetch_storyboard(
            args.url, out_dir,
            tier=args.storyboard_tier,
            sample=args.storyboard_sample,
            split=True,
        )

        # Step 4: align
        chapters = metadata_result.chapters if metadata_result else []
        table = build_alignment_table(transcript or "", sb["frames"], chapters)

        print(json.dumps({
            "title": metadata_result.title if metadata_result else "",
            "duration": metadata_result.duration if metadata_result else 0,
            "chapters": chapters,
            "transcript_source": source,
            "sprite_tier": sb["tier"],
            "sheets": [{"path": s["path"], "index": s["index"]} for s in sb["sheets"]],
            "alignment": table,
        }, indent=2))
        sys.exit(0)

    # --- Hi-res frame extraction mode ---
    if args.hires_frames and args.url:
        from storyboard import extract_hires_frames
        from detect import detect_platform

        _, content_id, _ = detect_platform(args.url)
        out_dir = args.storyboard_out or f"/tmp/ce-visual-{content_id or 'unknown'}/hires"

        timestamps = [float(t.strip()) for t in args.hires_frames.split(",")]
        frames = extract_hires_frames(args.url, timestamps, out_dir)
        print(json.dumps(frames, indent=2))
        sys.exit(0)

    # Collect URLs to process
    urls = []
    if args.batch:
        batch_file = Path(args.batch)
        if not batch_file.exists():
            print(f"Batch file not found: {args.batch}", file=sys.stderr)
            sys.exit(1)
        for line in batch_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)
        print(f"Batch: {len(urls)} URLs to process")
    else:
        urls.append(args.url)

    results = []
    for url in urls:
        if args.metadata_only:
            result = extract_metadata_only(url)
        else:
            result = extract(
                url,
                save_to_vault=args.vault,
                vault_dir=args.vault_dir,
                whisper_model=args.model,
                skip_transcript=args.metadata_only,
                skip_ocr=args.no_ocr,
                force=args.force,
            )

        # Merge visual triage data if provided
        vdata = None
        if result and args.visual_triage_file:
            try:
                with open(args.visual_triage_file) as f:
                    vdata = json.load(f)
            except (OSError, json.JSONDecodeError) as e:
                print(f"Failed to load visual triage file: {e}", file=sys.stderr)
        elif result and args.visual_triage_json:
            try:
                vdata = json.loads(args.visual_triage_json)
            except json.JSONDecodeError as e:
                print(f"Invalid visual triage JSON: {e}", file=sys.stderr)

        if result and vdata:
            result.visual_summary = vdata.get("summary", "")
            result.visual_triage = vdata.get("triage", [])
            result.visual_content_flags = vdata.get("flags", [])
            result.hires_frames = vdata.get("hires_frames", [])
            # Re-save vault note with merged visual data
            if args.vault and result.vault_path:
                from vault import save_vault_note
                save_vault_note(result, vault_dir=args.vault_dir)

        if result:
            results.append(result)

            if args.json_output:
                print(json.dumps(result.to_dict(), indent=2))
            else:
                print(f"\n{'='*60}")
                print(f"Platform:  {result.platform} / {result.content_type}")
                print(f"Author:    {result.author} ({result.author_id})")
                print(f"Title:     {result.title[:80]}")
                print(f"Duration:  {result.duration}s")
                if result.engagement.to_dict():
                    eng = result.engagement.to_dict()
                    print(f"Engagement: {', '.join(f'{k}={v:,}' for k, v in eng.items())}")
                if result.description:
                    desc = result.description[:200]
                    print(f"Caption:   {desc}{'...' if len(result.description) > 200 else ''}")
                if result.has_transcript:
                    print(f"Transcript: {len(result.transcript)} chars ({result.transcript_source})")
                if result.vault_path:
                    print(f"Vault:     {result.vault_path}")
                if result.needs_fallback:
                    print(f"FALLBACK_NEEDED: {result.fallback_reason}")
                print(f"{'='*60}")
        else:
            print(f"Failed or skipped: {url}", file=sys.stderr)

    print(f"\nProcessed {len(results)}/{len(urls)} URLs")


if __name__ == "__main__":
    main()
