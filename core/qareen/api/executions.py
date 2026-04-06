"""Qareen API — Execution telemetry.

Records every execution through the ExecutionRouter and exposes
query/summary endpoints for the Activity tab.

Storage: ~/.aos/data/actions.db (same WAL-mode SQLite as audit log)
Table: execution_log
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/executions", tags=["executions"])

DB_PATH = os.path.expanduser("~/.aos/data/actions.db")

# ---------------------------------------------------------------------------
# Pricing (USD per 1M tokens)
# ---------------------------------------------------------------------------

PRICE_PER_MILLION: dict[str, dict[str, float]] = {
    # Anthropic
    "claude-opus-4-6": {"input": 15.0, "output": 75.0},
    "opus": {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "sonnet": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.0},
    "haiku": {"input": 0.80, "output": 4.0},
    # OpenRouter popular models
    "google/gemini-2.5-pro": {"input": 1.25, "output": 10.0},
    "google/gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "deepseek/deepseek-r1": {"input": 0.55, "output": 2.19},
    "meta-llama/llama-4-maverick": {"input": 0.50, "output": 1.50},
}


def compute_cost(model: str, tokens_in: int, tokens_out: int) -> float | None:
    """Compute execution cost in USD. Returns None if model not in price table."""
    pricing = PRICE_PER_MILLION.get(model)
    if not pricing or (tokens_in == 0 and tokens_out == 0):
        return None
    return (tokens_in * pricing["input"] + tokens_out * pricing["output"]) / 1_000_000


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _conn = sqlite3.connect(DB_PATH)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.row_factory = sqlite3.Row
        _ensure_table(_conn)
    return _conn


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS execution_log (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            agent_id TEXT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_preview TEXT,
            status TEXT NOT NULL,
            duration_ms INTEGER DEFAULT 0,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            cost_usd REAL,
            error TEXT,
            metadata TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_exec_ts ON execution_log(timestamp DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_exec_agent ON execution_log(agent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_exec_provider ON execution_log(provider)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_exec_status ON execution_log(status)")
    conn.commit()


def log_execution(
    *,
    agent_id: str | None,
    provider: str,
    model: str,
    prompt_preview: str | None,
    status: str,
    duration_ms: int = 0,
    tokens_in: int = 0,
    tokens_out: int = 0,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Write an execution record. Fire-and-forget — never raises."""
    try:
        conn = _get_conn()
        eid = str(uuid.uuid4())
        cost = compute_cost(model, tokens_in, tokens_out)
        conn.execute(
            """INSERT INTO execution_log
               (id, timestamp, agent_id, provider, model, prompt_preview,
                status, duration_ms, tokens_in, tokens_out, cost_usd, error, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                eid,
                datetime.now().isoformat(),
                agent_id,
                provider,
                model,
                (prompt_preview[:200] if prompt_preview else None),
                status,
                duration_ms,
                tokens_in,
                tokens_out,
                cost,
                error,
                json.dumps(metadata, default=str) if metadata else None,
            ),
        )
        conn.commit()
        return eid
    except Exception:
        logger.warning("Failed to log execution", exc_info=True)
        return ""


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_executions(
    agent_id: str | None = Query(None),
    provider: str | None = Query(None),
    status: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
) -> dict[str, Any]:
    """List recent executions with optional filters."""
    conn = _get_conn()

    clauses: list[str] = []
    params: list[Any] = []

    if agent_id:
        clauses.append("agent_id = ?")
        params.append(agent_id)
    if provider:
        clauses.append("provider = ?")
        params.append(provider)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if since:
        clauses.append("timestamp >= ?")
        params.append(since)
    if until:
        clauses.append("timestamp <= ?")
        params.append(until)

    where = " AND ".join(clauses) if clauses else "1=1"

    # Count total
    count_row = conn.execute(
        f"SELECT COUNT(*) as cnt FROM execution_log WHERE {where}", params
    ).fetchone()
    total = count_row["cnt"] if count_row else 0

    # Fetch page
    rows = conn.execute(
        f"SELECT * FROM execution_log WHERE {where} "
        f"ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()

    executions = []
    for r in rows:
        meta = None
        if r["metadata"]:
            try:
                meta = json.loads(r["metadata"])
            except Exception:
                pass
        executions.append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "agent_id": r["agent_id"],
            "provider": r["provider"],
            "model": r["model"],
            "prompt_preview": r["prompt_preview"],
            "status": r["status"],
            "duration_ms": r["duration_ms"],
            "tokens_in": r["tokens_in"],
            "tokens_out": r["tokens_out"],
            "cost_usd": r["cost_usd"],
            "error": r["error"],
            "metadata": meta,
        })

    return {
        "executions": executions,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/summary")
async def execution_summary(
    period: str = Query("today"),
) -> dict[str, Any]:
    """Aggregated execution stats.

    period: "today", "week", "month", or "all"
    """
    conn = _get_conn()

    now = datetime.now()
    if period == "today":
        since = now.replace(hour=0, minute=0, second=0).isoformat()
    elif period == "week":
        since = (now - timedelta(days=7)).isoformat()
    elif period == "month":
        since = (now - timedelta(days=30)).isoformat()
    else:
        since = "2000-01-01"

    where = "timestamp >= ?"
    params: list[Any] = [since]

    # Overall stats
    row = conn.execute(
        f"SELECT COUNT(*) as total, "
        f"SUM(tokens_in) as total_in, "
        f"SUM(tokens_out) as total_out, "
        f"SUM(cost_usd) as total_cost, "
        f"AVG(duration_ms) as avg_duration, "
        f"SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as successes, "
        f"SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors "
        f"FROM execution_log WHERE {where}",
        params,
    ).fetchone()

    # By agent
    agent_rows = conn.execute(
        f"SELECT agent_id, COUNT(*) as cnt, SUM(tokens_in + tokens_out) as tokens, "
        f"SUM(cost_usd) as cost "
        f"FROM execution_log WHERE {where} AND agent_id IS NOT NULL "
        f"GROUP BY agent_id ORDER BY cnt DESC",
        params,
    ).fetchall()

    # By provider
    provider_rows = conn.execute(
        f"SELECT provider, COUNT(*) as cnt, SUM(tokens_in + tokens_out) as tokens, "
        f"SUM(cost_usd) as cost "
        f"FROM execution_log WHERE {where} "
        f"GROUP BY provider ORDER BY cnt DESC",
        params,
    ).fetchall()

    # By model
    model_rows = conn.execute(
        f"SELECT model, COUNT(*) as cnt, SUM(tokens_in + tokens_out) as tokens, "
        f"SUM(cost_usd) as cost "
        f"FROM execution_log WHERE {where} "
        f"GROUP BY model ORDER BY cnt DESC LIMIT 10",
        params,
    ).fetchall()

    return {
        "period": period,
        "since": since,
        "total_executions": row["total"] if row else 0,
        "total_tokens_in": row["total_in"] or 0 if row else 0,
        "total_tokens_out": row["total_out"] or 0 if row else 0,
        "total_cost_usd": round(row["total_cost"] or 0, 4) if row else 0,
        "avg_duration_ms": round(row["avg_duration"] or 0) if row else 0,
        "successes": row["successes"] or 0 if row else 0,
        "errors": row["errors"] or 0 if row else 0,
        "by_agent": [
            {"agent_id": r["agent_id"], "count": r["cnt"], "tokens": r["tokens"] or 0, "cost_usd": round(r["cost"] or 0, 4)}
            for r in agent_rows
        ],
        "by_provider": [
            {"provider": r["provider"], "count": r["cnt"], "tokens": r["tokens"] or 0, "cost_usd": round(r["cost"] or 0, 4)}
            for r in provider_rows
        ],
        "by_model": [
            {"model": r["model"], "count": r["cnt"], "tokens": r["tokens"] or 0, "cost_usd": round(r["cost"] or 0, 4)}
            for r in model_rows
        ],
    }
