"""Vault note generation — unified markdown output for all platforms.

Section-based architecture: each section is a function that returns markdown
or empty string if no data. New extraction features (chapters, comments, OCR)
add a section function and register it — no surgery needed.
"""

import re
from datetime import datetime
from pathlib import Path

from models import ExtractionResult

VAULT_DIR = Path.home() / "vault" / "knowledge" / "captures"


def sanitize_filename(text: str, max_len: int = 60) -> str:
    safe = re.sub(r'[^\w\s-]', '', text)
    safe = re.sub(r'\s+', '_', safe).strip('_')
    return safe[:max_len]


# ---------------------------------------------------------------------------
# Frontmatter
# ---------------------------------------------------------------------------

def _yaml_value(val: str) -> str:
    """Quote a YAML string value, escaping internal quotes."""
    val = val.replace('"', '\\"')
    return f'"{val}"'


def build_frontmatter(result: ExtractionResult) -> str:
    """Build valid YAML frontmatter from extraction result."""
    now = datetime.now()

    lines = [
        "---",
        f'date: "{now.strftime("%Y-%m-%d")}"',
        f'time: "{now.strftime("%H:%M")}"',
        "type: content-extract",
        f"platform: {result.platform}",
        f"content_type: {result.content_type}",
        f"content_id: {_yaml_value(result.content_id)}",
        f"source_url: {_yaml_value(result.url)}",
        f"author: {_yaml_value(result.author)}",
        f"author_id: {_yaml_value(result.author_id)}",
        f"duration: {result.duration}",
    ]

    # Engagement as proper YAML mapping
    engagement = result.engagement.to_dict()
    if engagement:
        lines.append("engagement:")
        for k, v in engagement.items():
            lines.append(f"  {k}: {v}")
    else:
        lines.append("engagement: {}")

    # Hashtags as proper YAML list
    if result.hashtags:
        lines.append("hashtags:")
        for tag in result.hashtags[:10]:
            lines.append(f"  - {_yaml_value(tag)}")
    else:
        lines.append("hashtags: []")

    lines.append(f'transcript_source: "{result.transcript_source}"')
    lines.append(f"tags: [material, content-extract, {result.platform}]")

    # Provenance: list of stages that ran
    if result.provenance:
        lines.append("pipeline_stages:")
        for stage in result.provenance:
            lines.append(f"  - stage: {stage.get('stage', 'unknown')}")
            lines.append(f"    timestamp: {_yaml_value(stage.get('timestamp', ''))}")
            lines.append(f"    status: {stage.get('status', 'success')}")
            # Render any additional details as keyed entries
            for k, v in stage.items():
                if k in ("stage", "timestamp", "status"):
                    continue
                if isinstance(v, str):
                    lines.append(f"    {k}: {_yaml_value(v)}")
                elif isinstance(v, (int, float, bool)):
                    lines.append(f"    {k}: {v}")
                # Skip complex types (dicts/lists) in frontmatter for simplicity

    lines.append("---")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Sections — each returns markdown or empty string
# ---------------------------------------------------------------------------

def section_metadata(result: ExtractionResult) -> str:
    """Core metadata block."""
    lines = [
        "## Metadata",
        "",
        f"- **Author**: {result.author} ({result.author_id})",
        f"- **Platform**: {result.platform} / {result.content_type}",
        f"- **Duration**: {result.duration}s",
    ]

    engagement = result.engagement.to_dict()
    if engagement:
        stats = " | ".join(f"**{k.title()}**: {v:,}" for k, v in engagement.items())
        lines.append(f"- {stats}")

    if result.upload_date:
        lines.append(f"- **Uploaded**: {result.upload_date}")

    return "\n".join(lines)


def section_caption(result: ExtractionResult) -> str:
    """Caption / description."""
    if not result.description:
        return ""
    return f"## Caption\n\n{result.description}"


def section_transcript(result: ExtractionResult) -> str:
    """Full transcript."""
    if not result.has_transcript:
        return ""
    return f"## Transcript\n\n{result.transcript}"


def section_source_context(result: ExtractionResult) -> str:
    """Source context — who sent this URL and where."""
    if not result.source_context:
        return ""
    ctx = result.source_context
    lines = ["## Source Context", ""]
    lines.append(f"- **Sent by**: {ctx.sender}")
    if ctx.message:
        lines.append(f"- **Message**: {ctx.message}")
    if ctx.chat:
        lines.append(f"- **Chat**: {ctx.chat}")
    lines.append(f"- **Via**: {ctx.platform}")
    return "\n".join(lines)


