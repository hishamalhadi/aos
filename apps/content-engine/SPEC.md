# Content Engine — User Spec

> The AOS content extraction pipeline. Three-layer research system for YouTube / Instagram / TikTok / X.

Extract metadata, transcripts, visual frames, and description links from any social media URL — then synthesize them into a vault note. Zero cost by default (all free tools). Runs locally on Apple Silicon.

---

## The Three Research Layers

### Layer 1: Transcript + Metadata (always free, ~2s)
- YouTube captions (free, instant) → mlx-whisper (local, Apple Silicon) → openai-whisper (fallback)
- Metadata via `yt-dlp --dump-json`
- Description links auto-extracted and categorized (github, video, paper, docs, tool, article, website, social)

### Layer 2: Visual Frames (free on YouTube, ~30s)
- YouTube storyboard sprites — pre-generated thumbnail grids (free, ~1MB for 30-min video)
- Claude triages frames using its own vision (no external VLM)
- Surgical hi-res extraction only for flagged frames (yt-dlp `--download-sections` → ffmpeg)
- "Shown but not said" detection: transcript alignment table makes this efficient

### Layer 3: Link Research (free, varies)
- Auto-extract URLs from description
- Priority-ranked for Claude to investigate (github repos first, social last)
- Clone repos, fetch papers, visit tool pages
- Findings merged back into vault note

---

## Quick Start

### "What's this about?" (quick question)
```bash
cd ~/aos/apps/content-engine
python3 cli.py "https://youtu.be/VIDEO_ID"
```
No `--vault`, no flags. Metadata + transcript, summarize in-chat. Done in ~5s.

### "Save this to my vault"
```bash
python3 cli.py "https://youtu.be/VIDEO_ID" --vault
```
Full extraction → markdown note in `~/vault/knowledge/captures/`.

### "Research this video thoroughly"
Triggers the full three-layer pipeline. Best done through the `/extract` skill — Claude orchestrates automatically based on your intent. From the CLI directly, it's a 4-step dance (see "Full workflow" below).

---

## CLI Reference

### Extraction modes (pick one)

| Flag | What it does |
|------|-------------|
| *(no flag)* | Full extraction: metadata + comments + transcript + OCR |
| `--metadata-only` | Fast — metadata + links only, no transcript or OCR |
| `--storyboard` | Layer 2 Phase 1 — fetch YouTube storyboard sprites |
| `--extract-links` | Extract and categorize URLs from description, output JSON |
| `--align-transcript` | Fetch transcript + storyboard and output frame→spoken-text alignment table |
| `--hires-frames "t1,t2,t3"` | Layer 2 Phase 3 — extract hi-res frames at specific timestamps |
| `--update-vault PATH` | Merge visual triage data into an existing vault note (no re-extraction) |

### Modifier flags

| Flag | Default | What it does |
|------|---------|-------------|
| `--vault` | off | Save result to vault note after extraction |
| `--vault-dir PATH` | `~/vault/knowledge/captures/` | Custom vault location |
| `--force` | off | Reprocess even if already extracted (overrides dedup) |
| `--no-ocr` | off | Skip legacy video frame OCR (faster) |
| `--model SIZE` | `medium` | Whisper model size (tiny/base/small/medium/large) |
| `--json` | off | Output result as JSON instead of human-readable |
| `--batch FILE` | — | Process URLs from a file (one per line) |

### Storyboard modifiers

| Flag | Default | What it does |
|------|---------|-------------|
| `--storyboard-tier` | `sb0` | Resolution: `sb0` (320x180, 3x3), `sb1` (160x90, 5x5), `sb2` (80x45, 10x10) |
| `--storyboard-sample N` | `0` (all) | Sample N sprite sheets evenly across video |
| `--storyboard-out PATH` | `/tmp/ce-visual-{id}` | Output directory for sprites |
| `--split` | off | Also split sprite sheets into individual frames with timestamps |

### Visual triage injection

| Flag | What it does |
|------|-------------|
| `--visual-triage-file PATH` | Load triage JSON from file (preferred for large payloads) |
| `--visual-triage-json '{...}'` | Inline JSON string (avoid for large payloads — shell escaping) |

---

## What Gets Saved

Every vault note has these sections (empty sections are omitted):

