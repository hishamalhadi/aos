---
name: extract
description: "Extract content from any social media URL — YouTube, Instagram, TikTok, X/Twitter. Auto-detects platform, pulls metadata, transcribes audio, and saves to vault. TRIGGER when: user pastes any social media link, asks to transcribe/summarize/extract a video or post, says 'what does this say', 'check this out', 'research this', or sends a URL from youtube.com, youtu.be, instagram.com, tiktok.com, x.com, or twitter.com. Also triggers on /capture with social media URLs. This skill replaces the separate instagram and youtube skills — use it for ALL social media content extraction."
---

# Skill: Content Extraction

Extract, transcribe, and research content from YouTube, Instagram, TikTok, and X/Twitter through one unified pipeline. Auto-detects the platform, pulls metadata, transcribes spoken audio via Whisper, and optionally saves structured vault notes.

## How It Works

The extraction engine lives at `apps/content-engine/`. It uses:

1. **yt-dlp** as the universal backend — handles metadata and audio download for all 4 platforms without login or API keys
2. **YouTube captions API** as the fast path for YouTube (instant, free) before falling back to Whisper
3. **mlx-whisper** (Apple Silicon optimized) for local audio transcription when captions aren't available
4. Outputs vault-compatible markdown with unified frontmatter for QMD indexing

### Supported Platforms

| Platform | Metadata | Transcription | Notes |
|----------|----------|---------------|-------|
| YouTube | Full | Captions → Whisper | Best support, captions usually available |
| Instagram | Full | Whisper only | No captions API, always transcribes audio |
| TikTok | Best-effort | Whisper | yt-dlp may be IP-blocked, falls back gracefully |
| X/Twitter | Video tweets | Whisper | Text-only tweets need Chrome MCP fallback |

### Fallback Chain

```
YouTube captions (free, instant)
  → mlx-whisper (Apple Silicon, ~10s per minute of audio)
    → openai-whisper CLI (last resort)
```

## Procedure

### Step 1: Read the user's intent

Before extracting anything, determine what the user actually needs. This shapes everything — how much work to do, whether to save, and how to respond.

| Intent | Signals | Extraction depth | Visual depth | Save to vault? |
|--------|---------|-----------------|-------------|---------------|
| **Quick question** | "what's this about?", "quickly tell me", "someone sent me this" | Metadata + transcript, summarize concisely | Sample 6 sprite sheets, glance for context | **No** — just answer |
| **Research / deep dive** | "research this", "analyze", bare URL with no context, "extract" | Full extraction + analysis | All sb0 sheets, full triage, hi-res flagged frames | **Yes** |
| **Deep research** | "deep research", "deep dive", "study this thoroughly" | Full extraction + analysis + visual deep scan | All sb1 sheets (dense), full triage, hi-res on all flagged + OCR | **Yes** |
| **Capture / archive** | `/capture`, "save this", "log this", "add to vault" | Full extraction | All sb0 sheets, triage | **Yes** |
| **Transcribe** | "transcribe this", "what does this say exactly" | Full extraction, show transcript | None — audio only | **Yes** (for reference) |

The key insight: not every link needs to be persisted. A casual "what's this reel about?" deserves a fast, direct answer — not a 2-minute extraction pipeline with vault save. Match your effort to the user's energy.

### Step 2: Detect the URL

Find the social media URL in the user's message. The engine accepts all common formats:

- `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/shorts/...`
- `instagram.com/reel/...`, `instagram.com/p/...`, `instagram.com/tv/...`, `instagram.com/stories/...`
- `tiktok.com/@user/video/...`, `vm.tiktok.com/...`
- `x.com/user/status/...`, `twitter.com/user/status/...`
- URLs with tracking params (`?igsh=...`, `?utm_source=...`) are handled automatically

### Step 3: Run the extraction

