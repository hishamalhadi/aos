# AOS Project — .claude/ Reference

This file provides Claude Code with the .claude/ structure for this project.
For system architecture, see the root `CLAUDE.md`. For the global kernel, see `~/.claude/CLAUDE.md`.

## Harness Model

AOS is a configured Claude Code harness. Claude Code is the runtime.

```
~/.claude/CLAUDE.md   = Global kernel (loaded every session, everywhere)
~/aos/CLAUDE.md     = System details (loaded when working on AOS)
.claude/agents/       = Agent definitions (dispatched via Agent tool)
core/skills/          = Skill source (synced to ~/.claude/skills/ on install)
.claude/rules/        = Conditional policies (loaded by path/context)
.claude/hooks/        = Deterministic handlers (no LLM, no tokens)
```

## Agent Installation

System agent source: `core/agents/` (chief.md, steward.md, advisor.md)
Catalog templates: `templates/agents/` (engineer.md, developer.md, etc.)
Active agents: `~/.claude/agents/` (installed during setup)

Install mechanism:
- **System agents** (chief, steward, advisor): **symlinked** from `core/agents/` so they auto-update with the OS.
- **Catalog agents** (engineer, developer, etc.): **copied** from `templates/agents/` so user customizations survive updates.
  Catalog agents track their source via frontmatter: `_source: catalog/engineer@1.0`

## Skills

Skill source: `~/aos/core/skills/` (shipped with framework).
Active skills: `~/.claude/skills/` (symlinked globally, available in every session).

Skills live in `core/skills/` (not `.claude/skills/`) to avoid Claude Code
loading them as project-scoped skills when working in the dev workspace.
Installed globally because agents are global — Chief needs skills regardless
of which directory the session is in.

| Skill | Trigger | What |
|-------|---------|------|
| `recall` | "recall", "remember", "find notes about" | QMD vault search |
| `step-by-step` | "step by step", "build out X", "set up X properly" | Structured decomposition |
| `work` | "/work", "add task", "show my tasks", "mark X done" | Task/project/goal management |
| `review` | "/review", "daily summary", "weekly review" | Work reviews and reflections |

## Integration Framework

Integration manifests in `core/infra/integrations/`. Each integration directory has a `manifest.yaml`
declaring what it provides, requires, and how to verify health.
Registry at `core/infra/integrations/registry.yaml` lists all known integrations.
