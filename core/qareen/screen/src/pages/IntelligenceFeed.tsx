import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Rss } from 'lucide-react';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { StatusDot } from '@/components/primitives/StatusDot';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Skeleton } from '@/components/primitives/Skeleton';

// ---------------------------------------------------------------------------
// Types + helpers
// ---------------------------------------------------------------------------

interface FeedItem {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  author: string | null;
  platform: string;
  source_name: string;
  published_at: string;
  relevance_score: number;
  relevance_tags: string[];
  status: string;
}

function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const platformColor: Record<string, TagColor> = {
  twitter: 'blue', youtube: 'red', github: 'gray',
  hackernews: 'orange', blog: 'purple', arxiv: 'green',
};

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Twitter', value: 'twitter' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'GitHub', value: 'github' },
  { label: 'HN', value: 'hackernews' },
  { label: 'Blogs', value: 'blog' },
  { label: 'arXiv', value: 'arxiv' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntelligenceFeed() {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<{ total_items: number; unread_count: number; active_sources: number } | null>(null);

  // Fetch feed
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('days', '30');
    params.set('limit', '100');
    if (platform) params.set('platform', platform);
    if (search) params.set('search', search);

    fetch(`/api/intelligence/feed?${params}`)
      .then(r => r.json())
      .then(data => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, [platform, search]);

  // Fetch stats
  useEffect(() => {
    fetch('/api/intelligence/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-6 pt-10 pb-16">

        {/* Stats */}
        {stats && (
          <div className="flex items-center gap-3 mb-6 text-[11px] text-text-quaternary font-mono tabular-nums">
            <span>{stats.total_items} items</span>
            <span className="w-px h-3 bg-border" />
            <span>{stats.unread_count} unread</span>
            <span className="w-px h-3 bg-border" />
            <span>{stats.active_sources} sources</span>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setPlatform(f.value)}
              className={`h-7 px-3 rounded-full text-[11px] font-medium cursor-pointer transition-colors duration-75
                ${platform === f.value
                  ? 'bg-accent text-white'
                  : 'text-text-quaternary hover:text-text-tertiary hover:bg-hover'}`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative max-w-[200px] w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full h-7 pl-7 pr-3 bg-transparent border border-border rounded-full text-[11px] text-text-secondary placeholder:text-text-quaternary focus:border-border-secondary focus:outline-none transition-colors duration-75"
            />
          </div>
        </div>

        {/* Error */}
        {error && <p className="text-red text-[12px] mb-4">{error}</p>}

        {/* Loading */}
        {loading && (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="bg-bg-secondary border border-border rounded-lg p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            icon={<Rss />}
            title="No intelligence items yet"
            description="Items will appear here once sources are configured and ingested."
          />
        )}

        {/* Feed */}
        {!loading && items.length > 0 && (
          <div className="space-y-2">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => navigate(`/intelligence/${item.id}`)}
                className="w-full text-left px-4 py-3.5 bg-bg-secondary border border-border rounded-lg hover:border-border-secondary transition-colors duration-75 cursor-pointer group"
              >
                {/* Row 1: platform + author + time */}
                <div className="flex items-center gap-2 mb-1.5">
                  {item.status === 'unread' && <StatusDot color="blue" size="sm" />}
                  <Tag label={item.platform} color={platformColor[item.platform] || 'gray'} size="sm" />
                  {item.author && (
                    <span className="text-[11px] font-medium text-text-tertiary truncate">{item.author}</span>
                  )}
                  <span className="text-[10px] text-text-quaternary font-mono ml-auto shrink-0">
                    {timeAgo(item.published_at)}
                  </span>
                </div>

                {/* Row 2: title */}
                <p className="text-[13px] font-medium text-text-secondary group-hover:text-text transition-colors duration-75 leading-snug mb-1">
                  {item.title}
                </p>

                {/* Row 3: summary */}
                {item.summary && (
                  <p className="text-[12px] text-text-quaternary line-clamp-2 leading-relaxed mb-2">
                    {item.summary}
                  </p>
                )}

                {/* Row 4: tags + score */}
                <div className="flex items-center gap-1.5">
                  {(item.relevance_tags || []).slice(0, 3).map(tag => (
                    <span key={tag} className="h-[18px] px-1.5 rounded-xs text-[10px] bg-bg-tertiary text-text-tertiary inline-flex items-center">
                      {tag}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] font-mono text-text-quaternary">
                    {item.relevance_score.toFixed(1)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
