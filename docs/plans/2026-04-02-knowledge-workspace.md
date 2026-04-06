# Knowledge Workspace Implementation Plan

> **For agentic workers:** REQUIRED: If subagents are available, dispatch a fresh subagent per task with isolated context. Otherwise, use the executing-plans skill to implement this plan sequentially. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vault file browser with an active knowledge workspace that surfaces, triages, and connects knowledge through a Feed, Pipeline, Reader+Context, and inline editing.

**Architecture:** Three-layer build: (1) reusable MarkdownRenderer primitive + backend APIs for pipeline/inbox/related/edit, (2) Knowledge page with Feed/Pipeline/Reader tabs, (3) context panel and inline editing wired through the ontology. Backend uses existing VaultAdapter + QMD search. Frontend uses React Query for caching, Zustand for UI state, existing primitives (Tag, TabBar, EmptyState, Skeleton).

**Tech Stack:** FastAPI (Python 3.14), React 19, TypeScript, Tailwind 4, React Query 5, Zustand 5, react-markdown 10, remark-gfm 4, react-syntax-highlighter 16, lucide-react icons.

**Initiative:** standalone (vault/knowledge workspace revamp)

---

## File Structure

### New Files

```
# Frontend — Components
core/qareen/screen/src/components/primitives/MarkdownRenderer.tsx   — Reusable markdown renderer (DESIGN.md compliant)
core/qareen/screen/src/components/knowledge/KnowledgeFeed.tsx       — Smart feed view (inbox/triage)
core/qareen/screen/src/components/knowledge/KnowledgePipeline.tsx   — Kanban pipeline view
core/qareen/screen/src/components/knowledge/KnowledgeReader.tsx     — Immersive reader + context panel
core/qareen/screen/src/components/knowledge/ContextPanel.tsx        — Related docs, people, tasks sidebar
core/qareen/screen/src/components/knowledge/FrontmatterEditor.tsx   — Inline frontmatter tag/stage editor
core/qareen/screen/src/components/knowledge/PipelineCard.tsx        — Card for pipeline kanban columns
core/qareen/screen/src/components/knowledge/FeedItem.tsx            — Card for feed items with actions

# Frontend — Hooks & Types
core/qareen/screen/src/hooks/useKnowledge.ts                       — React Query hooks for all new endpoints
core/qareen/screen/src/lib/types.ts                                — Extended with new response types (append)

# Frontend — Page
core/qareen/screen/src/pages/Vault.tsx                             — Rewrite to orchestrate Feed/Pipeline/Reader

# Backend — API
core/qareen/api/vault.py                                           — Add 5 new endpoints (modify existing)

# Backend — Schemas
core/qareen/api/schemas.py                                         — Add new response models (append)
```

### Modified Files

```
core/qareen/screen/src/components/primitives/index.ts              — Export MarkdownRenderer
core/qareen/screen/src/App.tsx                                     — Route updates (already done, verify)
core/qareen/screen/src/components/layout/Sidebar.tsx               — Already restructured, verify
```

---

## Chunk 1: Reusable MarkdownRenderer + Backend APIs

This chunk builds the foundation: a design-system-compliant markdown renderer that works everywhere, and the backend endpoints that power the knowledge workspace.

### Task 1: Extract MarkdownRenderer Primitive

**Files:**
- Create: `core/qareen/screen/src/components/primitives/MarkdownRenderer.tsx`
- Modify: `core/qareen/screen/src/components/primitives/index.ts`
- Modify: `core/qareen/screen/src/pages/Vault.tsx` (remove inline MarkdownContent, import primitive)

**Context:** The current Vault.tsx has a `MarkdownContent` component (lines 271-369) defined inline. Extract it into a reusable primitive that follows DESIGN.md exactly. This will be used by vault reader, session detail, meeting transcripts, daily briefings, and any future markdown surface.

- [ ] **Step 1: Create MarkdownRenderer.tsx**

```tsx
// core/qareen/screen/src/components/primitives/MarkdownRenderer.tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** If true, renders headings one level smaller (for nested contexts like cards) */
  compact?: boolean;
}

export function MarkdownRenderer({ content, className = '', compact = false }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => compact
            ? <h2 className="text-[19px] font-serif font-[650] text-text tracking-[-0.015em] mt-8 mb-3">{children}</h2>
            : <h1 className="text-[24px] font-serif font-[700] text-text tracking-[-0.02em] mt-10 mb-4 pb-3 border-b border-border">{children}</h1>,
          h2: ({ children }) => compact
            ? <h3 className="text-[16px] font-serif font-[600] text-text tracking-[-0.01em] mt-6 mb-2">{children}</h3>
            : <h2 className="text-[19px] font-serif font-[650] text-text tracking-[-0.015em] mt-8 mb-3">{children}</h2>,
          h3: ({ children }) => compact
            ? <h4 className="text-[14px] font-serif font-[600] text-text mt-4 mb-1.5">{children}</h4>
            : <h3 className="text-[16px] font-serif font-[600] text-text tracking-[-0.01em] mt-6 mb-2">{children}</h3>,
          p: ({ children }) => <p className="text-[15px] font-serif leading-[1.75] text-text-secondary mb-4">{children}</p>,
          li: ({ children }) => <li className="text-[15px] font-serif leading-[1.75] text-text-secondary mb-1">{children}</li>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-4 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-4 space-y-0.5">{children}</ol>,
          a: ({ href, children }) => (
            <a href={href} className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/30 transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }}>
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="border-l-[3px] border-accent/30 pl-4 my-4 text-text-tertiary italic font-serif">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-[600] text-text">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="border-border my-8" />,
          table: ({ children }) => <div className="overflow-x-auto my-4 rounded-[7px] border border-border"><table className="w-full text-[13px]">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-bg-tertiary">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 text-left font-[600] text-text-secondary border-b border-border text-[12px]">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-text-secondary border-b border-border/50 text-[13px]">{children}</td>,
          img: ({ src, alt }) => (
            <figure className="my-6">
              <img src={src} alt={alt || ''} className="rounded-[7px] border border-border max-w-full" loading="lazy" />
              {alt && <figcaption className="text-[12px] text-text-quaternary mt-2 text-center">{alt}</figcaption>}
            </figure>
          ),
          code: ({ className: cn, children }) => {
            const match = /language-(\w+)/.exec(cn || '');
            if (!match) return <code className="text-[13px] bg-bg-tertiary text-accent px-1.5 py-0.5 rounded-[4px] font-mono">{children}</code>;
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                customStyle={{
                  background: 'var(--color-bg-tertiary, #2A2520)',
                  padding: '16px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  margin: '16px 0',
                  border: '1px solid rgba(255, 245, 235, 0.06)',
                }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Export from primitives barrel**

Add to `core/qareen/screen/src/components/primitives/index.ts`:
```ts
export { MarkdownRenderer } from "./MarkdownRenderer";
```

- [ ] **Step 3: Replace inline MarkdownContent in Vault.tsx**

In `core/qareen/screen/src/pages/Vault.tsx`:
- Remove the `MarkdownContent` function (lines ~271-369)
- Add import: `import { MarkdownRenderer } from '@/components/primitives/MarkdownRenderer';`
- Replace all `<MarkdownContent body={...} />` with `<MarkdownRenderer content={...} />`

- [ ] **Step 4: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
git add core/qareen/screen/src/components/primitives/MarkdownRenderer.tsx \
        core/qareen/screen/src/components/primitives/index.ts \
        core/qareen/screen/src/pages/Vault.tsx
git commit -m "feat(knowledge): extract reusable MarkdownRenderer primitive"
```

