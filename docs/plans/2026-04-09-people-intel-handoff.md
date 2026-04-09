# People Intelligence — Session Handoff (2026-04-09)

**For the next session picking this up.** This is where the subsystem sits as of end-of-day. No prior context required — everything you need is either in this doc or one link away.

---

## What you're inheriting

A working end-to-end People Intelligence subsystem. **Nothing is pushed to main.** All 26 commits sit on `feature-git-workflow` in `/Volumes/AOS-X/project/aos`, waiting to batch-ship with other updates.

**Current branch:**
```
feature-git-workflow
tip: a554216 fix(intel): vault component matcher — lower min from 4 to 3 chars
```

**Quick sanity check:**
```bash
cd /Volumes/AOS-X/project/aos
python3 -m pytest tests/engine/people/intel/ tests/engine/work/ tests/engine/qareen/ 2>&1 | tail -3
# Expected: 414 passed
python3 -m core.engine.people.intel.cli tiers
# Expected: 1046 classifications, distribution across 6 tiers
```

---

## What shipped across Phases 1-5

| Phase | What | Commits | Tests |
|-------|------|---------|-------|
| 1 | Foundation (types, registry, store, migration 032) | 1 | 42 |
| 2 | 9 source adapters (messages, whatsapp, calls, photos, contacts, mail, telegram, vault, work) + personal-data scrub + schema fixes | 11 | 132 |
| 3 | Normalizer + orchestrator + CLI + API + 3 more schema fixes | 5 | 86 |
| 4 | Profiler + taxonomy + rule classifier + LLM classifier + feedback store + runner + migration 034 + CLI ext + API ext | 4 | 127 |
| 5 | Data quality fixes + Qareen UI + Chief injection + Companion enrichment + LLM run on 201 persons | 5 | 27 |
| **Total** | **Full subsystem end-to-end** | **26** | **414** |

All 26 commits have well-formed messages. All pass tests. All fully operator-agnostic (no real names, no absolute paths, no emails, no phone numbers in shipped code).

---

## Real numbers on the operator's instance

| Metric | Value |
|--------|-------|
| Active persons in people.db | 1,101 |
| Persons with extracted signals | 1,046 (95%) |
| Signal store rows | 1,890 |
| Total messages aggregated | 235,835 |
| Total calls | 450 |
| Total photos (face-tagged) | 5,315 |
| Persons classified (any method) | 1,046 |
| Persons LLM-classified with context tags | 201 |
| Corrections logged | 0 (awaiting operator use) |

**Tier distribution:**
```
dormant      575  55%
unknown      189  18%
active       188  18%
fading        81   8%
emerging      10   1%
core           3   0%
```

**LLM tag frequencies (from 201 top-tier persons):**
```
acquaintance  141   family_nuclear     5
friend        100   family_chosen      2
close_friend   37   peer_mentor        2
colleague      34   transactional      2
faded          16   community_religious 1
business       5   ...
```

**Zero LLM errors across 201 calls. Avg 2.72 tags per person. 37 tags at confidence ≥0.9.**

---

## What works right now

You can run ANY of these and get immediate output:

```bash
# Aggregate tier counts (safe, no names)
python3 -m core.engine.people.intel.cli tiers

# Coverage report (adapters + signal types)
python3 -m core.engine.people.intel.cli coverage

# Signal store stats
python3 -m core.engine.people.intel.cli stats

# Per-person signals (explicit opt-in)
python3 -m core.engine.people.intel.cli show <person_id>

# Per-person compiled profile
python3 -m core.engine.people.intel.cli profile <person_id>

# Per-person active classification
python3 -m core.engine.people.intel.cli classification <person_id>

# Re-extract all (takes ~5s, idempotent)
python3 -m core.engine.people.intel.cli extract

# Re-classify all (rule-only, takes ~0.5s)
python3 -m core.engine.people.intel.cli classify

# LLM classify a single person (cheap test)
python3 -m core.engine.people.intel.cli classify --person <pid> --with-llm --budget 0.50

# Record a correction
python3 -m core.engine.people.intel.cli correct <pid> --tier core --tags family_nuclear --notes "my sibling"
```

