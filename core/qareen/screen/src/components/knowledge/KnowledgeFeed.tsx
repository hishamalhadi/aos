import { Inbox, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usePipelineStats, usePromoteDocument, useArchiveDocument } from '@/hooks/useKnowledge';
import { Skeleton } from '@/components/primitives';
import { SectionHeader } from '@/components/primitives';
import { FeedItem } from './FeedItem';

interface StatCardProps {
  label: string;
  value: number;
  accent?: boolean;
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div className="rounded-[7px] border border-border-secondary bg-bg-secondary px-4 py-3">
      <p className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-1">{label}</p>
      <p className={`text-[22px] font-[600] leading-none ${accent ? 'text-accent' : 'text-text'}`}>{value}</p>
    </div>
  );
}

interface KnowledgeFeedProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgeFeed({ onOpenFile }: KnowledgeFeedProps) {
  const { data: stats, isLoading } = usePipelineStats();
  const promoteMutation = usePromoteDocument();
  const archiveMutation = useArchiveDocument();

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[7px] border border-border-secondary bg-bg-secondary px-4 py-3">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[7px]" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const captureStage = stats.stages.find(s => s.stage === 1);
  const researchStage = stats.stages.find(s => s.stage === 3);

  const staleCaptures = captureStage?.items.filter((_item, i) => i < captureStage.stale_count) ?? [];
  const freshCaptures = captureStage?.items.filter((_item, i) => i >= (captureStage?.stale_count ?? 0)) ?? [];
  const synthesisItems = researchStage?.items.filter((_item, i) => i < (researchStage?.stale_count ?? 0)) ?? [];

  const hasWork = staleCaptures.length > 0 || freshCaptures.length > 0 || synthesisItems.length > 0;

  return (
    <div className="space-y-6 p-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Documents" value={stats.total_documents} />
        <StatCard label="Unprocessed" value={stats.unprocessed_captures} accent={stats.unprocessed_captures > 0} />
        <StatCard label="Synthesis Ready" value={stats.synthesis_opportunities} />
        <StatCard label="Stale Decisions" value={stats.stale_decisions} />
      </div>

      {/* All Clear */}
      {!hasWork && (
        <div className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="w-10 h-10 text-green opacity-40 mb-3" />
          <p className="text-[14px] font-[510] text-text-tertiary">All clear</p>
          <p className="text-[12px] text-text-quaternary mt-1">No documents need attention right now</p>
        </div>
      )}

      {/* Unprocessed Captures (stale) */}
      {staleCaptures.length > 0 && (
        <section>
          <SectionHeader icon={<AlertTriangle />} label="Unprocessed Captures" count={staleCaptures.length} />
          <div className="space-y-1.5">
            {staleCaptures.map(item => (
              <FeedItem
                key={item.path}
                path={item.path}
                title={item.title ?? ''}
                stage={1}
                collection={item.collection}
                isStale
                onOpen={() => onOpenFile(item.path)}
                onPromote={(target) => promoteMutation.mutate({ path: item.path, targetStage: target })}
                onArchive={() => archiveMutation.mutate(item.path)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent Captures */}
      {freshCaptures.length > 0 && (
        <section>
          <SectionHeader icon={<Inbox />} label="Recent Captures" count={freshCaptures.length} />
          <div className="space-y-1.5">
            {freshCaptures.map(item => (
              <FeedItem
                key={item.path}
                path={item.path}
                title={item.title ?? ''}
                stage={1}
                collection={item.collection}
                onOpen={() => onOpenFile(item.path)}
                onPromote={(target) => promoteMutation.mutate({ path: item.path, targetStage: target })}
                onArchive={() => archiveMutation.mutate(item.path)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Synthesis Opportunities */}
      {synthesisItems.length > 0 && (
        <section>
          <SectionHeader icon={<Sparkles />} label="Synthesis Opportunities" count={synthesisItems.length} />
          <div className="space-y-1.5">
            {synthesisItems.map(item => (
              <FeedItem
                key={item.path}
                path={item.path}
                title={item.title ?? ''}
                stage={3}
                collection={item.collection}
                isStale
                onOpen={() => onOpenFile(item.path)}
                onPromote={(target) => promoteMutation.mutate({ path: item.path, targetStage: target })}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
