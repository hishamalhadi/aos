# AOS System — Developer Context

This is the AOS codebase. A packageable agentic operating system.
Clone onto a Mac Mini, run the installer, get an autonomous workstation.

## Two Copies — Know Which One You're In

```
~/aos/              RUNTIME — always on main, never edit directly
~/project/aos/      DEV WORKSPACE — make changes here, push to ship
```

- `~/aos/` auto-updates at 4am. Every user's machine runs this.
- `~/project/aos/` is your working copy. Branch, edit, test here.
- Auto-commit is disabled on both (`.no-auto-commit`).

## How to Ship Changes

1. Make changes in `~/project/aos/` (on a branch or directly)
2. Test: open a Claude Code session there, run scripts, verify
3. Push to main — `git push origin HEAD:main` (or merge a PR)
4. Every machine pulls at 4am via `check-update --apply`
5. Update flow: `git pull → reconcile → migrations → sync → rebuild venvs → restart services`

Update the CHANGELOG.md with every release:
```
## vX.Y.Z — YYYY-MM-DD

Summary: One line describing the release.

Added: feature description
Changed: what changed
Fixed: what was broken
Removed: what was removed
```
Bump `VERSION` file. Users get release notes on Telegram after the 4am update.

## Reconcile System (core/infra/reconcile/)

Runs on EVERY update — not once like migrations. Checks invariants and auto-repairs drift.

```
core/infra/reconcile/
├── runner.py          # Loads checks, runs them, logs results
├── base.py            # ReconcileCheck: check() → bool, fix() → CheckResult
└── checks/
    ├── claude_md.py       # CLAUDE.md managed sections current
    ├── mcp_location.py    # mcp.json in right place
    ├── hooks.py           # settings.json hooks + permissions correct
    ├── launchagents.py    # Plist Python paths exist
    ├── symlinks.py        # Agent/skill symlinks correct
    └── log_location.py    # Runtime data not in ~/aos/
```

**To fix a structural bug across all machines:** add a check to `checks/`, add to `ALL_CHECKS` in `__init__.py`. Push. Runs everywhere next morning.

**CLAUDE.md managed sections:** AOS owns content inside `<!-- AOS:MANAGED -->` markers. User content outside markers is never touched. Bump version number to trigger update.

## Migrations vs Reconcile vs Sync

| Mechanism | Runs | Purpose |
|-----------|------|---------|
| **Migrations** (`core/infra/migrations/`) | Once per version | Structural changes (new dirs, new files, schema) |
| **Reconcile** (`core/infra/reconcile/`) | Every update cycle | Fix drift, repair broken state, keep invariants |
| **Sync** (`aos sync-skills/agents/mcp`) | Every update | Re-symlink skills/agents to framework |

## System Layout

```
~/aos/                       SYSTEM CODE (this repo)
├── core/
│   ├── services/              Bridge, qareen, listen, memory
│   ├── agents/                chief.md, steward.md, advisor.md
│   ├── work/                  Work engine + hooks (inject_context, session_close)
│   ├── infra/reconcile/       Invariant checks (runs every update)
│   ├── infra/migrations/      Numbered one-shot migrations
│   └── bin/                   CLI tools, crons, utilities
├── config/                    Shipped config (crons.yaml, etc.)
├── templates/                 Agent catalog + project scaffold
└── specs/                     Architecture docs

~/.aos/                      USER DATA (never in git)
├── work/                      Tasks, goals, inbox
├── services/                  Service venvs + runtime
├── config/                    operator.yaml, onboarding.yaml
└── logs/                      All logs including execution/

~/vault/                       KNOWLEDGE (Obsidian, separate repo)
```

## Communications Architecture

Two databases, one bus, one loop.

```
comms.db (~/.aos/data/comms.db)     — CONTENT: 248K+ messages, full text, FTS5
people.db (~/.aos/data/people.db)   — IDENTITY: 1,148 people, aliases, identifiers
```

**comms.db** is the unified cross-channel message store. Every message (WhatsApp,
iMessage, email, Slack, SMS, Telegram) lives here with full content, resolved
`person_id`, and FTS5 full-text search index. Schema: `core/qareen/schemas/comms.sql`.

