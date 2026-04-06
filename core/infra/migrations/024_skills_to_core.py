"""
Migration 024: Update skill symlinks from .claude/skills/ to core/skills/.

Skills source moved from ~/aos/.claude/skills/ to ~/aos/core/skills/ to prevent
Claude Code from double-loading them (once as project-scoped, once as user-scoped)
when working in the dev workspace.

Existing symlinks in ~/.claude/skills/ need re-pointing to the new location.
"""

DESCRIPTION = "Re-point skill symlinks to core/skills/"

import os
from pathlib import Path

AOS_DIR = Path.home() / "aos"
OLD_SOURCE = AOS_DIR / ".claude" / "skills"
NEW_SOURCE = AOS_DIR / "core" / "skills"
TARGET_DIR = Path.home() / ".claude" / "skills"


def check() -> bool:
    """Applied if no symlinks point to the old .claude/skills/ location."""
    if not TARGET_DIR.is_dir():
        return True
    for link in TARGET_DIR.iterdir():
        if link.is_symlink():
            target = os.readlink(link)
            if ".claude/skills/" in target and "core/skills/" not in target:
                return False
    return True


def up() -> bool:
    """Re-point symlinks from .claude/skills/ to core/skills/."""
    if not TARGET_DIR.is_dir():
        return True

    fixed = 0
    for link in sorted(TARGET_DIR.iterdir()):
        if not link.is_symlink():
            continue
        target = os.readlink(link)
        if ".claude/skills/" in target and "core/skills/" not in target:
            # Compute new target
            new_target = target.replace(".claude/skills/", "core/skills/")
            new_source = Path(new_target)
            if new_source.exists() or NEW_SOURCE.joinpath(link.name).is_dir():
                link.unlink()
                os.symlink(str(NEW_SOURCE / link.name) + "/", link)
                print(f"       Re-linked {link.name}")
                fixed += 1
            else:
                print(f"       Skipped {link.name} (no source at new location)")

    if fixed:
        print(f"       Updated {fixed} skill symlink(s)")
    else:
        print("       All symlinks already correct")
    return True