**For quick questions** (user just wants to know what it's about):
```bash
cd ~/aos/apps/content-engine && python3 cli.py "URL" --force
```
No `--vault` flag. Just extract, read the output, answer the question, done.

**For research / capture / transcription** (user wants to keep it):
```bash
cd ~/aos/apps/content-engine && python3 cli.py "URL" --vault --force
```

**Metadata only** (when caption alone is enough — e.g., image posts, text tweets):
```bash
cd ~/aos/apps/content-engine && python3 cli.py "URL" --metadata-only
```

**Batch processing:**
```bash
cd ~/aos/apps/content-engine && python3 cli.py --batch urls.txt --vault
```

### Step 3.25: Description Link Research

Every extraction automatically runs link extraction from the description. The result is available in `result.links` with these categories: `github`, `paper`, `docs`, `tool`, `video`, `article`, `website`, `social`.

**For quick questions**: Just mention key links ("he references X repo, Y paper") in your summary. Don't fetch anything.

**For research / deep research**: Investigate the high-priority links before responding. This gives you context the transcript can't.

Priority order (baked into `research_priority`):

1. **GitHub repos** — clone and read. Most valuable: often the actual implementation being discussed.
   ```bash
   cd /tmp && git clone --depth 1 https://github.com/owner/repo.git
   ```
   Then read: `README.md`, directory structure, key source files, any `COMPARISON.md` / `ARCHITECTURE.md` / `SPEC.md` files.

2. **Papers** (arxiv, etc.) — fetch with WebFetch, read abstract + conclusions.

3. **Docs** — fetch specific pages the video references.

4. **Tools/products** — visit homepage to understand the capability being demo'd.

5. **Related videos** — note them, but don't extract recursively unless explicitly asked (that's a rabbit hole).

6. **Articles** — fetch with WebFetch for context.

When investigating links, write findings back into `result.link_research` so they appear in the vault note:
```json
{
  "url": "https://github.com/owner/repo",
  "summary": "Open-source Pi agent playground with 16 extensions covering agent teams, damage control, tilldone discipline, etc. Key files: extensions/agent-team.ts, .pi/agents/teams.yaml"
}
```

### Step 3.5: Visual Triage (YouTube only)

YouTube videos have pre-generated storyboard sprites — thumbnail grids used for the scrubber bar. These are free, instant, and cover the entire video (~1MB for a 30-minute video). Use them to understand what's visually on screen without downloading the full video.

**Skip this step for:** non-YouTube platforms, transcribe-only intent, or videos under 30 seconds.

#### How it works

**Phase 1 — Fetch sprites:**

Choose the CLI flags based on intent:

| Intent | CLI command |
|--------|------------|
| Quick question | `python3 cli.py "URL" --storyboard --storyboard-sample 6` |
| Research | `python3 cli.py "URL" --storyboard` |
| Deep research | `python3 cli.py "URL" --storyboard --storyboard-tier sb1` |
| Capture | `python3 cli.py "URL" --storyboard --storyboard-sample 8` |

The CLI outputs JSON with sprite sheet paths. Each sprite sheet is a JPEG grid of frames (e.g., 3x3 at 320x180 per frame for sb0).

**Phase 1.5 — Transcript alignment (NEW, highly recommended for research):**

Instead of manually scanning the transcript to find what was said at each frame's timestamp, use the alignment helper:

```bash
python3 cli.py "URL" --align-transcript --storyboard-tier sb0
```

This outputs a JSON table where each entry maps a frame timestamp to:
- `spoken` — transcript text within ±5s of the frame
- `context_before` / `context_after` — broader context (±10s)
- `chapter` — which video chapter this frame belongs to
- `is_chapter_boundary` — whether this frame is near a chapter cut (±15s)

**This is what makes "shown but not said" detection efficient.** For each frame, you can immediately see what the speaker was saying. If the visual shows code but the `spoken` field says "and you can see here" without describing the code, that frame is a shown-but-not-said candidate.

**Phase 2 — Visual triage (you are the VLM):**

Read the sprite sheet images using the Read tool. You can see them — you're multimodal. For each sprite sheet, classify what you see in each cell of the grid:

- `talking_head` — person speaking to camera, no visual aids
- `code_on_screen` — code editor, terminal, IDE, command output visible
- `slide` — presentation slide, diagram, flowchart, architecture drawing
- `website` — browser showing a webpage
- `title_card` — intro/outro title, text overlay on black/styled background
- `screen_recording` — screen share of any software (not just code)
- `b_roll` — transition footage, stock video, no information content

For **quick questions**: just glance at the sprite sheets. Note whether the video is mostly talking head (transcript sufficient) or has significant visual content (mention it in your summary). Don't do formal classification.

For **research / deep research**: classify every sprite sheet. Build a mental map of the video's visual structure. Identify timestamps where readable content appears (code, slides, websites). These are the frames worth extracting at higher resolution.

