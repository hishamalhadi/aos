import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, FolderOpen, FolderClosed, FileText, ChevronRight, ChevronDown, X, Clock, BookOpen, Hash, Layers, ArrowLeft, FolderTree as FolderTreeIcon, Library, CalendarDays, ScrollText } from 'lucide-react';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { TabBar } from '@/components/primitives';
import { MarkdownRenderer } from '@/components/primitives/MarkdownRenderer';
import { KnowledgeFeed, KnowledgePipeline, KnowledgeReader } from '@/components/knowledge';

const API = '/api';

// ---------------------------------------------------------------------------
// Route → section mapping
// ---------------------------------------------------------------------------

type VaultSection = 'all' | 'knowledge' | 'journal' | 'logs';

const sectionMeta: Record<VaultSection, { title: string; description: string; icon: typeof Library; collections: string[] }> = {
  all: {
    title: 'Vault',
    description: 'Your collected knowledge, research, and decisions.',
    icon: Library,
    collections: [],
  },
  knowledge: {
    title: 'Knowledge',
    description: 'Research, decisions, expertise, and references.',
    icon: BookOpen,
    collections: ['knowledge'],
  },
  journal: {
    title: 'Journal',
    description: 'Daily logs, weekly reviews, and reflections.',
    icon: CalendarDays,
    collections: ['log'],
  },
  logs: {
    title: 'Logs',
    description: 'Session exports and friction reports.',
    icon: ScrollText,
    collections: ['log'],
  },
};