**API endpoints** (when Qareen is running):
- `GET  /api/people/intel/coverage`
- `GET  /api/people/intel/stats`
- `GET  /api/people/intel/tiers`
- `POST /api/people/intel/classify`
- `POST /api/people/intel/extract`
- `GET  /api/people/{id}/profile`
- `GET  /api/people/{id}/classification`
- `GET  /api/people/{id}/intel`
- `POST /api/people/{id}/classification/correct`

**Qareen frontend** (`core/qareen/screen/src/pages/People.tsx`):
- `TierStrip` at the top of the page (aggregate counts, click-to-select)
- `PersonProfilePanel` in the detail drawer (signals + classification)
- `ClassificationCorrector` collapsible panel (tier dropdown + tag multi-select)

**Chief integration**: Every session-start hook injects a "Today's Relevant People" block into `additionalContext` (up to 20 persons from core/active/emerging). See `core/engine/work/inject_context.py:609`.

**Companion integration**: `core/qareen/intelligence/pipelines/entity_resolver.py` now enriches resolved entity records with `tier`, `context_tags`, `days_since_last`, `channels_active` fields — visible to the companion's LLM via the existing context_store.

---

## Phase 6 — pick this up next

**Theme: "Living Intelligence" — make the subsystem autonomous, actionable, and in the operator's daily workflow.**

Phase 1-5 built beautifully-engineered data. Phase 6 makes it reach the operator without being asked.

### The three things that matter (in priority order)

#### 1. Canonical name hygiene — unlock everything else

The biggest bottleneck in matching is that `people.db` canonical_names are a mess: `"QariMuhammadYahyaRasoolNagriAlBalochi"`, `"AyeshaCOUSIN/MICHIGAN"`, `"NaveedUncle/HishamFather"`, `"أحمدطلالالعرفج"`. The normalizer is a band-aid. The real fix is cleaning the data at the source.

**Work to do:**
- Split concatenated names into `first_name` + `last_name` + `aliases` (mostly empty today)
- Strip honorifics ("Qari", "Dr", "Shaykh", "Hafiz", "Imam", "Maulana") into a `title` column
- Strip embedded tags ("CHICAGO", "COUSIN", "TRIP2025") into metadata
- Merge obvious duplicates (`"AliNaqvi"` + `"Ali Naqvi"` are the same person)
- Split `/` compound records into two person rows OR recognize them as aliases
- Add a `canonical_name_clean` column alongside the legacy column so nothing breaks

**Expected impact:** vault mentions jump from 7 → likely 100+, LLM prompts get richer context, Chief injection surfaces better names.

**File hints:**
- `core/engine/people/identity.py` — existing identity resolution
- `core/engine/people/hygiene.py` — existing hygiene logic (extend this)
- `core/engine/people/normalize.py` (ontology layer, not my intel/normalize.py)
- `core/infra/migrations/035_canonical_name_cleanup.py` — new migration

This is a one-time cleanup pass. Do it in Phase 6. The data stays clean forever after.

#### 2. Nudge pipeline — from data to action

This is where the subsystem earns its keep. The `intelligence_queue` table was referenced in the bus consumer but never created.

**Work to do:**
- Migration 036: create `intelligence_queue(id, person_id, queue_type, scheduled_for, prompt, created_at, processed_at)`
- Generator functions:
  - **Birthday**: query `metadata.birthday` or `metadata.birthday_yearless`, queue entries N days before
  - **Drift**: compare current `days_since_last` to historical average for close_friend/family tier; queue if gap is unusually large
  - **Follow-up**: scan recent messages where operator asked a question and got no reply within M days
  - **Reconnect**: tier-in-(core, close_friend) AND `days_since_last > 60` → suggest a re-engagement