---

### Task 2: Backend — Pipeline Stats Endpoint

**Files:**
- Modify: `core/qareen/api/vault.py` (add endpoint after line 173)
- Modify: `core/qareen/api/schemas.py` (add response models after line 640)

**Context:** The pipeline view needs to know how many documents are in each stage, which ones are stale, and what actions are suggested. This endpoint walks the vault filesystem, parses frontmatter, and computes pipeline health.

- [ ] **Step 1: Add schema models to schemas.py**

Append after line 640 in `core/qareen/api/schemas.py`:

```python
class PipelineStageInfo(BaseModel):
    """Stats for a single pipeline stage."""
    stage: int = Field(..., description="Stage number 1-6")
    label: str = Field(..., description="Human label")
    count: int = Field(0, description="Document count")
    stale_count: int = Field(0, description="Documents older than 30 days without downstream")
    items: list[VaultSearchResult] = Field(default_factory=list, description="Documents in this stage")


class PipelineStatsResponse(BaseModel):
    """Full pipeline health report."""
    stages: list[PipelineStageInfo] = Field(default_factory=list)
    total_documents: int = Field(0)
    unprocessed_captures: int = Field(0, description="Stage 1-2 items older than 7 days")
    synthesis_opportunities: int = Field(0, description="Research clusters ready for synthesis")
    stale_decisions: int = Field(0, description="Decisions older than 60 days referenced by newer docs")
```

- [ ] **Step 2: Add pipeline stats endpoint to vault.py**

Add after the `/search` endpoint (after line 173) in `core/qareen/api/vault.py`:

```python
from datetime import datetime, timedelta

STAGE_LABELS = {1: "Capture", 2: "Triage", 3: "Research", 4: "Synthesis", 5: "Decision", 6: "Expertise"}
STAGE_DIRS = {
    1: "knowledge/captures", 2: "knowledge/captures",
    3: "knowledge/research", 4: "knowledge/synthesis",
    5: "knowledge/decisions", 6: "knowledge/expertise",
}


@router.get("/pipeline")
async def pipeline_stats(request: Request) -> dict:
    """Pipeline health: counts per stage, stale items, synthesis opportunities."""
    from .schemas import PipelineStageInfo

    stages: dict[int, PipelineStageInfo] = {}
    for num, label in STAGE_LABELS.items():
        stages[num] = PipelineStageInfo(stage=num, label=label, count=0, stale_count=0, items=[])

    now = datetime.now()
    stale_threshold = now - timedelta(days=30)
    capture_stale_threshold = now - timedelta(days=7)
    total = 0
    unprocessed = 0

    for stage_num, subdir in STAGE_DIRS.items():
        dir_path = VAULT_DIR / subdir
        if not dir_path.is_dir():
            continue
        for entry in sorted(dir_path.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not entry.is_file() or entry.suffix != ".md":
                continue
            total += 1
            try:
                content = entry.read_text(encoding="utf-8", errors="replace")[:2000]
                fm, _ = _parse_frontmatter(content)
            except OSError:
                fm = {}

            rel_path = str(entry.relative_to(VAULT_DIR))
            title = fm.get("title", entry.stem)
            date_str = fm.get("date", "")
            file_stage = fm.get("stage", stage_num)
            if isinstance(file_stage, str) and file_stage.isdigit():
                file_stage = int(file_stage)
            if not isinstance(file_stage, int) or file_stage not in stages:
                file_stage = stage_num

            item = VaultSearchResult(
                path=rel_path, title=str(title), snippet="",
                score=0.0, collection="knowledge",
            )
            stages[file_stage].items.append(item)
            stages[file_stage].count += 1

            # Staleness check
            try:
                file_date = datetime.fromisoformat(str(date_str)) if date_str else datetime.fromtimestamp(entry.stat().st_mtime)
            except (ValueError, TypeError):
                file_date = datetime.fromtimestamp(entry.stat().st_mtime)

            if file_stage in (1, 2) and file_date < capture_stale_threshold:
                unprocessed += 1
                stages[file_stage].stale_count += 1
            elif file_date < stale_threshold:
                stages[file_stage].stale_count += 1

    # Cap items per stage to 20 for response size
    for info in stages.values():
        info.items = info.items[:20]

    # Count synthesis opportunities: research docs without downstream synthesis
    synthesis_opps = max(0, stages[3].count - stages[4].count * 3)

    return {
        "stages": [stages[i].model_dump() for i in sorted(stages)],
        "total_documents": total,
        "unprocessed_captures": unprocessed,
        "synthesis_opportunities": synthesis_opps,
        "stale_decisions": stages[5].stale_count,
    }
```

- [ ] **Step 3: Verify endpoint loads**

Run: `cd /Volumes/AOS-X/project/aos && python3 -c "from core.qareen.api.vault import router; print('OK:', [r.path for r in router.routes])"`
Expected: routes list includes `/pipeline`

- [ ] **Step 4: Commit**

```bash
git add core/qareen/api/vault.py core/qareen/api/schemas.py
git commit -m "feat(knowledge): add pipeline stats endpoint"
```

---

### Task 3: Backend — Promote & Archive Endpoints

**Files:**
- Modify: `core/qareen/api/vault.py` (add 2 endpoints)

**Context:** The pipeline view needs to move documents between stages. Promote updates the `stage` field in frontmatter and moves the file to the correct subdirectory. Archive sets `status: archived`.

- [ ] **Step 1: Add promote endpoint**

Append to `core/qareen/api/vault.py`:

```python
import shutil
import re as _re

STAGE_TO_DIR = {
    1: "knowledge/captures", 2: "knowledge/captures",
    3: "knowledge/research", 4: "knowledge/synthesis",
    5: "knowledge/decisions", 6: "knowledge/expertise",
}


@router.post("/promote/{path:path}")
async def promote_document(
    request: Request,
    path: str = PathParam(..., description="Relative file path within vault"),
    target_stage: int = Query(..., description="Target stage number 1-6", ge=1, le=6),
) -> JSONResponse:
    """Promote a document to a new pipeline stage. Updates frontmatter and moves file."""
    abs_path = VAULT_DIR / path
    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    try:
        abs_path.resolve().relative_to(VAULT_DIR.resolve())
    except ValueError:
        return JSONResponse({"error": "Access denied"}, status_code=403)

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    fm, body = _parse_frontmatter(content)

    # Update stage in frontmatter
    fm["stage"] = target_stage
    stage_label = STAGE_LABELS.get(target_stage, f"Stage {target_stage}")
    fm["type"] = stage_label.lower()

    # Rebuild frontmatter YAML
    import yaml
    new_content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True).rstrip() + "\n---\n\n" + body

    # Determine target directory
    target_dir = VAULT_DIR / STAGE_TO_DIR.get(target_stage, "knowledge/captures")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / abs_path.name

    # Avoid overwriting
    if target_path.exists() and target_path != abs_path:
        stem = abs_path.stem
        suffix = abs_path.suffix
        counter = 1
        while target_path.exists():
            target_path = target_dir / f"{stem}-{counter}{suffix}"
            counter += 1

    # Write new content and remove old file if moved
    target_path.write_text(new_content, encoding="utf-8")
    if target_path != abs_path:
        abs_path.unlink()

    new_rel = str(target_path.relative_to(VAULT_DIR))
    return JSONResponse({
        "ok": True,
        "old_path": path,
        "new_path": new_rel,
        "stage": target_stage,
        "label": stage_label,
    })
```

- [ ] **Step 2: Add archive endpoint**

```python
@router.post("/archive/{path:path}")
async def archive_document(
    request: Request,
    path: str = PathParam(..., description="Relative file path within vault"),
) -> JSONResponse:
    """Archive a document by setting status: archived in frontmatter."""
    abs_path = VAULT_DIR / path
    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    try:
        abs_path.resolve().relative_to(VAULT_DIR.resolve())
    except ValueError:
        return JSONResponse({"error": "Access denied"}, status_code=403)

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    fm, body = _parse_frontmatter(content)
    fm["status"] = "archived"

    import yaml
    new_content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True).rstrip() + "\n---\n\n" + body
    abs_path.write_text(new_content, encoding="utf-8")

    return JSONResponse({"ok": True, "path": path, "status": "archived"})
```

- [ ] **Step 3: Verify endpoints**

Run: `python3 -c "from core.qareen.api.vault import router; print([r.path for r in router.routes])"`
Expected: includes `/promote/{path:path}` and `/archive/{path:path}`

- [ ] **Step 4: Commit**

```bash
git add core/qareen/api/vault.py
git commit -m "feat(knowledge): add promote and archive endpoints"
```

---

### Task 4: Backend — Edit Endpoint (PATCH file)

**Files:**
- Modify: `core/qareen/api/vault.py`

**Context:** Inline editing needs to save changes back to markdown files. The PATCH endpoint accepts partial updates to frontmatter fields and/or body content.

- [ ] **Step 1: Add PATCH endpoint**

```python
from pydantic import BaseModel as PydanticBaseModel
from typing import Any


class VaultFileUpdate(PydanticBaseModel):
    """Partial update to a vault file."""
    frontmatter: dict[str, Any] | None = None
    body: str | None = None


@router.patch("/file/{path:path}")
async def update_file(
    request: Request,
    path: str = PathParam(..., description="Relative file path"),
    update: VaultFileUpdate = ...,
) -> JSONResponse:
    """Update a vault file's frontmatter and/or body content."""
    abs_path = VAULT_DIR / path
    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    try:
        abs_path.resolve().relative_to(VAULT_DIR.resolve())
    except ValueError:
        return JSONResponse({"error": "Access denied"}, status_code=403)

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    fm, existing_body = _parse_frontmatter(content)

    # Merge frontmatter updates (partial — only overwrite provided keys)
    if update.frontmatter is not None:
        for key, value in update.frontmatter.items():
            if value is None:
                fm.pop(key, None)
            else:
                fm[key] = value

    # Use new body if provided, otherwise keep existing
    final_body = update.body if update.body is not None else existing_body

    import yaml
    new_content = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True).rstrip() + "\n---\n\n" + final_body
    abs_path.write_text(new_content, encoding="utf-8")

    return JSONResponse({"ok": True, "path": path, "frontmatter": fm})
```

- [ ] **Step 2: Verify the endpoint**

Run: `python3 -c "from core.qareen.api.vault import router; print('PATCH' in [r.methods for r in router.routes if hasattr(r, 'methods')].__repr__())"`
Expected: True

- [ ] **Step 3: Commit**

```bash
git add core/qareen/api/vault.py
git commit -m "feat(knowledge): add PATCH endpoint for inline editing"
```

---

### Task 5: Backend — Related Documents Endpoint

**Files:**
- Modify: `core/qareen/api/vault.py`

**Context:** The context panel needs to show related documents for any given file. Uses QMD semantic search on the document's title + key tags, plus explicit frontmatter links (source_ref, linked_notes).

- [ ] **Step 1: Add related endpoint**

```python
@router.get("/related/{path:path}")
async def related_documents(
    request: Request,
    path: str = PathParam(..., description="Relative file path"),
    limit: int = Query(8, description="Max related docs", ge=1, le=20),
) -> JSONResponse:
    """Find documents related to the given file via semantic search + frontmatter links."""
    abs_path = VAULT_DIR / path
    if not abs_path.is_file():
        return JSONResponse({"error": f"File not found: {path}"}, status_code=404)

    try:
        content = abs_path.read_text(encoding="utf-8", errors="replace")[:3000]
    except OSError:
        content = ""

    fm, _ = _parse_frontmatter(content)
    title = fm.get("title", abs_path.stem)
    tags = fm.get("tags", [])
    source_ref = fm.get("source_ref", "")

    # Build search query from title + tags
    query_parts = [str(title)]
    if isinstance(tags, list):
        query_parts.extend(str(t) for t in tags[:5])
    search_query = " ".join(query_parts)

    # Semantic search via QMD
    semantic_results = _run_qmd(
        [QMD_PATH, "search", search_query, "--json", "-n", str(limit + 5)],
        timeout=5,
    )

    # Filter out the source document itself
    semantic_results = [r for r in semantic_results if r.path != path][:limit]

    # Explicit frontmatter links
    explicit_links: list[dict] = []
    if source_ref and isinstance(source_ref, str):
        ref_path = VAULT_DIR / source_ref
        if ref_path.is_file():
            try:
                ref_content = ref_path.read_text(encoding="utf-8", errors="replace")[:500]
                ref_fm, _ = _parse_frontmatter(ref_content)
                explicit_links.append({
                    "path": source_ref,
                    "title": ref_fm.get("title", ref_path.stem),
                    "relationship": "source",
                })
            except OSError:
                pass

    return JSONResponse({
        "path": path,
        "explicit_links": explicit_links,
        "semantic_neighbors": [
            {"path": r.path, "title": r.title, "score": r.score, "collection": r.collection}
            for r in semantic_results
        ],
    })
```