**The "shown but not said" rule — MOST IMPORTANT:**

Cross-reference the sprite sheets against the transcript. Flag any frame where the visual content conveys information the speaker does NOT verbalize. These are the highest-value frames to extract.

Signals that something is "shown but not said":
- Speaker says "here's my config" or "check this out" but doesn't read the content
- Speaker says "as you can see" and moves on without describing what's on screen
- Speaker describes high-level concepts while the screen shows concrete implementation details
- Code/YAML/JSON is visible but only vaguely referenced ("my agent definition")
- Diagrams, architectures, or flow charts appear but the speaker only summarizes them verbally
- Terminal outputs, error messages, or command results shown briefly without being read aloud
- UI walkthroughs where the visual IS the information (menu items, button labels, layouts)

These are the moments where the transcript alone will fail you. The hi-res extraction at Step 3.5 Phase 3 should **prioritize these "shown but not said" timestamps above all others**.

Think of it this way: if removing the video and keeping only the audio would lose information at timestamp X, then frame X must be extracted at hi-res.

**Phase 3 — Surgical hi-res extraction (research/deep research only):**

If you identified frames with readable content (code, slides, diagrams), extract them at full resolution:

```bash
cd ~/aos/apps/content-engine && python3 cli.py "URL" --hires-frames "120.0,340.5,780.0" --storyboard-out /tmp/ce-visual-{content_id}/hires
```

Then read the hi-res frames with the Read tool. Now you can actually read the code, the slide text, the website content. Include these findings in your analysis.

**Phase 4 — Merge visual data into vault note:**

Use the merge-only mode to update an existing vault note **without re-running extraction**. First write your triage to a temp file, then merge:

```bash
# Write triage data to a temp file (avoids shell escaping issues)
cat > /tmp/triage-{content_id}.json << 'EOF'
{
  "summary": "Video alternates between talking head and live coding. Key visual content at 4:30 (agent config), 12:00 (orchestrator prompt), 22:00 (Pi agent team dashboard).",
  "flags": ["has_code", "has_screen_recording", "has_website"],
  "triage": [
    {"timestamp": 270, "classification": "code_on_screen", "has_readable_content": true, "description": "Claude Code terminal showing agent configuration"},
    {"timestamp": 720, "classification": "code_on_screen", "has_readable_content": true, "description": "Orchestrator prompt engineering"}
  ],
  "hires_frames": [
    {"timestamp": 270, "analysis": "Shows agent config with tool permissions and model selection"}
  ]
}
EOF

# Merge into existing vault note (found via $VAULT_PATH from step 3)
python3 cli.py "URL" --update-vault /path/to/vault/note.md --visual-triage-file /tmp/triage-{content_id}.json
```

The `--update-vault` mode:
- Reads the existing vault note
- Generates the Visual Analysis section from your triage JSON
- Replaces any existing Visual Analysis section (idempotent) OR inserts before Top Comments
- Writes back atomically
- **Does not re-run metadata extraction or transcription** — fast, no API calls

**Alternative (for initial extraction):** `--visual-triage-file` can also be passed to the full extraction flow, which re-saves the vault note with visual data included. Use this only if you don't have an existing vault note yet.

#### Decision tree: does this video need visual extraction?

After Phase 2 triage, decide:

- **100% talking head / b_roll** → Transcript is sufficient. Skip Phase 3. Mention in response: "This is a talking-head video — transcript captures the full content."
- **Mixed (some code/slides)** → Extract hi-res only for the informative frames. Merge visual + transcript.
- **Mostly screen content** → This video's value is in what's on screen. Extract extensively. The transcript alone would miss critical information.

### Step 4: Respond based on intent

**Quick question** ("what's this about?", "someone sent me this"):
- Give a concise, conversational summary (2-4 sentences)
- Include the key takeaway — what is it, who made it, what's the point
- Match the user's tone — if they're casual, be casual
- Do NOT dump raw transcripts, metadata tables, or file paths
- Do NOT do tech relevance analysis

**Research / bare URL paste**:
- Provide a structured summary with key points
- Include metadata (author, engagement, hashtags)
- Show a transcript preview (first 10 lines) with link to full vault note
- Do the Tech Relevance analysis (see Step 5)

**Capture / archive**:
- Confirm what was saved and where
- Brief content summary
- File path to vault note

**Transcription request**:
- Show the transcript (or first 15-20 lines with "full transcript at [path]")
- Include timestamps

