"""Qareen API — Vault / Knowledge routes.

List collections, search via QMD, and read file content.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Query, Request
from fastapi import Path as PathParam
from fastapi.responses import JSONResponse
from pydantic import BaseModel as PydanticBaseModel

from .schemas import (
    PipelineStageInfo,
    PipelineStatsResponse,
    VaultCollectionListResponse,
    VaultCollectionResponse,
    VaultFileResponse,
    VaultSearchResponse,
    VaultSearchResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vault", tags=["vault"])

VAULT_DIR = Path.home() / "vault"
QMD_PATH = os.path.expanduser("~/.bun/bin/qmd")

STAGE_LABELS = {
    1: "Capture", 2: "Triage", 3: "Research",
    4: "Synthesis", 5: "Decision", 6: "Expertise",
}
STAGE_DIRS: dict[int, str] = {
    1: "knowledge/captures", 2: "knowledge/captures",
    3: "knowledge/research", 4: "knowledge/synthesis",
    5: "knowledge/decisions", 6: "knowledge/expertise",
}


class VaultFileUpdate(PydanticBaseModel):
    """Request body for partial vault file edits."""

    frontmatter: dict[str, Any] | None = None
    body: str | None = None


def _count_md_files(path: Path) -> int:
    """Count .md files recursively in a directory."""
    if not path.is_dir():
        return 0
    count = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            if f.endswith(".md"):
                count += 1
    return count


def _parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Split a markdown file into (frontmatter_dict, body)."""
    if not content.startswith("---"):
        return {}, content
    end = content.find("---", 3)
    if end == -1:
        return {}, content
    raw_yaml = content[3:end].strip()
    body = content[end + 3:].lstrip("\n")
    try:
        fm = yaml.safe_load(raw_yaml)
        if not isinstance(fm, dict):
            return {}, content
        return fm, body
    except Exception:
        return {}, content


@router.get("/collections", response_model=VaultCollectionListResponse)
async def list_collections(request: Request) -> VaultCollectionListResponse:
    """List all vault collections with document counts."""
    collections = []
    total_docs = 0

    # Standard vault collections
    vault_collections = [
        ("knowledge", VAULT_DIR / "knowledge"),
        ("log", VAULT_DIR / "log"),
    ]

    for name, path in vault_collections:
        count = _count_md_files(path)
        total_docs += count
        collections.append(VaultCollectionResponse(
            name=name,
            path=str(path),
            doc_count=count,
        ))

    return VaultCollectionListResponse(
        collections=collections,
        total_docs=total_docs,
    )


def _parse_qmd_results(
    stdout: str, min_score: float = 0.0,
) -> list[VaultSearchResult]:
    """Parse QMD JSON output into VaultSearchResult list."""
    import json
    import re

    results: list[VaultSearchResult] = []
    data = json.loads(stdout)
    if not isinstance(data, list):
        return results
    for item in data:
        score = float(item.get("score", 0.0))
        if score < min_score:
            continue
        file_path = item.get("file", "")
        if file_path.startswith("qmd://"):
            file_path = file_path[6:]
        snippet = item.get("snippet", "")
        snippet = re.sub(r"@@ -\d+,\d+ @@.*?\n", "", snippet).strip()
        results.append(VaultSearchResult(
            path=file_path,
            title=item.get("title", ""),
            snippet=snippet,
            score=score,
            collection=item.get("collection", ""),
        ))
    return results