**people.db** is the identity layer. Maps any handle (phone, JID, email, Slack ID)
to a canonical person via a 5-tier resolver (alias → exact → frequency → phonetic → fuzzy).
Schema: `core/engine/people/schema.sql`.

### The Loop

```
INBOUND (comms-bus service, every 5 min):
  Channel adapters poll → CommsStoreConsumer writes to comms.db
  → PeopleIntelConsumer logs interactions to people.db
  → CommsOrchestrator runs trust cascade (L0 observe → L3 autonomous)

OUTBOUND (message-person CLI):
  Resolve person → pull context from comms.db → pick channel (active conversation)
  → send via adapter → write outbound to comms.db

ENRICHMENT (nightly cron):
  Unprocessed messages → batch by person+day → Haiku extracts topics/intent/summary
  → message_entities table → messages.processed = 1
```

### How to Search Comms

```sql
-- Keyword search (sub-millisecond via FTS5):
SELECT * FROM messages_fts WHERE messages_fts MATCH 'ramadan' 

-- Person-scoped search:
SELECT * FROM messages WHERE person_id = 'p_xxx' AND content LIKE '%topic%'

-- Topic search (after enrichment):
SELECT m.* FROM message_entities me JOIN messages m ON me.message_id = m.id
WHERE me.entity_id = 'family'
```

### Key Files

| File | What |
|------|------|
| `core/services/comms_bus/main.py` | Always-on polling daemon (port 4099) |
| `core/comms/consumers/comms_store.py` | Bus → comms.db writer |
| `core/comms/consumers/people_intel.py` | Bus → people.db interactions |
| `core/engine/comms/orchestrator.py` | Trust cascade (L0-L3) |
| `core/engine/comms/channels/*.py` | Channel adapters (6 channels) |
| `core/engine/people/resolver.py` | 5-tier contact resolution |
| `core/bin/cli/message-person` | Outbound messaging CLI |
| `core/bin/crons/enrich-comms` | Nightly topic/intent extraction |
| `core/qareen/schemas/comms.sql` | comms.db schema + FTS5 |

## Key Rules

- Hooks must NEVER crash — always output valid JSON and exit 0
- Runtime data goes in `~/.aos/`, never in `~/aos/`
- Skills are symlinked from `~/aos/core/skills/` — edits in framework propagate
- Settings.json harness files need explicit `allow` permissions (bypassPermissions doesn't cover them)
- Test with both Homebrew Python and system Python 3.9 (some users only have 3.9)
- **Never hardcode lists the filesystem declares.** When checking for services, skills, agents, or LaunchAgents — discover from the filesystem. Lists drift. Directories don't. ship-check enforces this.
- **Destructive operations require operator approval.** Any operation that deletes files, removes services, or drops data must present what it will do and get explicit approval. No auto-delete. No "cleanup on fix." Report, then ask.
- **Read `DESIGN.md` before any UI work.** Follow the design system exactly — glass pill tabs, warm tokens, no hardcoded colors. Never use a generic primitive when the design language specifies a pattern. Convenience does not override correctness.

## Vault Structure

Two top-level folders. No exceptions.

```
~/vault/
├── log/              WHAT HAPPENED (temporal, append-only)
│   ├── YYYY-MM-DD.md   dailies (auto-compiled, hijri dates, comms, journal)
│   ├── YYYY-WNN.md     weekly reviews
│   ├── sessions/       session exports
│   └── friction/       friction reports
│
└── knowledge/        WHAT WE KNOW (permanent, pipeline-driven)
    ├── captures/       stage 1-2: raw input (extracts, clips)
    ├── research/       stage 3: investigated
    ├── references/     no stage: stable lookups (specs, SOPs)
    ├── synthesis/      stage 4: distilled insights
    ├── decisions/      stage 5: locked, authoritative
    ├── expertise/      stage 6: living patterns
    └── initiatives/    lifecycle docs (status in frontmatter)
```

See `~/vault/SCHEMA.md` for frontmatter contracts per document type. Every file must have: title, type, date, tags, source_ref. Knowledge files carry a `stage` (1-6). `project` field for scoping.

## Key Specs

| Spec | What |
|------|------|
| `specs/aos-v2-brief.md` | Original brief and research |
| `specs/work-system-architecture.md` | Work system data models |
| `specs/v2-system-map.md` | Full system map |