function useSectionFromRoute(): VaultSection {
  const { pathname } = useLocation();
  if (pathname.startsWith('/vault/knowledge')) return 'knowledge';
  if (pathname.startsWith('/vault/journal')) return 'journal';
  if (pathname.startsWith('/vault/logs')) return 'logs';
  return 'all';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode { name: string; path: string; type: 'folder' | 'file'; children?: TreeNode[]; count?: number; }
interface VaultFile { path: string; name: string; title?: string; content: string; body?: string; frontmatter: Record<string, unknown> | null; size_bytes?: number; }
interface SearchResult { path: string; name: string; snippet?: string; score?: number; collection?: string; source?: 'fuzzy' | 'fast' | 'enhanced'; }
interface Collection { name: string; doc_count: number; path?: string; }

// ---------------------------------------------------------------------------
// Tier 0 — Client-side fuzzy matching on file tree
// ---------------------------------------------------------------------------

/** Flatten a tree into a list of file paths + names. */
function flattenTree(nodes: TreeNode[]): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  function walk(items: TreeNode[]) {
    for (const node of items) {
      if (node.type === 'file') {
        result.push({ name: node.name, path: node.path });
      }
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

/** Simple fuzzy match — checks if all query chars appear in order in the target. */
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring match is best
  const substringIdx = t.indexOf(q);
  if (substringIdx !== -1) {
    // Boost if match starts at word boundary
    const atBoundary = substringIdx === 0 || t[substringIdx - 1] === '/' || t[substringIdx - 1] === '-' || t[substringIdx - 1] === ' ';
    return { match: true, score: atBoundary ? 0.95 : 0.85 };
  }

  // Subsequence match
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return { match: false, score: 0 };
  return { match: true, score: 0.3 + (maxConsecutive / q.length) * 0.4 };
}

function fuzzySearch(query: string, files: { name: string; path: string }[], limit = 8): SearchResult[] {
  if (query.length < 2) return [];
  const scored: { file: { name: string; path: string }; score: number }[] = [];
  for (const file of files) {
    const nameMatch = fuzzyMatch(query, file.name.replace('.md', ''));
    const pathMatch = fuzzyMatch(query, file.path);
    const best = nameMatch.score >= pathMatch.score ? nameMatch : pathMatch;
    if (best.match) {
      scored.push({ file, score: best.score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => ({
    path: s.file.path,
    name: s.file.name,
    score: s.score,
    collection: s.file.path.split('/')[0],
    source: 'fuzzy' as const,
  }));
}

// ---------------------------------------------------------------------------
// Stage / status / type metadata
// ---------------------------------------------------------------------------

const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

const statusColors: Record<string, TagColor> = {
  active: 'green', draft: 'yellow', review: 'blue', archived: 'gray',
  done: 'green', blocked: 'red', paused: 'orange',
};

const typeColors: Record<string, TagColor> = {
  capture: 'gray', research: 'blue', synthesis: 'purple', decision: 'green',
  expertise: 'orange', reference: 'teal', initiative: 'yellow',
  daily: 'gray', weekly: 'blue', session: 'purple',
};

function tagColorForValue(key: string, value: string): TagColor {
  if (key === 'stage') return stageColors[Number(value)] || 'gray';
  if (key === 'status') return statusColors[value.toLowerCase()] || 'gray';
  if (key === 'type') return typeColors[value.toLowerCase()] || 'gray';
  return 'gray';
}

const collectionDescriptions: Record<string, string> = {
  log: 'Daily logs, session exports, weekly reviews',
  knowledge: 'Research, decisions, expertise, references',
  skills: 'Skill definitions and protocols',
  agents: 'Agent definitions — Chief, Steward, Advisor',
  'aos-docs': 'System documentation and guides',
};

const collectionIcons: Record<string, string> = {
  log: '📅', knowledge: '🧠', skills: '⚡', agents: '🤖', 'aos-docs': '📖',
};

// ---------------------------------------------------------------------------
// Folder Tree (overlay panel)
// ---------------------------------------------------------------------------

function FolderTree({ nodes, selectedPath, onSelect, expandedPaths, onToggle, depth = 0 }: {
  nodes: TreeNode[]; selectedPath: string; onSelect: (path: string) => void;
  expandedPaths: Set<string>; onToggle: (path: string) => void; depth?: number;
}) {
  if (!Array.isArray(nodes)) return null;
  return (
    <div className={depth > 0 ? 'ml-3' : ''}>
      {nodes.map(node => (
        <Fragment key={node.path}>
          {node.type === 'folder' ? (
            <>
              <button
                onClick={() => onToggle(node.path)}
                className="w-full flex items-center gap-1.5 py-2 px-2.5 rounded-[5px] text-left hover:bg-hover transition-colors cursor-pointer"
                style={{ transitionDuration: '80ms' }}
              >
                {expandedPaths.has(node.path)
                  ? <ChevronDown className="w-3 h-3 text-text-quaternary shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-text-quaternary shrink-0" />
                }
                {expandedPaths.has(node.path)
                  ? <FolderOpen className="w-4 h-4 text-accent/70 shrink-0" />
                  : <FolderClosed className="w-4 h-4 text-text-tertiary shrink-0" />
                }
                <span className="text-[13px] text-text-secondary truncate flex-1">{node.name}</span>
                {node.count !== undefined && node.count > 0 && (
                  <span className="text-[10px] text-text-quaternary ml-auto shrink-0 tabular-nums bg-bg-tertiary rounded-xs px-1.5 py-0.5 leading-none">{node.count}</span>
                )}
              </button>
              {expandedPaths.has(node.path) && node.children && (
                <FolderTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} expandedPaths={expandedPaths} onToggle={onToggle} depth={depth + 1} />
              )}
            </>
          ) : (
            <button
              onClick={() => onSelect(node.path)}
              className={`
                w-full flex items-center gap-1.5 py-2 px-2.5 pl-[26px] rounded-[5px] text-left transition-colors cursor-pointer
                ${selectedPath === node.path
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-hover text-text-secondary'
                }
              `}
              style={{ transitionDuration: '80ms' }}
            >
              <FileText className={`w-4 h-4 shrink-0 ${selectedPath === node.path ? 'text-accent' : 'text-text-quaternary'}`} />
              <span className="text-[13px] truncate">{node.name.replace('.md', '')}</span>
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Result Card
// ---------------------------------------------------------------------------

function SearchResultCard({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  const displayName = result.name?.replace('.md', '') || result.path.split('/').pop()?.replace('.md', '') || result.path;
  const collection = result.collection || result.path.split('/')[0];

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-4 rounded-[5px] hover:bg-hover transition-all cursor-pointer group border border-transparent hover:border-border-secondary"
      style={{ transitionDuration: '80ms' }}
    >
      <div className="flex items-start gap-3">
        <FileText className="w-4 h-4 text-text-quaternary shrink-0 mt-0.5 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
        <div className="flex-1 min-w-0">
          <span className="text-[15px] font-serif font-[500] text-text-secondary group-hover:text-text truncate block leading-tight transition-colors" style={{ transitionDuration: '80ms' }}>
            {displayName}
          </span>
          <div className="flex items-center gap-2 mt-2">
            <Tag label={collection} color="gray" size="sm" />
            {result.score !== undefined && (
              <div className="flex items-center gap-1.5">
                <div className="w-14 h-1 bg-bg-tertiary rounded-full overflow-hidden">
                  <div className="h-full bg-accent/50 rounded-full" style={{ width: `${Math.min(100, result.score * 100)}%` }} />
                </div>
                <span className="text-[9px] text-text-quaternary tabular-nums">{Math.round(result.score * 100)}</span>
              </div>
            )}
          </div>
          {result.snippet && (
            <p className="text-[13px] font-serif text-text-quaternary mt-2 line-clamp-2 leading-[1.6]">{result.snippet}</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collection Card
// ---------------------------------------------------------------------------

function CollectionCard({ collection, onClick }: { collection: Collection; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left p-4 rounded-[7px] border border-border-secondary hover:border-border-tertiary bg-bg-secondary hover:bg-bg-tertiary transition-all cursor-pointer group"
      style={{ transitionDuration: '150ms' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-[20px] leading-none mt-0.5">{collectionIcons[collection.name] || '📁'}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-serif font-[600] text-text group-hover:text-text block capitalize">
            {collection.name}
          </span>
          <p className="text-[12px] text-text-quaternary mt-1 leading-[1.5]">
            {collectionDescriptions[collection.name] || `${collection.doc_count} documents`}
          </p>
          <span className="text-[11px] text-text-quaternary tabular-nums mt-2 block">
            {collection.doc_count} docs
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Frontmatter Bar
// ---------------------------------------------------------------------------

function FrontmatterBar({ fm }: { fm: Record<string, unknown> }) {
  const badges: { label: string; value: string; color: TagColor }[] = [];
  if (fm.type) badges.push({ label: 'type', value: String(fm.type), color: tagColorForValue('type', String(fm.type)) });
  if (fm.stage) {
    const stageNum = Number(fm.stage);
    const label = stageLabels[stageNum] || `Stage ${fm.stage}`;
    badges.push({ label: `stage ${fm.stage}`, value: label, color: tagColorForValue('stage', String(fm.stage)) });
  }
  if (fm.status) badges.push({ label: 'status', value: String(fm.status), color: tagColorForValue('status', String(fm.status)) });
  if (fm.project) badges.push({ label: 'project', value: String(fm.project), color: 'purple' });

  if (!badges.length && !fm.date && !fm.tags) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      {badges.map(b => (
        <Tag key={b.label} label={b.value} color={b.color} size="sm" icon={b.label.startsWith('stage') ? <Layers className="w-3 h-3" /> : undefined} />
      ))}
      {fm.date ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-quaternary">
          <Clock className="w-3 h-3" />
          <span>{String(fm.date)}</span>
        </span>
      ) : null}
      {fm.tags ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-quaternary">
          <Hash className="w-3 h-3" />
          <span>{Array.isArray(fm.tags) ? (fm.tags as string[]).join(', ') : String(fm.tags)}</span>
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown Content
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Main Vault Page
// ---------------------------------------------------------------------------

export default function VaultPage() {
  const section = useSectionFromRoute();
  const meta = sectionMeta[section];
  const SectionIcon = meta.icon;

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [file, setFile] = useState<VaultFile | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['knowledge', 'log']));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTier, setSearchTier] = useState<'idle' | 'fuzzy' | 'fast' | 'enhanced'>('idle');
  const [treeOpen, setTreeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'feed' | 'pipeline'>('feed');
  const contentRef = useRef<HTMLDivElement>(null);
  const fastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enhancedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchVersionRef = useRef(0); // tracks query version to discard stale results

  // Clear file when switching sections
  useEffect(() => {
    setFile(null);
    setSelectedPath('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchTier('idle');
  }, [section]);

  // Auto-expand relevant folders for section
  useEffect(() => {
    if (meta.collections.length > 0) {
      setExpandedPaths(prev => new Set([...prev, ...meta.collections]));
    }
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch tree
  useEffect(() => {
    fetch(`${API}/vault/tree`)
      .then(r => {
        if (!r.ok) throw new Error('tree endpoint unavailable');
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('not json');
        return r.json();
      })
      .then(d => setTree(Array.isArray(d) ? d : d?.tree ?? d?.nodes ?? []))
      .catch(() => {
        fetch(`${API}/vault/collections`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d?.collections) return;
            const nodes: TreeNode[] = d.collections.map((c: Collection) => ({
              name: c.name, path: c.name, type: 'folder' as const, children: [], count: c.doc_count,
            }));
            setTree(nodes);
          })
          .catch(() => {});
      });
  }, []);

  // Fetch collections
  useEffect(() => {
    fetch(`${API}/vault/collections`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.collections) setCollections(d.collections); })
      .catch(() => {});
  }, []);

  // Filter collections for the current section
  const filteredCollections = useMemo(() => {
    if (section === 'all') return collections;
    return collections.filter(c => meta.collections.includes(c.name));
  }, [collections, section, meta.collections]);

  // Filter tree nodes for the current section
  const filteredTree = useMemo(() => {
    if (section === 'all') return tree;
    return tree.filter(node => meta.collections.includes(node.name) || meta.collections.includes(node.path));
  }, [tree, section, meta.collections]);

  // Pre-flatten tree for fuzzy search (memoized)
  const flatFiles = useMemo(() => {
    const files = flattenTree(filteredTree);
    return files;
  }, [filteredTree]);

  // Cache for search results to avoid re-fetching identical queries
  const searchCache = useRef<Map<string, SearchResult[]>>(new Map());

  // Build collection query param
  const collectionParam = meta.collections.length === 1
    ? `&collection=${encodeURIComponent(meta.collections[0])}`
    : '';

  // -----------------------------------------------------------------------
  // Three-tier progressive search
  // -----------------------------------------------------------------------
  useEffect(() => {
    // Bump version to invalidate any in-flight requests
    const version = ++searchVersionRef.current;

    // Clear timers
    if (fastTimeout.current) clearTimeout(fastTimeout.current);
    if (enhancedTimeout.current) clearTimeout(enhancedTimeout.current);

    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchTier('idle');
      return;
    }

    // --- Tier 0: Instant fuzzy match (< 1ms) ---
    const fuzzyResults = fuzzySearch(searchQuery, flatFiles);
    setSearchResults(fuzzyResults);
    setSearchTier('fuzzy');
    setSearching(true);

    // --- Tier 1: Fast BM25 (150ms debounce, ~200ms server) ---
    const cacheKeyFast = `fast:${searchQuery}${collectionParam}`;
    const cachedFast = searchCache.current.get(cacheKeyFast);
    if (cachedFast) {
      // Cache hit — use immediately, still fire enhanced
      setSearchResults(cachedFast);
      setSearchTier('fast');
    }

    fastTimeout.current = setTimeout(() => {
      if (cachedFast) return; // Already used cache
      const url = `${API}/vault/search?q=${encodeURIComponent(searchQuery)}&mode=fast${collectionParam}`;
      fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(r => {
          if (searchVersionRef.current !== version) return; // stale
          const results: SearchResult[] = (Array.isArray(r?.results) ? r.results : [])
            .map((item: SearchResult) => ({ ...item, source: 'fast' as const }));
          if (results.length > 0) {
            searchCache.current.set(cacheKeyFast, results);
            setSearchResults(results);
            setSearchTier('fast');
          }
        })
        .catch(() => {});
    }, cachedFast ? 0 : 150);

    // --- Tier 2: Enhanced reranked (300ms debounce, ~800ms server) ---
    const cacheKeyEnhanced = `enhanced:${searchQuery}${collectionParam}`;
    const cachedEnhanced = searchCache.current.get(cacheKeyEnhanced);
    if (cachedEnhanced) {
      // Already have enhanced results cached — use them
      setSearchResults(cachedEnhanced);
      setSearchTier('enhanced');
      setSearching(false);
      return;
    }

    enhancedTimeout.current = setTimeout(() => {
      const url = `${API}/vault/search?q=${encodeURIComponent(searchQuery)}&mode=enhanced${collectionParam}`;
      fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(r => {
          if (searchVersionRef.current !== version) return; // stale
          const results: SearchResult[] = (Array.isArray(r?.results) ? r.results : [])
            .map((item: SearchResult) => ({ ...item, source: 'enhanced' as const }));
          if (results.length > 0) {
            searchCache.current.set(cacheKeyEnhanced, results);
            setSearchResults(results);
            setSearchTier('enhanced');
          }
          setSearching(false);
        })
        .catch(() => { setSearching(false); });
    }, 300);

    return () => {
      if (fastTimeout.current) clearTimeout(fastTimeout.current);
      if (enhancedTimeout.current) clearTimeout(enhancedTimeout.current);
    };
  }, [searchQuery, flatFiles, collectionParam]);

  const loadFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    setTreeOpen(false);
    try {
      const resp = await fetch(`${API}/vault/file/${encodeURIComponent(path)}`);
      const data = await resp.json();
      data.name = data.name || path.split('/').pop() || path;
      setFile(data);
      setSearchQuery('');
      setSearchResults([]);
      contentRef.current?.scrollTo(0, 0);
    } catch { /* empty */ }
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const breadcrumbs = useMemo(() => selectedPath ? selectedPath.split('/') : [], [selectedPath]);

  // Keyboard: Cmd+K or / to focus search, Escape to close tree
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey && e.key === 'k') || (e.key === '/' && !file && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && treeOpen) {
        setTreeOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, treeOpen]);

  const goBack = useCallback(() => {
    setFile(null);
    setSelectedPath('');
  }, []);

  // -----------------------------------------------------------------------
  // Knowledge reader — delegates to KnowledgeReader (ContextPanel + FrontmatterEditor)
  // -----------------------------------------------------------------------
  if (selectedPath && section === 'knowledge') {
    return (
      <div className="h-full flex flex-col bg-bg">
        <KnowledgeReader
          path={selectedPath}
          onBack={goBack}
          onNavigate={loadFile}
          onBrowse={() => setTreeOpen(true)}
        />
        {treeOpen && (
          <TreeOverlay
            tree={filteredTree}
            selectedPath={selectedPath}
            onSelect={loadFile}
            expandedPaths={expandedPaths}
            onToggle={toggleFolder}
            onClose={() => setTreeOpen(false)}
          />
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // File reading view — immersive, for journal/logs/all sections
  // -----------------------------------------------------------------------
  if (file) {
    return (
      <div className="h-full flex flex-col bg-bg">
        {/* Top bar — touch-friendly on mobile */}
        <div className="shrink-0 px-4 sm:px-6 py-2 sm:py-3 border-b border-border">
          <div className="max-w-[720px] mx-auto flex items-center gap-1 sm:gap-2">
            <button
              onClick={goBack}
              className="p-2 sm:p-1.5 -ml-2 sm:-ml-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors"
              style={{ transitionDuration: '80ms' }}
            >
              <ArrowLeft className="w-4 h-4 text-text-tertiary" />
            </button>

            {/* Breadcrumbs — hidden on mobile, show title instead */}
            <h1 className="sm:hidden text-[14px] font-serif font-[590] text-text truncate flex-1">
              {(file.frontmatter?.title as string) || file.title || file.name.replace('.md', '')}
            </h1>
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-text-quaternary flex-1 min-w-0">
              <button onClick={goBack} className="hover:text-text-tertiary shrink-0 cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>{meta.title.toLowerCase()}</button>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                  <span className={`truncate ${i === breadcrumbs.length - 1 ? 'text-text-tertiary font-[510]' : ''}`}>{crumb.replace('.md', '')}</span>
                </span>
              ))}
            </div>

            <button
              onClick={() => setTreeOpen(true)}
              className="p-2 sm:p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors"
              style={{ transitionDuration: '80ms' }}
              title="Browse files"
            >
              <FolderTreeIcon className="w-4 h-4 text-text-quaternary" />
            </button>
          </div>
        </div>

        {/* Document content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-6 sm:py-10">
            <h1 className="hidden sm:block text-[26px] font-serif font-[700] text-text tracking-[-0.025em] leading-[1.2]">
              {(file.frontmatter?.title as string) || file.title || file.name.replace('.md', '')}
            </h1>
            {file.frontmatter && <FrontmatterBar fm={file.frontmatter} />}
            <div className="mt-6 sm:mt-8" />
            <MarkdownRenderer content={file.body || file.content} />
          </div>
        </div>

        {treeOpen && (
          <TreeOverlay
            tree={filteredTree}
            selectedPath={selectedPath}
            onSelect={loadFile}
            expandedPaths={expandedPaths}
            onToggle={toggleFolder}
            onClose={() => setTreeOpen(false)}
          />
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Browse view — centered, content-first, section-aware
  // -----------------------------------------------------------------------
  const isSearching = searchQuery.length >= 2;
  const searchPlaceholder = section === 'all'
    ? 'Search across all collections...'
    : `Search ${meta.title.toLowerCase()}...`;

  return (
    <div className="h-full overflow-hidden bg-bg relative">
      {/* Floating glass pill — tabs + search + browse, matching Work page pattern */}
      {section === 'knowledge' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[100]">
          <div
            className="flex items-center gap-1 h-8 px-1 rounded-full border shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
            style={{ background: 'rgba(30, 26, 22, 0.60)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderColor: 'rgba(255, 245, 235, 0.06)' }}
          >
            {(['feed', 'pipeline'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 h-6 rounded-full text-[12px] font-[510] cursor-pointer transition-all duration-150 ${
                  activeTab === tab ? 'bg-[rgba(255,245,235,0.10)] text-text' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {tab === 'feed' ? 'Feed' : 'Pipeline'}
              </button>
            ))}
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              onClick={() => setTreeOpen(true)}
              className="px-2 h-6 rounded-full text-[12px] font-[510] text-text-tertiary hover:text-text-secondary cursor-pointer transition-all duration-150"
            >
              <FolderTreeIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => searchInputRef.current?.focus()}
              className="px-2 h-6 rounded-full text-[12px] font-[510] text-text-tertiary hover:text-text-secondary cursor-pointer transition-all duration-150"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Content — full screen */}
      <div className="h-full overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-5 sm:px-8 pt-14 pb-8">

          {/* Hidden search input — activated by clicking search icon or pressing / */}
          {(isSearching || searchQuery) && (
            <div className="mb-4 flex items-center gap-2.5 px-3 py-2 rounded-[5px] bg-bg-secondary border border-border-secondary transition-colors focus-within:border-border-tertiary" style={{ transitionDuration: '150ms' }}>
              <Search className="w-3.5 h-3.5 text-text-quaternary shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 text-[13px] bg-transparent text-text placeholder:text-text-quaternary outline-none"
                autoFocus
              />
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="p-1 rounded-xs hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }}>
                <X className="w-3.5 h-3.5 text-text-quaternary" />
              </button>
            </div>
          )}

          {/* Search results */}
          {isSearching && (
            <div className="mb-6">
              {searchResults.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-text-quaternary">{searchResults.length} results</span>
                    {searching && searchTier !== 'enhanced' && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-[1.5px] border-accent/30 border-t-accent rounded-full animate-spin" />
                        <span className="text-[9px] text-text-quaternary">{searchTier === 'fuzzy' ? 'Searching...' : 'Refining...'}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {searchResults.map(r => (
                      <SearchResultCard key={r.path} result={r} onSelect={() => loadFile(r.path)} />
                    ))}
                  </div>
                </div>
              ) : searching ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
                  <p className="text-[12px] text-text-quaternary">Searching...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <Search className="w-8 h-8 text-text-quaternary opacity-20 mb-3" />
                  <p className="text-[13px] font-serif text-text-quaternary">No results for "{searchQuery}"</p>
                </div>
              )}
            </div>
          )}

          {/* Knowledge section content — immediate, no chrome */}
          {section === 'knowledge' && !isSearching && (
            activeTab === 'feed' ? (
              <KnowledgeFeed onOpenFile={loadFile} />
            ) : (
              <KnowledgePipeline onOpenFile={loadFile} />
            )
          )}

          {/* Journal / Logs — tree browse */}
          {section !== 'all' && section !== 'knowledge' && !isSearching && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-text-quaternary">{meta.title}</span>
              </div>
              {filteredTree.length > 0 ? (
                <FolderTree
                  nodes={filteredTree}
                  selectedPath={selectedPath}
                  onSelect={loadFile}
                  expandedPaths={expandedPaths}
                  onToggle={toggleFolder}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <SectionIcon className="w-8 h-8 text-text-quaternary opacity-15 mb-3" />
                  <p className="text-[13px] font-serif text-text-quaternary">Loading...</p>
                </div>
              )}
            </div>
          )}

          {/* Base /vault: collection cards */}
          {section === 'all' && !isSearching && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                {collections.map(c => (
                  <CollectionCard
                    key={c.name}
                    collection={c}
                    onClick={() => { setExpandedPaths(prev => new Set([...prev, c.name])); setTreeOpen(true); }}
                  />
                ))}
              </div>
              {collections.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20">
                  <Library className="w-10 h-10 text-text-quaternary opacity-15 mb-4" />
                  <p className="text-[14px] font-serif text-text-tertiary">Connecting to vault...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tree overlay */}
      {treeOpen && (
        <TreeOverlay
          tree={filteredTree}
          selectedPath={selectedPath}
          onSelect={loadFile}
          expandedPaths={expandedPaths}
          onToggle={toggleFolder}
          onClose={() => setTreeOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree Overlay — floating panel, not a permanent sidebar
// ---------------------------------------------------------------------------

function TreeOverlay({ tree, selectedPath, onSelect, expandedPaths, onToggle, onClose }: {
  tree: TreeNode[]; selectedPath: string; onSelect: (path: string) => void;
  expandedPaths: Set<string>; onToggle: (path: string) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel — slides from left, capped at 85vw on mobile */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-bg-panel border-r border-border shadow-[0_0_40px_rgba(0,0,0,0.4)] flex flex-col"
        style={{ animation: 'slide-in-left 180ms ease-out forwards' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderTreeIcon className="w-4 h-4 text-text-quaternary" />
            <span className="text-[13px] font-[510] text-text">Browse files</span>
          </div>
          <button onClick={onClose} className="p-2 sm:p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
            <X className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2">
          <FolderTree
            nodes={tree}
            selectedPath={selectedPath}
            onSelect={(path) => { onSelect(path); onClose(); }}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
          />
        </div>
      </div>

      <style>{`
        @keyframes slide-in-left {
          from { transform: translateX(-100%); opacity: 0.8; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