def _run_qmd(cmd: list[str], timeout: int = 10) -> list[VaultSearchResult]:
    """Run a QMD subprocess and parse results."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if proc.returncode == 0 and proc.stdout.strip():
            return _parse_qmd_results(proc.stdout)
    except FileNotFoundError:
        logger.warning("QMD not found at %s", QMD_PATH)
    except subprocess.TimeoutExpired:
        logger.warning("QMD timed out: %s", " ".join(cmd[:3]))
    except Exception:
        logger.exception("QMD failed: %s", " ".join(cmd[:3]))
    return []


@router.get("/search", response_model=VaultSearchResponse)
async def search_vault(
    request: Request,
    q: str = Query(..., description="Search query", min_length=1),
    collection: str | None = Query(None, description="Limit to a specific collection"),
    limit: int = Query(10, description="Max results", ge=1, le=50),
    min_score: float = Query(0.0, description="Minimum relevance score", ge=0.0, le=1.0),
    mode: str = Query("fast", description="Search mode: fast (BM25 ~200ms), enhanced (reranked ~1s)"),
) -> VaultSearchResponse:
    """Search the vault via QMD.

    Modes:
      - fast: BM25 keyword search only. ~200ms. Good for instant results.
      - enhanced: Hybrid search with light reranking (-C 10). ~800ms. Better relevance.
    """
    if mode == "fast":
        cmd = [QMD_PATH, "search", q, "--json", "-n", str(limit)]
    else:
        # Enhanced: hybrid search with reduced candidate limit for speed
        cmd = [QMD_PATH, "query", q, "--json", "-n", str(limit), "-C", "10"]

    if collection:
        cmd.extend(["-c", collection])

    timeout = 5 if mode == "fast" else 15
    results = _run_qmd(cmd, timeout=timeout)

    # Apply min_score filter
    if min_score > 0:
        results = [r for r in results if r.score >= min_score]

    return VaultSearchResponse(
        results=results,
        total=len(results),
        query=q,
    )


@router.get("/tree")
async def vault_tree(
    request: Request,
    root: str = Query("", description="Subdirectory within vault to list"),
) -> list[dict[str, Any]]:
    """Return a recursive tree of vault files/folders for the sidebar."""
    base = VAULT_DIR / root if root else VAULT_DIR
    if not base.is_dir():
        return []

    def _build_tree(directory: Path, rel: str = "") -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        try:
            entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return nodes
        for entry in entries:
            if entry.name.startswith(".") or entry.name.startswith("__"):
                continue
            rel_path = f"{rel}/{entry.name}" if rel else entry.name
            if entry.is_dir():
                children = _build_tree(entry, rel_path)
                count = sum(1 for c in children if c["type"] == "file") + sum(
                    c.get("count", 0) for c in children if c["type"] == "folder"
                )
                nodes.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "folder",
                    "children": children,
                    "count": count,
                })
            elif entry.suffix == ".md":
                nodes.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "file",
                })
        return nodes

    return _build_tree(base, root)


@router.get("/logs")
async def vault_logs(
    request: Request,
) -> list[dict[str, Any]]:
    """Return a list of daily log files with date and title metadata."""
    log_dir = VAULT_DIR / "log"
    if not log_dir.is_dir():
        return []

    results: list[dict[str, Any]] = []
    for entry in sorted(log_dir.iterdir(), reverse=True):
        if not entry.is_file() or entry.suffix != ".md":
            continue
        # Extract date from filename (YYYY-MM-DD.md)
        date_str = entry.stem
        title = date_str
        try:
            content = entry.read_text(encoding="utf-8", errors="replace")
            fm, _ = _parse_frontmatter(content)
            if fm.get("title"):
                title = str(fm["title"])
        except OSError:
            pass
        results.append({
            "date": date_str,
            "title": title,
            "path": f"log/{entry.name}",
        })
    return results


@router.get("/file/{path:path}", response_model=VaultFileResponse)
async def get_file(
    request: Request,
    path: str = PathParam(..., description="Relative file path within the vault"),
) -> VaultFileResponse | JSONResponse:
    """Read a single vault file's content and frontmatter."""
    abs_path = VAULT_DIR / path

    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    # Security check: ensure the resolved path is within the vault
    try:
        abs_path.resolve().relative_to(VAULT_DIR.resolve())
    except ValueError:
        return JSONResponse({"error": "Access denied"}, status_code=403)

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": f"Could not read file: {e}"}, status_code=500)

    fm, body = _parse_frontmatter(content)
    size = abs_path.stat().st_size

    return VaultFileResponse(
        path=path,
        title=fm.get("title"),
        content=body,
        frontmatter=fm,
        size_bytes=size,
    )


# ---------------------------------------------------------------------------
# Helpers for new endpoints
# ---------------------------------------------------------------------------


def _security_check(abs_path: Path) -> JSONResponse | None:
    """Return a 403 JSONResponse if the path escapes the vault, else None."""
    try:
        abs_path.resolve().relative_to(VAULT_DIR.resolve())
    except ValueError:
        return JSONResponse({"error": "Access denied"}, status_code=403)
    return None