- Surface in morning briefing:
  - `core/bin/crons/morning-context` at 06:30 — add a "People today" section that reads from `intelligence_queue`
  - `core/bin/crons/compile-daily` at 23:30 — optional evening reflection section
- CLI commands:
  - `cli nudges` — list pending nudges
  - `cli nudge-done <id>` — mark a nudge as processed

**Expected impact:** the first time the operator wakes up and sees "It's your brother's birthday tomorrow" or "You haven't talked to [close_friend] in 45 days — pattern is fading", the subsystem proves its value.

#### 3. Scheduled refresh — make it autonomous

Without this, the data decays. Every day the system should update itself.

**Work to do (simple path first):**
- Add to `config/crons.yaml`:
  ```yaml
  people-intel-refresh:
    command: python3 -m core.engine.people.intel.cli extract && python3 -m core.engine.people.intel.cli classify
    at: "02:00"
    timeout: 600
    tier: 4
    description: Refresh signal_store and rule-based classifications
  ```
- Verify the cron runner picks it up
- Add `people-intel-refresh` log rotation

**Event-driven path (defer to Phase 7):**
- `core/engine/bus/consumers/people_intel.py` currently exists but points to a dead legacy path (`~/.aos/services/people/db`). Rewrite to import from `core.engine.people.intel.runner`.
- Subscribe to `comms.message_sent` events and re-extract the affected person incrementally.
- Faster than cron but more complex.

**Expected impact:** signal_store and classifications stay fresh without operator intervention. When they look at Chief's "Today's Relevant People" in a new session, it reflects today's reality, not last week's.

### What's explicitly NOT in Phase 6

| Deferred item | Why defer |
|---------------|-----------|
| Islamic calendar birthdays (`ZABCDDATECOMPONENTS`) | Small (+5 birthdays). Quick-win for Phase 7. |
| iMessage ingest | Parallel session's territory. Don't duplicate. |
| comms.db re-link (10,835 unlinked msgs) | Affects the other subsystem's outputs, not People Intelligence. |
| Qareen UI tier filtering backend | Needs a `tier` field on `PersonResponse`. Nice-to-have visual polish. |
| Event-driven bus consumer rewrite | Cron is 80% of value for 20% of work. Do cron first. |
| `core/engine/bus/consumers/people_intel.py` legacy-path cleanup | Can remove once event-driven path lands. |
| ~1,044 unknown-tier people getting LLM tags | $6-8 spend. Defer until operator wants it. |
| Daily briefing voice integration | Companion voice is a separate subsystem. |

---

## Known gotchas (read before touching anything)

1. **Qareen is the frontend, not mission-control.** `core/qareen/screen/src/` is the real React app. `apps/mission-control/` is dead code.
2. **All 26 commits are on `feature-git-workflow`, not pushed.** When you `git status`, you'll see unrelated in-flight work from parallel sessions — ignore it, commit only what's yours.
3. **Personal data scrubbing is ongoing.** Tests use fabricated names ("SamTaylor", "AliceKumar", "Riley"). Never introduce real operator contacts into test fixtures. Never log LLM prompt/response bodies at INFO.
4. **The `_PEOPLE_SERVICE` legacy path at `core/engine/bus/consumers/people_intel.py` is DEAD.** Don't wire new code into it.
5. **Canonical names are weird on purpose.** The operator has names like `"QariMuhammadYahyaRasoolNagriAlBalochi"` which the normalizer tries to handle but can't fully clean up. Phase 6 canonical hygiene is the fix.
6. **LLM classification uses the `claude-code` harness by default.** That runs `claude --print --model sonnet` via subprocess, using the operator's subscription (no API tokens billed). If you're in a Claude Code session and something else grabs the lock, LLM calls may stall — run during quiet hours.
7. **Worktree isolation is unreliable.** When I dispatched 4 parallel subagents with `isolation: "worktree"`, three of them committed directly to `feature-git-workflow` (the shared branch) anyway. Cherry-pick still works, but verify after each subagent returns.
8. **Migrations are numbered 032 (signal_store) and 034 (person_classification).** 033 is taken by content-engine. 035 and 036 are available for Phase 6.
9. **The parallel session's `comms.db` work (15,832 WhatsApp messages) is fully separate.** Don't touch it. Your subsystem writes to `signal_store` + `person_classification` in `people.db`. Their subsystem writes to `messages` + `conversations` in `comms.db`.
10. **`core/engine/people/graph.py` already runs Louvain community detection.** 42 circles, 162 memberships, 54 persons in at least one circle. Don't reimplement it. Read from it.