def section_chapters(result: ExtractionResult) -> str:
    """Video chapters (YouTube)."""
    if not result.chapters:
        return ""
    lines = ["## Chapters", ""]
    for ch in result.chapters:
        start = ch.get("start_time", 0)
        minutes = int(start // 60)
        seconds = int(start % 60)
        lines.append(f"- `{minutes:02d}:{seconds:02d}` {ch.get('title', '')}")
    return "\n".join(lines)


def section_comments(result: ExtractionResult) -> str:
    """Top comments (YouTube)."""
    if not result.comments:
        return ""
    lines = ["## Top Comments", ""]
    for c in result.comments:
        author = c.get("author", "")
        text = c.get("text", "").replace("\n", " ").strip()
        likes = c.get("like_count", 0)
        like_str = f" ({likes:,} likes)" if likes > 0 else ""
        lines.append(f"> **{author}**{like_str}: {text}")
        lines.append("")  # blank line between blockquotes
    return "\n".join(lines)


def section_links(result: ExtractionResult) -> str:
    """Links extracted from the description, categorized and prioritized."""
    if not result.links or result.links.get("total", 0) == 0:
        return ""

    lines = ["## Referenced Links", ""]

    categories = [
        ("github", "Repositories"),
        ("paper", "Papers"),
        ("docs", "Documentation"),
        ("tool", "Tools & Services"),
        ("video", "Related Videos"),
        ("article", "Articles"),
        ("website", "Websites"),
        ("social", "Social"),
    ]

    for key, label in categories:
        items = result.links.get(key, [])
        if not items:
            continue
        lines.append(f"### {label}")
        lines.append("")
        for item in items:
            if isinstance(item, dict):
                lines.append(f"- [{item.get('full_name', item['url'])}]({item['url']})")
            else:
                lines.append(f"- {item}")
        lines.append("")

    # Research findings (when links have been investigated)
    if result.link_research:
        lines.append("### Research Findings")
        lines.append("")
        for finding in result.link_research:
            url = finding.get("url", "")
            summary = finding.get("summary", "")
            lines.append(f"- **{url}**")
            if summary:
                lines.append(f"  {summary}")
        lines.append("")

    return "\n".join(lines)


def section_visual(result: ExtractionResult) -> str:
    """Visual analysis from storyboard triage."""
    if not result.visual_triage and not result.visual_summary:
        return ""

    lines = ["## Visual Analysis", ""]

    if result.visual_summary:
        lines.append(result.visual_summary)
        lines.append("")

    if result.visual_content_flags:
        lines.append(f"**Content types detected**: {', '.join(result.visual_content_flags)}")
        lines.append("")

    flagged = [f for f in result.visual_triage if f.get("has_readable_content")]
    if flagged:
        lines.append("### Key Visual Frames")
        lines.append("")
        for f in flagged:
            ts = f.get("timestamp", 0)
            minutes = int(ts // 60)
            seconds = int(ts % 60)
            classification = f.get("classification", "")
            desc = f.get("description", "")
            lines.append(f"- `{minutes:02d}:{seconds:02d}` [{classification}] {desc}")
        lines.append("")

    if result.hires_frames:
        lines.append("### Extracted Content")
        lines.append("")
        for frame in result.hires_frames:
            ts = frame.get("timestamp", 0)
            minutes = int(ts // 60)
            seconds = int(ts % 60)
            analysis = frame.get("analysis", "")
            lines.append(f"#### `{minutes:02d}:{seconds:02d}`")
            lines.append("")
            if analysis:
                lines.append(analysis)
                lines.append("")

    return "\n".join(lines)


def section_ocr(result: ExtractionResult) -> str:
    """On-screen text extracted via OCR from video frames."""
    if not result.ocr_text:
        return ""
    lines = ["## On-Screen Text", ""]
    for entry in result.ocr_text:
        ts = entry.get("timestamp", 0)
        minutes = int(ts // 60)
        seconds = int(ts % 60)
        text = entry.get("text", "").strip()
        lines.append(f"### `{minutes:02d}:{seconds:02d}`")
        lines.append("```")
        lines.append(text)
        lines.append("```")
        lines.append("")
    return "\n".join(lines)


# Section registry — ordered list of (section_fn,).
# New features append here. Each function takes ExtractionResult, returns str.
SECTIONS = [
    section_metadata,
    section_chapters,
    section_caption,
    section_links,
    section_transcript,
    section_visual,
    section_ocr,
    section_comments,
    section_source_context,
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_vault_note(result: ExtractionResult) -> str:
    """Generate vault-compatible markdown from an extraction result."""
    parts = [build_frontmatter(result), "", result.url, ""]

    for section_fn in SECTIONS:
        content = section_fn(result)
        if content:
            parts.append(content)
            parts.append("")  # blank line between sections

    return "\n".join(parts)


def save_vault_note(result: ExtractionResult, vault_dir: str | None = None) -> str:
    """Save extraction result as a vault note. Returns the file path."""
    target_dir = Path(vault_dir) if vault_dir else VAULT_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    author_safe = sanitize_filename(result.author_id or result.author or "unknown", 30)
    filename = f"{now.strftime('%Y%m%d-%H%M')}-{result.platform}-{author_safe}-{result.content_id}.md"

    note_content = generate_vault_note(result)
    note_path = target_dir / filename
    note_path.write_text(note_content)

    result.vault_path = str(note_path)
    return str(note_path)