def _rebuild_file(fm: dict[str, Any], body: str) -> str:
    """Reconstruct a markdown file from frontmatter dict and body string."""
    yaml_str = yaml.dump(fm, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return f"---\n{yaml_str}---\n{body}"


def _unique_dest(dest: Path) -> Path:
    """If *dest* exists, append -1, -2, etc. until a free name is found."""
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    parent = dest.parent
    counter = 1
    while True:
        candidate = parent / f"{stem}-{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


# ---------------------------------------------------------------------------
# Endpoint 1: GET /pipeline — Knowledge pipeline health stats
# ---------------------------------------------------------------------------


@router.get("/pipeline", response_model=PipelineStatsResponse)
async def pipeline_stats(request: Request) -> PipelineStatsResponse:
    """Return knowledge pipeline health stats across all stages."""
    now = datetime.now()
    stages: list[PipelineStageInfo] = []
    total_documents = 0
    unprocessed_captures = 0
    research_count = 0
    synthesis_count = 0

    for stage_num in range(1, 7):
        label = STAGE_LABELS[stage_num]
        rel_dir = STAGE_DIRS[stage_num]
        stage_path = VAULT_DIR / rel_dir

        items: list[VaultSearchResult] = []
        count = 0
        stale_count = 0
        stale_days = 7 if stage_num <= 2 else 30

        if stage_path.is_dir():
            for root, _dirs, files in os.walk(stage_path):
                for fname in files:
                    if not fname.endswith(".md"):
                        continue
                    fpath = Path(root) / fname
                    try:
                        # Read only first 2000 chars for speed
                        with open(fpath, encoding="utf-8", errors="replace") as f:
                            head = f.read(2000)
                    except OSError:
                        continue

                    fm, _ = _parse_frontmatter(head)
                    file_stage = fm.get("stage")

                    # For dirs shared by multiple stages (captures = 1 & 2),
                    # only count files matching this stage.
                    if stage_num <= 2:
                        if file_stage is None and stage_num == 1:
                            pass  # default to capture
                        elif file_stage is not None and int(file_stage) != stage_num:
                            continue

                    count += 1
                    total_documents += 1

                    # Check staleness
                    try:
                        mtime = datetime.fromtimestamp(fpath.stat().st_mtime)
                        age = now - mtime
                        if age > timedelta(days=stale_days):
                            stale_count += 1
                            if stage_num <= 2 and age > timedelta(days=7):
                                unprocessed_captures += 1
                    except OSError:
                        pass

                    # Cap items list at 20
                    if len(items) < 20:
                        rel = str(fpath.relative_to(VAULT_DIR))
                        items.append(VaultSearchResult(
                            path=rel,
                            title=fm.get("title", fname),
                            snippet="",
                            score=0.0,
                            collection="knowledge",
                        ))

        if stage_num == 3:
            research_count = count
        elif stage_num == 4:
            synthesis_count = count

        stages.append(PipelineStageInfo(
            stage=stage_num,
            label=label,
            count=count,
            stale_count=stale_count,
            items=items,
        ))

    synthesis_opportunities = max(0, research_count - synthesis_count * 3)

    return PipelineStatsResponse(
        stages=stages,
        total_documents=total_documents,
        unprocessed_captures=unprocessed_captures,
        synthesis_opportunities=synthesis_opportunities,
        stale_decisions=stages[4].stale_count if len(stages) > 4 else 0,
    )


# ---------------------------------------------------------------------------
# Endpoint 2: POST /promote/{path} — Move a document to a new pipeline stage
# ---------------------------------------------------------------------------


@router.post("/promote/{path:path}")
async def promote_file(
    request: Request,
    path: str = PathParam(..., description="Relative file path within the vault"),
    target_stage: int = Query(..., description="Target stage number (1-6)", ge=1, le=6),
) -> JSONResponse:
    """Promote a vault document to a new pipeline stage."""
    abs_path = VAULT_DIR / path

    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    denied = _security_check(abs_path)
    if denied:
        return denied

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": f"Could not read file: {e}"}, status_code=500)

    fm, body = _parse_frontmatter(content)
    fm["stage"] = target_stage
    fm["type"] = STAGE_LABELS[target_stage].lower()

    new_content = _rebuild_file(fm, body)

    # Determine destination
    target_dir = VAULT_DIR / STAGE_DIRS[target_stage]
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_dest(target_dir / abs_path.name)

    denied = _security_check(dest)
    if denied:
        return denied

    try:
        dest.write_text(new_content, encoding="utf-8")
        if dest.resolve() != abs_path.resolve():
            abs_path.unlink()
    except OSError as e:
        return JSONResponse({"error": f"Move failed: {e}"}, status_code=500)

    new_rel = str(dest.relative_to(VAULT_DIR))
    return JSONResponse({
        "ok": True,
        "old_path": path,
        "new_path": new_rel,
        "stage": target_stage,
        "label": STAGE_LABELS[target_stage],
    })


# ---------------------------------------------------------------------------
# Endpoint 3: POST /archive/{path} — Mark a document as archived
# ---------------------------------------------------------------------------


@router.post("/archive/{path:path}")
async def archive_file(
    request: Request,
    path: str = PathParam(..., description="Relative file path within the vault"),
) -> JSONResponse:
    """Set status: archived on a vault document's frontmatter."""
    abs_path = VAULT_DIR / path

    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    denied = _security_check(abs_path)
    if denied:
        return denied

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": f"Could not read file: {e}"}, status_code=500)

    fm, body = _parse_frontmatter(content)
    fm["status"] = "archived"

    new_content = _rebuild_file(fm, body)
    try:
        abs_path.write_text(new_content, encoding="utf-8")
    except OSError as e:
        return JSONResponse({"error": f"Write failed: {e}"}, status_code=500)

    return JSONResponse({"ok": True, "path": path, "status": "archived"})


# ---------------------------------------------------------------------------
# Endpoint 4: PATCH /file/{path} — Partial update of frontmatter and/or body
# ---------------------------------------------------------------------------


@router.patch("/file/{path:path}")
async def update_file(
    request: Request,
    update: VaultFileUpdate,
    path: str = PathParam(..., description="Relative file path within the vault"),
) -> JSONResponse:
    """Partially update a vault file's frontmatter and/or body."""
    abs_path = VAULT_DIR / path

    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    denied = _security_check(abs_path)
    if denied:
        return denied

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": f"Could not read file: {e}"}, status_code=500)

    fm, existing_body = _parse_frontmatter(content)

    # Merge frontmatter updates (partial — null values delete the key)
    if update.frontmatter is not None:
        for key, value in update.frontmatter.items():
            if value is None:
                fm.pop(key, None)
            else:
                fm[key] = value

    body = update.body if update.body is not None else existing_body
    new_content = _rebuild_file(fm, body)

    try:
        abs_path.write_text(new_content, encoding="utf-8")
    except OSError as e:
        return JSONResponse({"error": f"Write failed: {e}"}, status_code=500)

    return JSONResponse({"ok": True, "path": path, "frontmatter": fm})


# ---------------------------------------------------------------------------
# Endpoint 5: GET /related/{path} — Find related documents
# ---------------------------------------------------------------------------


@router.get("/related/{path:path}")
async def related_documents(
    request: Request,
    path: str = PathParam(..., description="Relative file path within the vault"),
    limit: int = Query(8, description="Max related results", ge=1, le=20),
) -> JSONResponse:
    """Find documents related to the given file via tags, title, and source_ref."""
    abs_path = VAULT_DIR / path

    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    denied = _security_check(abs_path)
    if denied:
        return denied

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": f"Could not read file: {e}"}, status_code=500)

    fm, _ = _parse_frontmatter(content)
    title = fm.get("title", "")
    tags = fm.get("tags", [])
    source_ref = fm.get("source_ref", "")

    # Build explicit links from source_ref
    explicit_links: list[dict[str, Any]] = []
    if source_ref:
        ref_path = VAULT_DIR / source_ref
        if ref_path.is_file():
            try:
                ref_content = ref_path.read_text(encoding="utf-8", errors="replace")[:2000]
                ref_fm, _ = _parse_frontmatter(ref_content)
                explicit_links.append({
                    "path": source_ref,
                    "title": ref_fm.get("title", ref_path.stem),
                    "relationship": "source_ref",
                })
            except OSError:
                pass

    # Build search query from title + tags
    tag_str = " ".join(tags) if isinstance(tags, list) else str(tags)
    search_query = f"{title} {tag_str}".strip()

    semantic_neighbors: list[dict[str, Any]] = []
    if search_query:
        cmd = [QMD_PATH, "search", search_query, "--json", "-n", str(limit + 5)]
        results = _run_qmd(cmd, timeout=5)
        for r in results:
            # Filter out the source document itself
            if r.path.rstrip("/") == path.rstrip("/"):
                continue
            # Also skip if already in explicit links
            if any(link["path"] == r.path for link in explicit_links):
                continue
            semantic_neighbors.append({
                "path": r.path,
                "title": r.title,
                "score": r.score,
                "collection": r.collection,
            })
            if len(semantic_neighbors) >= limit:
                break

    return JSONResponse({
        "path": path,
        "explicit_links": explicit_links,
        "semantic_neighbors": semantic_neighbors,
    })