---

## Files you'll touch most in Phase 6

**Canonical hygiene:**
- `core/engine/people/hygiene.py`
- `core/engine/people/identity.py`
- `core/infra/migrations/035_canonical_name_cleanup.py` (new)
- `tests/engine/people/test_hygiene.py` (extend)

**Nudge pipeline:**
- `core/infra/migrations/036_intelligence_queue.py` (new)
- `core/engine/people/intel/nudges.py` (new — generator functions)
- `core/engine/people/intel/cli.py` (add `nudges` + `nudge-done` commands)
- `core/qareen/api/people.py` (add `/api/people/intel/nudges` endpoint)
- `core/bin/crons/morning-context` (add "People today" section)

**Scheduled refresh:**
- `config/crons.yaml` (add entry)
- Maybe: `core/bin/crons/people-intel-refresh` (wrapper script, if needed)

---

## Plan file

The full multi-phase plan document lives at:
**`/Users/agentalhadi/.claude/plans/glowing-swinging-stroustrup.md`**

It has the Context section, validated findings, Phases 1-5 execution details, verification gates, and the beginnings of Phase 6 thinking. Start there if you want the full history before diving into Phase 6 planning.

The original multi-subsystem architecture doc lives at:
**`docs/plans/2026-04-06-people-intelligence-v2.md`**

That's the source of truth for the Subsystem A/B/C architecture. Subsystem A is done (Phases 1-3). Subsystem B is done (Phase 4). Subsystem C is partially done (Phase 5 Chief/Companion hooks) and gets completed in Phase 6 (scheduled refresh + nudges).

---

## Immediate next action

1. **Read this doc** (you're already doing it)
2. **Read `~/.claude/plans/glowing-swinging-stroustrup.md`** for the full phase history
3. **Run the sanity-check commands** at the top of this doc to verify the subsystem is still working
4. **Enter plan mode** for Phase 6 — pick scope carefully. The recommendation is canonical hygiene first, then nudge pipeline, then scheduled refresh. Hygiene is foundational; nudges are value; cron is infrastructure. In that order.
5. **Dispatch subagents for the parallelizable parts.** Canonical hygiene is sequential (touches shared ontology). Nudge pipeline has clear fan-out (per-nudge-type generators). Scheduled refresh is tiny and sequential.
6. **Never push to main without explicit operator approval.** The CLAUDE.md rule. Batch-ship Phase 6 with Phase 5's 26 commits and whatever else is in-flight.

---

## Dashboards / quick links

**Operator experience (what Phase 6 is building toward):**
- Wake up → morning briefing shows 3 people nudges
- Ask Chief "who should I reach out to today?" → answer comes from signal_store + classification
- Mention a name in chat → Companion surfaces tier + tags inline
- Qareen People page shows tier distribution, click a person → profile + classification + corrections UI

**Phase 6 success criteria:**
- `intelligence_queue` table populated nightly
- Morning briefing has a "People today" section
- At least one nudge type produces usable output on real data
- Cron runs nightly, signal_store stays fresh, no operator intervention needed
- Canonical hygiene pass runs once and improves vault match rate from 7 → 50+ persons

---

**Good luck. The foundation is solid. Make it sing.**
