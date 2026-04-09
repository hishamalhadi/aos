"""
Migration 030: Retire legacy services replaced by Qareen and QMD.

Qareen (com.aos.qareen, port 4096) absorbed these services:
  - dashboard (:4096) — web UI
  - eventd (:4097) — event dispatcher
  - companion (:7603) — voice companion
  - listen (:7600) — job server
  - mission-control (:3000) — native Tauri UI

QMD replaced:
  - memory — workspace semantic search MCP (Claude Code Grep/Glob
    handles code search; QMD handles knowledge/vault search)

Plus two experimental proxies that never shipped a template:
  - https-proxy
  - wss-proxy

This migration:
1. Stops and unloads all retired LaunchAgents
2. Removes their plist files from ~/Library/LaunchAgents/
3. Removes the memory MCP registration from ~/.claude/mcp.json
4. Creates the ingest tables in qareen.db (activity, conversations,
   sessions) used by the new /api/ingest endpoints

Historical data (e.g. ~/.aos/data/dashboard/activity.db) is left
in place — it doesn't conflict.
"""

DESCRIPTION = "Retire legacy services absorbed by Qareen/QMD, create ingest tables"

import json
import os
import sqlite3
import subprocess
from pathlib import Path

HOME = Path.home()
LAUNCH_AGENTS_DIR = HOME / "Library" / "LaunchAgents"
DB_PATH = HOME / ".aos" / "data" / "qareen.db"
MCP_CONFIG = HOME / ".claude" / "mcp.json"

# All services that have been retired / absorbed by Qareen or QMD
RETIRED_SERVICES = [
    "com.aos.dashboard",
    "com.aos.eventd",
    "com.aos.companion",
    "com.aos.listen",
    "com.aos.mission-control",
    "com.aos.memory",
    "com.aos.https-proxy",
    "com.aos.wss-proxy",
]

# MCP servers that have been retired
RETIRED_MCP_SERVERS = ["memory"]

INGEST_SCHEMA = """
CREATE TABLE IF NOT EXISTS ingest_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    parent_agent TEXT,
    status TEXT DEFAULT 'running',
    summary TEXT,
    duration_ms INTEGER,
    session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_activity_agent
    ON ingest_activity(agent);
CREATE INDEX IF NOT EXISTS idx_ingest_activity_ts
    ON ingest_activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_activity_session
    ON ingest_activity(session_id);

CREATE TABLE IF NOT EXISTS ingest_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'telegram',
    user_key TEXT NOT NULL,
    agent TEXT,
    topic_name TEXT,
    message TEXT NOT NULL,
    response TEXT,
    duration_ms INTEGER,
    message_type TEXT DEFAULT 'text'
);
CREATE INDEX IF NOT EXISTS idx_ingest_conv_ts
    ON ingest_conversations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_conv_agent
    ON ingest_conversations(agent);

CREATE TABLE IF NOT EXISTS ingest_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    working_dir TEXT,
    agent_name TEXT,
    status TEXT DEFAULT 'running',
    files_modified TEXT DEFAULT '[]',
    tools_used TEXT DEFAULT '{}',
    total_tools INTEGER DEFAULT 0,
    last_activity TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_sess_status
    ON ingest_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ingest_sess_started
    ON ingest_sessions(started_at DESC);
"""


def check() -> bool:
    """Applied if all retired plists are gone AND ingest tables exist."""
    # Any retired plist file still present?
    for label in RETIRED_SERVICES:
        if (LAUNCH_AGENTS_DIR / f"{label}.plist").exists():
            return False

    # Any retired service still loaded in launchctl?
    try:
        result = subprocess.run(
            ["launchctl", "list"],
            capture_output=True, text=True, timeout=5,
        )
        for label in RETIRED_SERVICES:
            if label in result.stdout:
                return False
    except Exception:
        pass

    # Any retired MCP server still registered?
    if MCP_CONFIG.exists():
        try:
            with open(MCP_CONFIG) as f:
                data = json.load(f)
            servers = data.get("mcpServers", {})
            for name in RETIRED_MCP_SERVERS:
                if name in servers:
                    return False
        except Exception:
            pass

    # Ingest tables exist in qareen.db?
    if DB_PATH.exists():
        try:
            conn = sqlite3.connect(str(DB_PATH))
            tables = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}
            conn.close()
            if "ingest_activity" not in tables:
                return False
        except Exception:
            pass

    return True


def apply() -> str:
    """Stop all retired services, remove plists, create ingest tables."""
    actions = []
    uid = os.getuid()

    # 1. Stop and remove all retired services
    try:
        result = subprocess.run(
            ["launchctl", "list"],
            capture_output=True, text=True, timeout=5,
        )
        loaded_services = result.stdout
    except Exception:
        loaded_services = ""

    for label in RETIRED_SERVICES:
        # Bootout if loaded
        if label in loaded_services:
            try:
                subprocess.run(
                    ["launchctl", "bootout", f"gui/{uid}/{label}"],
                    capture_output=True, timeout=10,
                )
                actions.append(f"Stopped {label}")
            except Exception as e:
                actions.append(f"Could not stop {label}: {e}")

        # Remove plist
        plist = LAUNCH_AGENTS_DIR / f"{label}.plist"
        if plist.exists():
            plist.unlink()
            actions.append(f"Removed {plist.name}")

    # 2. Remove retired MCP servers from ~/.claude/mcp.json
    if MCP_CONFIG.exists():
        try:
            with open(MCP_CONFIG) as f:
                data = json.load(f)
            servers = data.get("mcpServers", {})
            removed = []
            for name in RETIRED_MCP_SERVERS:
                if name in servers:
                    del servers[name]
                    removed.append(name)
            if removed:
                with open(MCP_CONFIG, "w") as f:
                    json.dump(data, f, indent=2)
                actions.append(f"Removed MCP servers: {', '.join(removed)}")
        except Exception as e:
            actions.append(f"MCP cleanup failed: {e}")

    # 3. Create ingest tables in qareen.db
    if DB_PATH.exists():
        try:
            conn = sqlite3.connect(str(DB_PATH))
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(INGEST_SCHEMA)
            conn.commit()
            conn.close()
            actions.append("Created ingest tables in qareen.db")
        except Exception as e:
            actions.append(f"Ingest table creation failed: {e}")

    return "; ".join(actions) if actions else "Nothing to do"