- [ ] **Step 2: Commit**

```bash
git add core/qareen/api/vault.py
git commit -m "feat(knowledge): add related documents endpoint"
```

---

### Task 6: Frontend Types & Hooks for New Endpoints

**Files:**
- Modify: `core/qareen/screen/src/lib/types.ts` (append new types)
- Create: `core/qareen/screen/src/hooks/useKnowledge.ts`

**Context:** Wire up React Query hooks for all new backend endpoints so the UI components have clean data access.

- [ ] **Step 1: Add types to types.ts**

Append after the VaultSearchRequest interface (line ~515) in `core/qareen/screen/src/lib/types.ts`:

```typescript
// Knowledge Pipeline
// -----------------------------------------------------------------------------

export interface PipelineStageInfo {
  stage: number
  label: string
  count: number
  stale_count: number
  items: VaultSearchResult[]
}

export interface PipelineStatsResponse {
  stages: PipelineStageInfo[]
  total_documents: number
  unprocessed_captures: number
  synthesis_opportunities: number
  stale_decisions: number
}

export interface RelatedDocumentsResponse {
  path: string
  explicit_links: { path: string; title: string; relationship: string }[]
  semantic_neighbors: { path: string; title: string; score: number; collection: string }[]
}

export interface VaultFileUpdate {
  frontmatter?: Record<string, unknown>
  body?: string
}
```

- [ ] **Step 2: Create useKnowledge.ts**

```typescript
// core/qareen/screen/src/hooks/useKnowledge.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PipelineStatsResponse,
  RelatedDocumentsResponse,
  VaultFileUpdate,
  VaultFileResponse,
} from '@/lib/types';

const API = '/api';

export function usePipelineStats() {
  return useQuery<PipelineStatsResponse>({
    queryKey: ['vault-pipeline'],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/pipeline`);
      if (!res.ok) throw new Error(`Pipeline stats error: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useRelatedDocuments(path: string | null) {
  return useQuery<RelatedDocumentsResponse>({
    queryKey: ['vault-related', path],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/related/${encodeURIComponent(path!)}`);
      if (!res.ok) throw new Error(`Related docs error: ${res.status}`);
      return res.json();
    },
    enabled: !!path,
    staleTime: 60_000,
  });
}

export function usePromoteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, targetStage }: { path: string; targetStage: number }) => {
      const res = await fetch(`${API}/vault/promote/${encodeURIComponent(path)}?target_stage=${targetStage}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Promote error: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
      qc.invalidateQueries({ queryKey: ['vault-collections'] });
    },
  });
}

export function useArchiveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`${API}/vault/archive/${encodeURIComponent(path)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Archive error: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
      qc.invalidateQueries({ queryKey: ['vault-collections'] });
    },
  });
}

export function useUpdateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, update }: { path: string; update: VaultFileUpdate }) => {
      const res = await fetch(`${API}/vault/file/${encodeURIComponent(path)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error(`Update error: ${res.status}`);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['vault-file', variables.path] });
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
    },
  });
}

export function useVaultFile(path: string | null) {
  return useQuery<VaultFileResponse>({
    queryKey: ['vault-file', path],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/file/${encodeURIComponent(path!)}`);
      if (!res.ok) throw new Error(`File error: ${res.status}`);
      return res.json();
    },
    enabled: !!path,
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add core/qareen/screen/src/lib/types.ts \
        core/qareen/screen/src/hooks/useKnowledge.ts
git commit -m "feat(knowledge): add types and React Query hooks for knowledge APIs"
```

---

## Chunk 2: Knowledge Page UI — Feed, Pipeline, Reader

This chunk builds the three main views of the Knowledge workspace.

### Task 7: FeedItem Component

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/FeedItem.tsx`

**Context:** The feed shows knowledge items with contextual actions (process, archive, defer). Each item is a card with title, metadata, staleness indicator, and action buttons. Used in the Knowledge Feed view.

