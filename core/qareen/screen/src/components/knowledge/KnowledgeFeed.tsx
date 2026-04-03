import { Inbox, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usePipelineStats, usePromoteDocument, useArchiveDocument } from '@/hooks/useKnowledge';
import { Skeleton } from '@/components/primitives';
import { FeedItem } from './FeedItem';

interface KnowledgeFeedProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgeFeed({ onOpenFile }: KnowledgeFeedProps) {
  const { data: stats, isLoading } = usePipelineStats();
  const promoteMutation = usePromoteDocument();
  const archiveMutation = useArchiveDocument();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-64 rounded-xs" />
        <Skeleton className="h-12 w-full rounded-[5px]" />
        <Skeleton className="h-12 w-full rounded-[5px]" />
        <Skeleton className="h-12 w-full rounded-[5px]" />
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
    <div className="space-y-8">
      {/* Summary — sentence, not stats. DESIGN.md: "No stat dumps. The qareen speaks in sentences." */}
      <p className="text-[13px] font-serif text-text-tertiary leading-[1.6]">
        {stats.total_documents} documents across the pipeline.
        {stats.unprocessed_captures > 0 && <> <span className="text-yellow">{stats.unprocessed_captures} unprocessed</span>.</>}
        {stats.synthesis_opportunities > 0 && <> <span className="text-accent">{stats.synthesis_opportunities} ready for synthesis</span>.</>}
        {stats.stale_decisions > 0 && <> <span className="text-yellow">{stats.stale_decisions} stale decisions</span>.</>}
        {stats.unprocessed_captures === 0 && stats.synthesis_opportunities === 0 && stats.stale_decisions === 0 && <> Everything is current.</>}
      </p>

      {/* All Clear */}
      {!hasWork && (
        <div className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="w-8 h-8 text-green opacity-30 mb-3" />
          <p className="text-[14px] font-serif text-text-tertiary">Knowledge is up to date</p>
          <p className="text-[12px] text-text-quaternary mt-1">Nothing needs attention right now</p>
        </div>
      )}

      {/* Unprocessed Captures (stale) */}
      {staleCaptures.length > 0 && (
        <section>
          <FeedSectionHeader icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Unprocessed" count={staleCaptures.length} />
          <div className="space-y-0.5">
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
          <FeedSectionHeader icon={<Inbox className="w-3.5 h-3.5" />} label="Recent captures" count={freshCaptures.length} />
          <div className="space-y-0.5">
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
          <FeedSectionHeader icon={<Sparkles className="w-3.5 h-3.5" />} label="Ready for synthesis" count={synthesisItems.length} />
          <div className="space-y-0.5">
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

function FeedSectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-text-quaternary">{icon}</span>
      <span className="text-[11px] font-[510] text-text-tertiary">{label}</span>
      <span className="text-[10px] text-text-quaternary tabular-nums">{count}</span>
    </div>
  );
}