```
---
YAML frontmatter
  + pipeline_stages (provenance tracking — see below)
---

## Metadata           — author, platform, duration, engagement
## Chapters           — if the video has chapters
## Caption            — description / caption
## Referenced Links   — categorized URLs from description
    ### Repositories  — github links (highest priority)
    ### Papers        — arxiv, doi
    ### Documentation
    ### Tools & Services
    ### Related Videos
    ### Articles
    ### Websites
    ### Social
    ### Research Findings  — Claude's notes after investigating
## Transcript         — full timestamped text
## Visual Analysis    — Claude's visual findings
    Summary + content flags
    ### Key Visual Frames       — flagged timestamps with descriptions
    ### Extracted Content       — hi-res frame analysis
## On-Screen Text     — legacy OCR results (if run)
## Top Comments       — YouTube only
## Source Context     — if URL came from a message (WhatsApp, Telegram, etc.)
```

---

## Provenance Tracking

Every vault note includes a `pipeline_stages` list in frontmatter that records exactly which stages ran, when, and with what results. This lets future sessions:

- **Know what's in the note** without re-running extraction
- **Re-run only missing stages** (e.g., transcript exists but visual triage doesn't)
- **Audit how the note was built** — timestamps, costs, failure points

Example:
```yaml
pipeline_stages:
  - stage: metadata
    timestamp: "2026-04-09T10:15:00"
    status: success
    source: "yt-dlp"
    platform: youtube
  - stage: links
    timestamp: "2026-04-09T10:15:00"
    status: success
    total: 11
    github: 1
    videos: 2
    articles: 3
  - stage: transcript
    timestamp: "2026-04-09T10:15:03"
    status: success
    source: "captions"
    chars: 46898
  - stage: comments
    timestamp: "2026-04-09T10:15:04"
    status: success
    count: 20
  - stage: visual_triage
    timestamp: "2026-04-09T10:17:25"
    status: success
    frames: 22
    flagged: 9
  - stage: visual_hires
    timestamp: "2026-04-09T10:17:55"
    status: success
    count: 9
  - stage: link_research
    timestamp: "2026-04-09T10:20:10"
    status: success
    count: 3
```

**Stages that can appear:**

| Stage | When |
|-------|------|
| `metadata` | Always (first step) |
| `links` | Always if description has URLs |
| `transcript` | When transcription runs |
| `comments` | YouTube full extraction only |
| `ocr` | Legacy: when `--no-ocr` not set |
| `visual_triage` | When Claude's triage data is merged via `--visual-triage-file` |
| `visual_hires` | When hi-res frames are extracted and referenced in triage data |
| `link_research` | When Claude's link research is merged |

**Failure states:** stages can also record `status: failed` with an `error` field, or `status: skipped` with a `reason` field. This makes debugging and re-running much easier.

---

## Full Workflow — The Three-Layer Research Dance

This is what the `/extract` skill does automatically when you ask Claude to "research this video". You can also run it manually.

### Step 1: Initial extraction
```bash
python3 cli.py "https://youtu.be/VIDEO_ID" --vault --force --json > /tmp/extract.json
VAULT_PATH=$(jq -r .vault_path /tmp/extract.json)
CONTENT_ID=$(jq -r .content_id /tmp/extract.json)
```
This runs Layer 1 (metadata + links + transcript + comments) and saves a vault note. You get:
- `vault_path` → the markdown file
- `content_id` → used for temp directory naming
- `links` → categorized URLs with research priorities

### Step 2: Transcript alignment (for "shown but not said")
```bash
python3 cli.py "https://youtu.be/VIDEO_ID" --align-transcript \
    --storyboard-tier sb0 > /tmp/alignment-$CONTENT_ID.json
```
Downloads sprites, splits into frames, aligns each frame timestamp with what was being said at that moment. Output:
```json
{
  "sheets": [{"path": "/tmp/ce-visual-xxx/sprite_000.jpg", ...}],
  "alignment": [
    {
      "timestamp": 0.0,
      "frame_path": "/tmp/ce-visual-xxx/frames/frame_00000.0.jpg",
      "chapter": "Intro",
      "is_chapter_boundary": true,
      "spoken": "What's up engineers...",
      "context_before": "",
      "context_after": "faster than any product..."
    }
  ]
}
```

### Step 3: Visual triage (Claude is the VLM)
Claude reads each sprite sheet via the Read tool (Claude is multimodal — can see JPEGs directly). For each frame:
1. Classify the visual content: `talking_head` / `code_on_screen` / `slide` / `website` / `title_card` / `screen_recording` / `b_roll`
2. Cross-reference with the alignment `spoken` field
3. Flag any frame where the visual conveys info the speaker *doesn't* verbalize
4. Write triage results to a file:

```bash
cat > /tmp/triage-$CONTENT_ID.json << 'EOF'
{
  "summary": "Video alternates between talking head and live coding...",
  "flags": ["has_code", "has_screen_recording", "has_diagrams"],
  "triage": [
    {"timestamp": 270, "classification": "code_on_screen", "has_readable_content": true, "description": "Agent team config YAML"},
    {"timestamp": 660, "classification": "code_on_screen", "has_readable_content": true, "description": "Orchestrator prompt"}
  ]
}
EOF
```

### Step 4: Hi-res extraction on flagged frames
```bash
python3 cli.py "https://youtu.be/VIDEO_ID" \
    --hires-frames "270,660,1080" \
    --storyboard-out /tmp/ce-visual-$CONTENT_ID/hires
```
Downloads only the 3-second segments around each timestamp, extracts 720p frames. Claude reads each hi-res frame and extracts the actual content (code, slide text, diagrams).

Update the triage file with `hires_frames` analysis:
```json
{
  ...,
  "hires_frames": [
    {"timestamp": 270, "analysis": "Agent config: model: claude-sonnet-4-6, skills: [mental-model.md, active-listener.md]..."}
  ]
}
```

### Step 5: Merge into vault note
```bash
python3 cli.py "https://youtu.be/VIDEO_ID" \
    --update-vault "$VAULT_PATH" \
    --visual-triage-file /tmp/triage-$CONTENT_ID.json
```
Replaces the Visual Analysis section (idempotent — safe to re-run), appends `visual_triage` and `visual_hires` stages to `pipeline_stages`. **Does not re-extract** anything.

### Step 6: Link research (optional, for research intent)
For each high-priority link (github repos first), Claude fetches/clones and reads the content, then writes findings to a file:
```json
{
  "link_research": [
    {"url": "https://github.com/disler/pi-vs-claude-code", "summary": "MIT-licensed Pi extension playground with 16 extensions..."}
  ]
}
```
Merge with another `--update-vault` call.

---

## Common Operations

### Extract a video I just watched, save to vault
```bash
python3 cli.py "URL" --vault
```

### See what links are in a video's description without downloading it
```bash
python3 cli.py "URL" --extract-links
```

### Get just the transcript
```bash
python3 cli.py "URL" --metadata-only
# or for full transcript + no OCR:
python3 cli.py "URL" --no-ocr
```

### Preview visual content without doing full research
```bash
python3 cli.py "URL" --storyboard --storyboard-sample 6
# Read the sprite paths from JSON, look at the 6 sheets
```

### Update an existing vault note with new visual findings
```bash
python3 cli.py "URL" --update-vault ~/vault/knowledge/captures/NOTE.md \
    --visual-triage-file /path/to/triage.json
```

### Batch process a list of URLs
```bash
echo "https://youtu.be/abc
https://youtu.be/xyz
https://instagram.com/reel/123" > urls.txt
python3 cli.py --batch urls.txt --vault
```

---

## Supported Platforms

| Platform | Metadata | Transcript | Visual triage | Comments |
|----------|----------|------------|--------------|----------|
| YouTube | ✅ Full | ✅ Captions + Whisper | ✅ Storyboards (free) | ✅ Top 20 |
| Instagram | ✅ Full | ✅ Whisper only | ❌ No storyboards | — |
| TikTok | 🟡 Best-effort (may need Chrome fallback) | ✅ Whisper | ❌ No storyboards | — |
| X / Twitter | 🟡 Video tweets only (text tweets need Chrome) | ✅ Whisper | ❌ No storyboards | — |

For non-YouTube platforms, the visual layer falls back to legacy OCR (downloads video, extracts frames via ffmpeg, runs Surya OCR).

---

## Cost & Performance

Measured on a 32-minute YouTube video (IndyDevDan, "My Pi Agent Teams"):

| Step | Cost | Time | Data |
|------|------|------|------|
| Metadata + links | $0 | 2s | 5KB |
| Comments (top 20) | $0 | 2s | 10KB |
| Transcript (captions) | $0 | 3s | 47KB |
| Storyboard fetch (22 sheets at sb0) | $0 | 2s | 1.1MB |
| Transcript alignment | $0 | <1s | — |
| Visual triage (Claude's own vision) | $0* | 10s | — |
| Hi-res frames (9 timestamps) | $0 | 45s | 1.1MB |
| Vault note generation | $0 | <1s | — |
| **TOTAL** | **$0** | **~65s** | **~2.3MB** |

*Visual triage is "free" because Claude is already running in your session — it uses the same tokens your conversation uses. Not metered separately.

Compare to the naive approach: download the 500MB video, extract 200 frames, send each to an external VLM API → ~$2-5, 5-10 minutes, 500MB+ data.

---

## When to Use Each Mode

| Your situation | Recommended flags |
|---------------|-------------------|
| Someone sent me a video link, what's it about? | *(no flags)* or `--metadata-only` |
| I want to save this to my vault | `--vault` |
| This is a technical video I want to deeply understand | Full workflow (Steps 1-6 above) — or just ask Claude "research this video" |
| I want to see the code/slides in the video | `--storyboard` + `--align-transcript` + `--hires-frames` |
| I only care about links the creator referenced | `--extract-links` |
| I want to update an existing note with new info | `--update-vault` |
| Batch processing a reading list | `--batch urls.txt --vault` |

---

## Integration with AOS

### The `/extract` skill
Ask Claude to "research this video" or paste any social media URL, and the `/extract` skill automatically runs the appropriate workflow based on your intent:
- **Quick question** → Layer 1 only + sample storyboard glance
- **Research** → Full Layer 1 + 2 + 3 cascade
- **Deep research** → Denser storyboard grid + full hi-res extraction + all link investigation
- **Transcribe** → Layer 1 only, show transcript
- **Capture** → Layer 1 + save, skip visual

See `core/skills/extract/SKILL.md` for orchestration details.

### Vault integration
- Notes land in `~/vault/knowledge/captures/` by default
- QMD indexes them within 30 minutes
- Findable via `/recall "topic"` or semantic search
- Frontmatter `tags: [material, content-extract, youtube]` for filtering

### Initiative linking
If `operator.yaml → initiatives.enabled: true`, the skill can offer to link extracted content to active research initiatives (opt-in, always asks first).

### Dedup
URLs are tracked in `~/.aos/dedup/content-engine.jsonl`. Re-processing the same URL is a no-op unless you pass `--force`.

---

## Troubleshooting

### "Already processed" message when I want to re-extract
```bash
python3 cli.py "URL" --vault --force
```

### Transcript is missing for a YouTube video
Captions weren't available. Check if mlx-whisper is installed:
```bash
pip show mlx-whisper
```
If not, install it: `pip install mlx-whisper`

### Hi-res extraction fails / times out
The old code downloaded the full video (fails on long videos). This was fixed — if you see this, update the repo.

### "No storyboards available"
The video may be too short or too new (YouTube generates storyboards asynchronously). Short videos (<30s) may not have them at all. Fall back to `--no-ocr` or skip visual extraction.

### Visual triage data missing from vault note
Check the pipeline_stages in frontmatter. If `visual_triage` isn't there, Claude didn't run Step 3+5 of the full workflow. The `/extract` skill should do this automatically for research intent.

### Sprite sheets have fuzzy text
That's expected at sb0 (320x180 per frame). For readable code/slides, use the hi-res extraction step (`--hires-frames`). For a denser triage grid, use `--storyboard-tier sb1` (160x90 per frame, 5x5 grid = 25 frames per sheet).

---

## File Reference

```
apps/content-engine/
├── cli.py              ← argparse entry point, mode routing
├── engine.py           ← extract() orchestrator, provenance tracking
├── detect.py           ← URL → platform routing
├── platforms/
│   ├── youtube.py      ← yt-dlp metadata + comments
│   ├── instagram.py
│   ├── tiktok.py
│   └── twitter.py
├── transcribe.py       ← YouTube captions → mlx-whisper → openai-whisper
├── storyboard.py       ← Sprite fetch + split + hi-res extraction
├── links.py            ← URL extraction + categorization + priority
├── transcript_align.py ← Frame-to-transcript alignment for "shown but not said"
├── ocr.py              ← Legacy video frame OCR (Surya)
├── models.py           ← ExtractionResult dataclass with provenance
├── vault.py            ← Section registry + markdown generation
├── dedup.py            ← JSONL-based URL tracking
└── SPEC.md             ← This file

core/skills/extract/
└── SKILL.md            ← Claude's orchestration logic
```

---

## Philosophy

1. **Cascading cost** — each layer is cheaper than the next. Never escalate until the cheaper layer proves insufficient.
2. **Claude is the VLM** — no external vision models. Claude's multimodal capability does the triage. Zero marginal cost.
3. **Intent shapes depth** — quick questions don't need deep research; research doesn't need surgical extraction.
4. **Surgical over exhaustive** — only extract the frames that matter. Most videos need 5-10 hi-res frames, not 200.
5. **"Shown but not said" is the signal** — the entire visual pipeline's purpose is to capture what the transcript misses.
6. **Description links are first-class** — often the most valuable content is a repo or paper the creator referenced.
7. **Composable + idempotent** — each mode does one thing. Re-running is safe. Merge mode separates extraction from synthesis.
8. **Provenance always** — every note records exactly what ran. No mystery data. Future sessions can trust what they read.
9. **Stateless, free, local** — no APIs, no databases, no subscriptions. Runs on the Mac Mini.