- [ ] **Step 1: Create FeedItem.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/FeedItem.tsx
import { FileText, Archive, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { Tag, type TagColor } from '@/components/primitives/Tag';

const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

interface FeedItemProps {
  path: string;
  title: string;
  stage?: number;
  collection?: string;
  isStale?: boolean;
  onOpen: () => void;
  onPromote?: (targetStage: number) => void;
  onArchive?: () => void;
}

export function FeedItem({ path, title, stage, collection, isStale, onOpen, onPromote, onArchive }: FeedItemProps) {
  const nextStage = stage && stage < 6 ? stage + 1 : null;
  const displayName = title || path.split('/').pop()?.replace('.md', '') || path;

  return (
    <div className="group px-4 py-3.5 rounded-[7px] border border-border-secondary hover:border-border-tertiary bg-bg-secondary transition-all cursor-pointer" style={{ transitionDuration: '150ms' }}>
      <div className="flex items-start gap-3">
        <FileText className="w-4 h-4 text-text-quaternary shrink-0 mt-1 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
        <div className="flex-1 min-w-0" onClick={onOpen}>
          <span className="text-[14px] font-serif font-[500] text-text-secondary group-hover:text-text block truncate leading-tight transition-colors" style={{ transitionDuration: '80ms' }}>
            {displayName}
          </span>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {stage && (
              <Tag label={stageLabels[stage] || `Stage ${stage}`} color={stageColors[stage] || 'gray'} size="sm" />
            )}
            {collection && <Tag label={collection} color="gray" size="sm" />}
            {isStale && (
              <span className="inline-flex items-center gap-1 text-[10px] text-yellow">
                <AlertTriangle className="w-3 h-3" />
                <span>Stale</span>
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ transitionDuration: '150ms' }}>
          {nextStage && onPromote && (
            <button
              onClick={(e) => { e.stopPropagation(); onPromote(nextStage); }}
              className="flex items-center gap-1 px-2 h-7 rounded-[5px] text-[11px] font-[510] text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
              style={{ transitionDuration: '80ms' }}
              title={`Promote to ${stageLabels[nextStage]}`}
            >
              <ChevronRight className="w-3 h-3" />
              {stageLabels[nextStage]}
            </button>
          )}
          {onArchive && (
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
              className="p-1.5 rounded-[5px] text-text-quaternary hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
              style={{ transitionDuration: '80ms' }}
              title="Archive"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/FeedItem.tsx
git commit -m "feat(knowledge): add FeedItem component with promote/archive actions"
```

---

### Task 8: KnowledgeFeed View

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/KnowledgeFeed.tsx`

**Context:** The Feed is the default view for `/vault/knowledge`. It shows a curated list of items that need attention: unprocessed captures, stale research, synthesis opportunities. Uses the pipeline stats endpoint for data and FeedItem for rendering.

- [ ] **Step 1: Create KnowledgeFeed.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/KnowledgeFeed.tsx
import { Inbox, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usePipelineStats, usePromoteDocument, useArchiveDocument } from '@/hooks/useKnowledge';
import { Skeleton } from '@/components/primitives';
import { FeedItem } from './FeedItem';

interface KnowledgeFeedProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgeFeed({ onOpenFile }: KnowledgeFeedProps) {
  const { data: pipeline, isLoading } = usePipelineStats();
  const promote = usePromoteDocument();
  const archive = useArchiveDocument();

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full rounded-[7px]" />
        <Skeleton className="h-20 w-full rounded-[7px]" />
        <Skeleton className="h-20 w-full rounded-[7px]" />
      </div>
    );
  }

  if (!pipeline) return null;

  // Build feed sections
  const captures = pipeline.stages.find(s => s.stage === 1);
  const staleCaptures = captures?.items.filter((_, i) => i < captures.stale_count) || [];
  const freshCaptures = captures?.items.filter((_, i) => i >= (captures?.stale_count || 0)).slice(0, 5) || [];
  const researchStage = pipeline.stages.find(s => s.stage === 3);
  const staleResearch = researchStage?.items.slice(0, researchStage.stale_count).slice(0, 5) || [];

  const hasItems = staleCaptures.length > 0 || freshCaptures.length > 0 || staleResearch.length > 0 || pipeline.synthesis_opportunities > 0;

  return (
    <div className="space-y-8">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Documents" value={pipeline.total_documents} />
        <StatCard label="Unprocessed" value={pipeline.unprocessed_captures} alert={pipeline.unprocessed_captures > 0} />
        <StatCard label="Synthesis ready" value={pipeline.synthesis_opportunities} accent={pipeline.synthesis_opportunities > 0} />
        <StatCard label="Stale decisions" value={pipeline.stale_decisions} alert={pipeline.stale_decisions > 0} />
      </div>

      {/* Unprocessed captures */}
      {staleCaptures.length > 0 && (
        <FeedSection
          icon={<Inbox className="w-4 h-4" />}
          title="Unprocessed captures"
          subtitle={`${staleCaptures.length} items older than 7 days`}
        >
          {staleCaptures.map(item => (
            <FeedItem
              key={item.path}
              path={item.path}
              title={item.title || ''}
              stage={1}
              isStale
              onOpen={() => onOpenFile(item.path)}
              onPromote={(s) => promote.mutate({ path: item.path, targetStage: s })}
              onArchive={() => archive.mutate(item.path)}
            />
          ))}
        </FeedSection>
      )}

      {/* Fresh captures */}
      {freshCaptures.length > 0 && (
        <FeedSection
          icon={<Sparkles className="w-4 h-4" />}
          title="Recent captures"
          subtitle="New items to triage"
        >
          {freshCaptures.map(item => (
            <FeedItem
              key={item.path}
              path={item.path}
              title={item.title || ''}
              stage={1}
              onOpen={() => onOpenFile(item.path)}
              onPromote={(s) => promote.mutate({ path: item.path, targetStage: s })}
              onArchive={() => archive.mutate(item.path)}
            />
          ))}
        </FeedSection>
      )}

      {/* Synthesis opportunities */}
      {pipeline.synthesis_opportunities > 0 && staleResearch.length > 0 && (
        <FeedSection
          icon={<Sparkles className="w-4 h-4" />}
          title="Ready for synthesis"
          subtitle={`${pipeline.synthesis_opportunities} research docs could be synthesized`}
        >
          {staleResearch.map(item => (
            <FeedItem
              key={item.path}
              path={item.path}
              title={item.title || ''}
              stage={3}
              isStale
              onOpen={() => onOpenFile(item.path)}
              onPromote={(s) => promote.mutate({ path: item.path, targetStage: s })}
            />
          ))}
        </FeedSection>
      )}

      {/* All clear */}
      {!hasItems && (
        <div className="flex flex-col items-center justify-center py-20">
          <CheckCircle2 className="w-10 h-10 text-green opacity-30 mb-4" />
          <p className="text-[14px] font-serif text-text-tertiary">Knowledge is up to date</p>
          <p className="text-[12px] text-text-quaternary mt-1">No items need attention right now</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, alert, accent }: { label: string; value: number; alert?: boolean; accent?: boolean }) {
  return (
    <div className="p-3 rounded-[7px] border border-border-secondary bg-bg-secondary">
      <div className={`text-[20px] font-[600] tabular-nums ${alert ? 'text-yellow' : accent ? 'text-accent' : 'text-text'}`}>
        {value}
      </div>
      <div className="text-[11px] text-text-quaternary mt-0.5">{label}</div>
    </div>
  );
}

function FeedSection({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-text-quaternary">{icon}</span>
        <div>
          <span className="text-[13px] font-[510] text-text">{title}</span>
          <span className="text-[11px] text-text-quaternary ml-2">{subtitle}</span>
        </div>
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/KnowledgeFeed.tsx
git commit -m "feat(knowledge): add KnowledgeFeed view with triage actions"
```

---

### Task 9: KnowledgePipeline View (Kanban)

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/PipelineCard.tsx`
- Create: `core/qareen/screen/src/components/knowledge/KnowledgePipeline.tsx`

**Context:** Visual kanban showing documents flowing through 6 stages. Each column shows count, stale indicator, and scrollable list of document cards. Click to open in reader.

- [ ] **Step 1: Create PipelineCard.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/PipelineCard.tsx
import { FileText } from 'lucide-react';

interface PipelineCardProps {
  title: string;
  path: string;
  onClick: () => void;
}

export function PipelineCard({ title, path, onClick }: PipelineCardProps) {
  const displayName = title || path.split('/').pop()?.replace('.md', '') || path;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group"
      style={{ transitionDuration: '80ms' }}
    >
      <div className="flex items-start gap-2">
        <FileText className="w-3.5 h-3.5 text-text-quaternary shrink-0 mt-0.5 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
        <span className="text-[13px] font-serif text-text-secondary group-hover:text-text line-clamp-2 leading-tight transition-colors" style={{ transitionDuration: '80ms' }}>
          {displayName}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create KnowledgePipeline.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/KnowledgePipeline.tsx
import { AlertTriangle } from 'lucide-react';
import { usePipelineStats } from '@/hooks/useKnowledge';
import { Skeleton } from '@/components/primitives';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { PipelineCard } from './PipelineCard';

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

interface KnowledgePipelineProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgePipeline({ onOpenFile }: KnowledgePipelineProps) {
  const { data: pipeline, isLoading } = usePipelineStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-32 w-full rounded-[7px]" />
          </div>
        ))}
      </div>
    );
  }

  if (!pipeline) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {pipeline.stages.map(stage => (
        <div key={stage.stage} className="flex flex-col">
          {/* Column header */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <Tag label={stage.label} color={stageColors[stage.stage] || 'gray'} size="sm" />
            <span className="text-[12px] text-text-quaternary tabular-nums">{stage.count}</span>
            {stage.stale_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-yellow ml-auto">
                <AlertTriangle className="w-3 h-3" />
                {stage.stale_count}
              </span>
            )}
          </div>

          {/* Column body */}
          <div className="flex-1 rounded-[7px] border border-border bg-bg-secondary p-1.5 min-h-[120px] max-h-[60vh] overflow-y-auto">
            {stage.items.length > 0 ? (
              <div className="space-y-0.5">
                {stage.items.map(item => (
                  <PipelineCard
                    key={item.path}
                    title={item.title || ''}
                    path={item.path}
                    onClick={() => onOpenFile(item.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full py-8">
                <span className="text-[11px] text-text-quaternary">Empty</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/PipelineCard.tsx \
        core/qareen/screen/src/components/knowledge/KnowledgePipeline.tsx
git commit -m "feat(knowledge): add KnowledgePipeline kanban view"
```

---

### Task 10: ContextPanel Component

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/ContextPanel.tsx`

**Context:** When reading a document, this panel shows related documents (semantic neighbors + explicit links), frontmatter metadata, and provenance chain. Slides in from the right on desktop, becomes a bottom sheet on mobile.

- [ ] **Step 1: Create ContextPanel.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/ContextPanel.tsx
import { X, FileText, Link2, Brain, Clock, Hash, Layers } from 'lucide-react';
import { useRelatedDocuments } from '@/hooks/useKnowledge';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { Skeleton } from '@/components/primitives';

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};
const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};

interface ContextPanelProps {
  path: string;
  frontmatter: Record<string, unknown> | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export function ContextPanel({ path, frontmatter, onClose, onNavigate }: ContextPanelProps) {
  const { data: related, isLoading } = useRelatedDocuments(path);
  const fm = frontmatter || {};

  return (
    <div className="h-full flex flex-col bg-bg-panel border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-[12px] font-[510] text-text-tertiary">Context</span>
        <button onClick={onClose} className="p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
          <X className="w-3.5 h-3.5 text-text-quaternary" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Metadata */}
        <div>
          <SectionLabel icon={<Layers className="w-3 h-3" />} label="Metadata" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {fm.stage && (
              <Tag
                label={stageLabels[Number(fm.stage)] || `Stage ${fm.stage}`}
                color={stageColors[Number(fm.stage)] || 'gray'}
                size="sm"
              />
            )}
            {fm.type && <Tag label={String(fm.type)} color="gray" size="sm" />}
            {fm.status && <Tag label={String(fm.status)} color={String(fm.status) === 'active' ? 'green' : 'gray'} size="sm" />}
            {fm.project && <Tag label={String(fm.project)} color="purple" size="sm" />}
          </div>
          {fm.date && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-text-quaternary">
              <Clock className="w-3 h-3" />
              <span>{String(fm.date)}</span>
            </div>
          )}
          {fm.tags && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-quaternary">
              <Hash className="w-3 h-3" />
              <span>{Array.isArray(fm.tags) ? fm.tags.join(', ') : String(fm.tags)}</span>
            </div>
          )}
        </div>

        {/* Explicit links (provenance) */}
        {related?.explicit_links && related.explicit_links.length > 0 && (
          <div>
            <SectionLabel icon={<Link2 className="w-3 h-3" />} label="Provenance" />
            <div className="mt-2 space-y-1">
              {related.explicit_links.map(link => (
                <button
                  key={link.path}
                  onClick={() => onNavigate(link.path)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group"
                  style={{ transitionDuration: '80ms' }}
                >
                  <FileText className="w-3.5 h-3.5 text-text-quaternary group-hover:text-accent shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[12px] text-text-secondary group-hover:text-text block truncate">{link.title}</span>
                    <span className="text-[10px] text-text-quaternary">{link.relationship}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Semantic neighbors */}
        <div>
          <SectionLabel icon={<Brain className="w-3 h-3" />} label="Related" />
          {isLoading ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : related?.semantic_neighbors && related.semantic_neighbors.length > 0 ? (
            <div className="mt-2 space-y-1">
              {related.semantic_neighbors.map(doc => (
                <button
                  key={doc.path}
                  onClick={() => onNavigate(doc.path)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group"
                  style={{ transitionDuration: '80ms' }}
                >
                  <FileText className="w-3.5 h-3.5 text-text-quaternary group-hover:text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] text-text-secondary group-hover:text-text block truncate">{doc.title}</span>
                    <span className="text-[10px] text-text-quaternary">{doc.collection}</span>
                  </div>
                  <div className="w-8 h-1 bg-bg-tertiary rounded-full overflow-hidden shrink-0">
                    <div className="h-full bg-accent/40 rounded-full" style={{ width: `${Math.min(100, doc.score * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-text-quaternary mt-2">No related documents found</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-quaternary">{icon}</span>
      <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-text-quaternary">{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/ContextPanel.tsx
git commit -m "feat(knowledge): add ContextPanel with related docs and metadata"
```

---

### Task 11: FrontmatterEditor Component

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/FrontmatterEditor.tsx`

**Context:** Inline editing of frontmatter fields — tags, stage, status, project. Renders as a compact bar below the document title. Edit mode toggled by clicking an edit button.

- [ ] **Step 1: Create FrontmatterEditor.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/FrontmatterEditor.tsx
import { useState } from 'react';
import { Pencil, Check, X, Plus } from 'lucide-react';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { useUpdateFile } from '@/hooks/useKnowledge';

const stageOptions = [
  { value: 1, label: 'Capture' }, { value: 2, label: 'Triage' },
  { value: 3, label: 'Research' }, { value: 4, label: 'Synthesis' },
  { value: 5, label: 'Decision' }, { value: 6, label: 'Expertise' },
];

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

interface FrontmatterEditorProps {
  path: string;
  frontmatter: Record<string, unknown>;
}

export function FrontmatterEditor({ path, frontmatter }: FrontmatterEditorProps) {
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<number>(Number(frontmatter.stage) || 1);
  const [tags, setTags] = useState<string[]>(
    Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : []
  );
  const [newTag, setNewTag] = useState('');
  const updateFile = useUpdateFile();

  const save = () => {
    updateFile.mutate({
      path,
      update: { frontmatter: { stage, tags } },
    }, {
      onSuccess: () => setEditing(false),
    });
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <div className="flex flex-wrap items-center gap-1.5">
          {frontmatter.stage && (
            <Tag label={stageOptions.find(s => s.value === Number(frontmatter.stage))?.label || `Stage ${frontmatter.stage}`} color={stageColors[Number(frontmatter.stage)] || 'gray'} size="sm" />
          )}
          {Array.isArray(frontmatter.tags) && frontmatter.tags.map(t => (
            <Tag key={String(t)} label={String(t)} color="gray" size="sm" />
          ))}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded-[4px] text-text-quaternary hover:text-text-tertiary hover:bg-hover opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
          style={{ transitionDuration: '150ms' }}
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-[7px] border border-border-tertiary bg-bg-secondary space-y-3">
      {/* Stage selector */}
      <div>
        <label className="text-[10px] font-[590] uppercase tracking-[0.08em] text-text-quaternary block mb-1.5">Stage</label>
        <div className="flex flex-wrap gap-1.5">
          {stageOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStage(opt.value)}
              className={`px-2 h-6 rounded-xs text-[11px] font-[510] transition-colors cursor-pointer ${
                stage === opt.value
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-bg-tertiary text-text-tertiary border border-transparent hover:text-text-secondary'
              }`}
              style={{ transitionDuration: '80ms' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="text-[10px] font-[590] uppercase tracking-[0.08em] text-text-quaternary block mb-1.5">Tags</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 h-5 rounded-xs text-[11px] bg-bg-tertiary text-text-secondary">
              {t}
              <button onClick={() => setTags(tags.filter(x => x !== t))} className="text-text-quaternary hover:text-red cursor-pointer">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); if (newTag.trim() && !tags.includes(newTag.trim())) { setTags([...tags, newTag.trim()]); setNewTag(''); } }} className="inline-flex">
            <input
              type="text"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              placeholder="Add tag..."
              className="w-20 h-5 text-[11px] bg-transparent text-text placeholder:text-text-quaternary outline-none border-b border-border-secondary focus:border-accent"
            />
          </form>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={updateFile.isPending}
          className="flex items-center gap-1 px-2.5 h-7 rounded-[5px] text-[11px] font-[510] bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
          style={{ transitionDuration: '80ms' }}
        >
          <Check className="w-3 h-3" />
          Save
        </button>
        <button
          onClick={() => { setEditing(false); setStage(Number(frontmatter.stage) || 1); setTags(Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : []); }}
          className="flex items-center gap-1 px-2.5 h-7 rounded-[5px] text-[11px] font-[510] text-text-tertiary hover:text-text hover:bg-hover transition-colors cursor-pointer"
          style={{ transitionDuration: '80ms' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/FrontmatterEditor.tsx
git commit -m "feat(knowledge): add FrontmatterEditor for inline metadata editing"
```

---

### Task 12: KnowledgeReader View

**Files:**
- Create: `core/qareen/screen/src/components/knowledge/KnowledgeReader.tsx`

**Context:** Immersive document reader with context panel toggle. Uses MarkdownRenderer for content, FrontmatterEditor for metadata, ContextPanel for related docs. Full-width on mobile, split view on desktop when context panel is open.

- [ ] **Step 1: Create KnowledgeReader.tsx**

```tsx
// core/qareen/screen/src/components/knowledge/KnowledgeReader.tsx
import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ChevronRight, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { MarkdownRenderer } from '@/components/primitives/MarkdownRenderer';
import { Skeleton } from '@/components/primitives';
import { useVaultFile } from '@/hooks/useKnowledge';
import { ContextPanel } from './ContextPanel';
import { FrontmatterEditor } from './FrontmatterEditor';

interface KnowledgeReaderProps {
  path: string;
  onBack: () => void;
  onNavigate: (path: string) => void;
}

export function KnowledgeReader({ path, onBack, onNavigate }: KnowledgeReaderProps) {
  const { data: file, isLoading } = useVaultFile(path);
  const [contextOpen, setContextOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top on navigation
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [path]);

  const breadcrumbs = path.split('/');
  const title = (file?.frontmatter?.title as string) || file?.title || path.split('/').pop()?.replace('.md', '') || path;

  return (
    <div className="h-full flex bg-bg">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2 sm:py-3 border-b border-border">
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={onBack} className="p-2 sm:p-1.5 -ml-2 sm:-ml-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
              <ArrowLeft className="w-4 h-4 text-text-tertiary" />
            </button>

            {/* Mobile title */}
            <h1 className="sm:hidden text-[14px] font-serif font-[590] text-text truncate flex-1">{title}</h1>

            {/* Desktop breadcrumbs */}
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-text-quaternary flex-1 min-w-0">
              <button onClick={onBack} className="hover:text-text-tertiary shrink-0 cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>knowledge</button>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                  <span className={`truncate ${i === breadcrumbs.length - 1 ? 'text-text-tertiary font-[510]' : ''}`}>{crumb.replace('.md', '')}</span>
                </span>
              ))}
            </div>

            {/* Context toggle */}
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className="p-2 sm:p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors"
              style={{ transitionDuration: '80ms' }}
              title={contextOpen ? 'Close context' : 'Show context'}
            >
              {contextOpen
                ? <PanelRightClose className="w-4 h-4 text-accent" />
                : <PanelRightOpen className="w-4 h-4 text-text-quaternary" />
              }
            </button>
          </div>
        </div>

        {/* Document */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-6 sm:py-10 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="mt-8 space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            </div>
          ) : file ? (
            <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-6 sm:py-10">
              <h1 className="hidden sm:block text-[26px] font-serif font-[700] text-text tracking-[-0.025em] leading-[1.2]">
                {title}
              </h1>
              {file.frontmatter && (
                <div className="mt-4">
                  <FrontmatterEditor path={path} frontmatter={file.frontmatter} />
                </div>
              )}
              <div className="mt-6 sm:mt-8" />
              <MarkdownRenderer content={file.content} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Context panel — desktop sidebar, mobile bottom overlay */}
      {contextOpen && file && (
        <>
          {/* Desktop */}
          <div className="hidden md:block w-[300px] shrink-0">
            <ContextPanel
              path={path}
              frontmatter={file.frontmatter}
              onClose={() => setContextOpen(false)}
              onNavigate={onNavigate}
            />
          </div>
          {/* Mobile overlay */}
          <div className="md:hidden fixed inset-0 z-50" onClick={() => setContextOpen(false)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="absolute bottom-0 left-0 right-0 max-h-[70vh] bg-bg-panel rounded-t-[12px] border-t border-border overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <ContextPanel
                path={path}
                frontmatter={file.frontmatter}
                onClose={() => setContextOpen(false)}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add core/qareen/screen/src/components/knowledge/KnowledgeReader.tsx
git commit -m "feat(knowledge): add KnowledgeReader with context panel and inline editing"
```

---

### Task 13: Rewrite Vault.tsx as Knowledge Workspace Orchestrator

**Files:**
- Modify: `core/qareen/screen/src/pages/Vault.tsx` (full rewrite)

**Context:** The page orchestrates three views (Feed, Pipeline, Reader) based on the current route and user interaction. Uses TabBar to switch between Feed and Pipeline when no document is selected. When a document is opened, switches to Reader. Preserves the existing search functionality (3-tier progressive search) and tree overlay.

- [ ] **Step 1: Rewrite Vault.tsx**

The page becomes an orchestrator. The key structure:
- Route `/vault/knowledge` → Feed (default tab) or Pipeline tab, with search
- When a file is selected → KnowledgeReader with context panel
- Preserves: fuzzy search, BM25/enhanced tiers, tree overlay, collection cards for `/vault` base route
- Routes `/vault/journal` and `/vault/logs` keep the simpler browse behavior (tree + search)

The Vault.tsx file should:
1. Keep all existing imports and helper functions (types, stage metadata, fuzzySearch, FolderTree, SearchResultCard, TreeOverlay, CollectionCard)
2. Remove the inline `MarkdownContent` and `FrontmatterBar` functions (replaced by MarkdownRenderer and FrontmatterEditor)
3. Add imports for new components: `KnowledgeFeed`, `KnowledgePipeline`, `KnowledgeReader`, `TabBar`
4. For the `knowledge` section: render TabBar with "Feed" and "Pipeline" tabs, show search above, switch content based on active tab
5. When `selectedPath` is set: render `KnowledgeReader` instead of the inline reader
6. For `journal` and `logs` sections: keep the existing tree-browse behavior

Key change in the `VaultPage` function:
- Add `const [activeTab, setActiveTab] = useState<'feed' | 'pipeline'>('feed');`
- In the browse view for `knowledge` section, replace the inline tree with TabBar + KnowledgeFeed/KnowledgePipeline
- Replace the inline file reader with `<KnowledgeReader path={selectedPath} onBack={goBack} onNavigate={loadFile} />`
- Keep all other sections (journal, logs, all) with existing browse behavior

The specific code changes are:
- Import `{ TabBar }` from `@/components/primitives`
- Import `{ KnowledgeFeed }` from `@/components/knowledge/KnowledgeFeed`
- Import `{ KnowledgePipeline }` from `@/components/knowledge/KnowledgePipeline`
- Import `{ KnowledgeReader }` from `@/components/knowledge/KnowledgeReader`
- Remove the `FrontmatterBar` function entirely
- Remove the `MarkdownContent` function entirely (already done in Task 1)
- Add `import { MarkdownRenderer } from '@/components/primitives/MarkdownRenderer'`
- In the file reader section (when `file` is set AND `section === 'knowledge'`), render `<KnowledgeReader>` instead of the inline reader
- In the browse section for knowledge, add TabBar with Feed/Pipeline toggle
- Keep the existing reader for journal/logs sections (they use MarkdownRenderer directly)

- [ ] **Step 2: Type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`
Expected: Clean compile. All imports resolve.

- [ ] **Step 3: Visual test**

Run: `cd core/qareen/screen && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add core/qareen/screen/src/pages/Vault.tsx
git commit -m "feat(knowledge): rewrite Vault.tsx as knowledge workspace orchestrator"
```

---

## Chunk 3: Integration & Polish

### Task 14: Wire All Imports and Verify Full Build

**Files:**
- Verify: all new components compile together
- Verify: backend endpoints load without import errors

- [ ] **Step 1: Frontend type-check**

Run: `cd core/qareen/screen && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Frontend production build**

Run: `cd core/qareen/screen && npm run build`
Expected: Build succeeds, bundle output in `dist/`.

- [ ] **Step 3: Backend import check**

Run: `cd /Volumes/AOS-X/project/aos && python3 -c "from core.qareen.api.vault import router; print('Routes:', len(router.routes)); [print(f'  {r.methods} {r.path}') for r in router.routes if hasattr(r, 'methods')]"`
Expected: 8+ routes listed (collections, search, tree, logs, file, pipeline, promote, archive, related, file PATCH).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(knowledge): complete knowledge workspace — feed, pipeline, reader, context panel, inline editing"
```

---

## Summary

| Component | File | What It Does |
|-----------|------|-------------|
| MarkdownRenderer | `primitives/MarkdownRenderer.tsx` | Reusable DESIGN.md-compliant markdown renderer |
| Pipeline Stats API | `api/vault.py` `/pipeline` | Stage counts, stale items, synthesis opportunities |
| Promote API | `api/vault.py` `/promote/{path}` | Move documents between stages |
| Archive API | `api/vault.py` `/archive/{path}` | Set status: archived in frontmatter |
| Edit API | `api/vault.py` `PATCH /file/{path}` | Update frontmatter and/or body |
| Related API | `api/vault.py` `/related/{path}` | Semantic neighbors + explicit links |
| useKnowledge hooks | `hooks/useKnowledge.ts` | React Query hooks for all new endpoints |
| FeedItem | `knowledge/FeedItem.tsx` | Card with promote/archive actions |
| KnowledgeFeed | `knowledge/KnowledgeFeed.tsx` | Smart feed — unprocessed, stale, synthesis opps |
| PipelineCard | `knowledge/PipelineCard.tsx` | Compact card for kanban columns |
| KnowledgePipeline | `knowledge/KnowledgePipeline.tsx` | 6-column kanban of pipeline stages |
| ContextPanel | `knowledge/ContextPanel.tsx` | Related docs, metadata, provenance chain |
| FrontmatterEditor | `knowledge/FrontmatterEditor.tsx` | Inline stage/tag editing |
| KnowledgeReader | `knowledge/KnowledgeReader.tsx` | Immersive reader + context panel + editing |
| Vault.tsx | `pages/Vault.tsx` | Orchestrator — routes to Feed/Pipeline/Reader |