### Step 5: Tech Relevance Analysis (research/capture only)

Only run this for **research and capture** intents — NOT for quick questions.

After extracting, scan the caption + transcript for signals related to coding, AI, agents, automation, developer tools, or infrastructure.

If tech signals are found:

```
## Tech Relevance

**Topics**: [key topics]
**Verdict**: EXPLORE / IMPLEMENT / SKIP / ALREADY HAVE
**Why**: [2-3 sentences]
**Next steps**: [specific actions if EXPLORE/IMPLEMENT]
```

Skip for non-tech content entirely. Be honest — not everything is worth pursuing.

### Step 6: Initiative Source Linking (research/capture only)

Only run this for **research and capture** intents when `operator.yaml → initiatives.enabled: true`.

After saving to vault, check if the extracted content matches an active initiative in research phase:

```bash
# Check active initiatives
python3 ~/aos/core/work/cli.py initiatives 2>/dev/null
```

For each active initiative in research/shaping status:
- Compare the extracted content's topics/tags against the initiative's tags
- If there's a clear match, offer to link:
  "This content relates to your '{initiative_title}' initiative (currently in {status}). Link it as a research source?"

If operator approves:
1. Add the vault note path to the initiative's `sources:` frontmatter list
2. Update the initiative's `updated:` date

```python
# Example: update initiative frontmatter
# Read initiative doc
# Parse frontmatter
# Append to sources list
# Write back with atomic replacement
```

This is opt-in — always ask before linking. If no initiatives match, skip silently.

## CLI Flags Reference

| Flag | Effect |
|------|--------|
| `--metadata-only` | Skip transcription, just extract metadata (~2s) |
| `--vault` | Save result as vault markdown note |
| `--vault-dir PATH` | Custom vault directory |
| `--model SIZE` | Whisper model: tiny/base/small/medium/large (default: medium) |
| `--batch FILE` | Process multiple URLs from a file |
| `--force` | Reprocess even if URL was already extracted |
| `--json` | Output as JSON |

## Fallback: Chrome MCP for Incomplete Extractions

The CLI output may include a `FALLBACK_NEEDED: <reason>` line. This means yt-dlp returned incomplete data and the agent should fill in the gaps using Chrome MCP.

### When you see `FALLBACK_NEEDED: twitter_text_only`

yt-dlp can't extract text-only tweets. Use Chrome MCP to get the content:

1. Open the tweet URL in a new tab: `mcp__claude-in-chrome__tabs_create_mcp`
2. Wait for the page to load, then read the page: `mcp__claude-in-chrome__get_page_text`
3. From the page text, extract: tweet text, author name, author handle, timestamp, engagement counts
4. Use this data as the caption/description in your response
5. If saving to vault, re-run the CLI with the extracted text piped in (or manually create the vault note)

### When you see `FALLBACK_NEEDED: tiktok_ip_blocked`

yt-dlp is IP-blocked for TikTok. Use Chrome MCP:

1. Open the TikTok URL in a new tab: `mcp__claude-in-chrome__tabs_create_mcp`
2. Read the page: `mcp__claude-in-chrome__get_page_text`
3. Extract: video caption/description, author, hashtags, engagement counts
4. Audio transcription won't be available via this path — note this in the response

### General fallback rules

- Only use Chrome MCP when `FALLBACK_NEEDED` appears in CLI output — don't preemptively bypass yt-dlp
- Chrome MCP requires the browser extension to be active
- If Chrome MCP also fails (page requires login, content is private), tell the user honestly

## Platform-Specific Notes

**TikTok**: yt-dlp may be IP-blocked. The engine signals `FALLBACK_NEEDED: tiktok_ip_blocked` when this happens. Follow the Chrome MCP fallback procedure above.

**X/Twitter text-only tweets**: yt-dlp only handles video tweets. The engine signals `FALLBACK_NEEDED: twitter_text_only` for text-only tweets. Follow the Chrome MCP fallback procedure above.

## Integration

- Vault notes land in `~/vault/knowledge/captures/`
- QMD indexes them every 30 minutes (or manually via `bin/qmd-reindex`)
- The `/recall` skill can find extracted content via semantic search
- Bridge `/capture` should route social media URLs here
- Dedup tracking prevents reprocessing the same URL twice

**Related skills:** recall (search extracted content), obsidian-cli (vault operations)
