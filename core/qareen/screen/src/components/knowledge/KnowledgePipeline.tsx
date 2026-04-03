import { usePipelineStats } from '@/hooks/useKnowledge';
import { Skeleton } from '@/components/primitives';
import { PipelineStage } from './PipelineStage';

interface KnowledgePipelineProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgePipeline({ onOpenFile }: KnowledgePipelineProps) {
  const { data: stats, isLoading } = usePipelineStats();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-[7px] border border-border bg-bg-secondary/30 px-4 py-4">
            <div className="flex items-center gap-3 mb-2.5">
              <Skeleton className="h-5 w-16 rounded-xs" />
              <Skeleton className="h-5 w-8 rounded-xs" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full mb-3" />
            <Skeleton className="h-4 w-3/4 rounded-xs" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const maxCount = Math.max(...stats.stages.map((s: any) => s.count), 1);

  return (
    <div className="space-y-3">
      {/* Pipeline summary sentence */}
      <p className="text-[13px] font-serif text-text-tertiary leading-[1.6] mb-2">
        {stats.total_documents} documents across {stats.stages.length} stages.
        {stats.synthesis_opportunities > 0 && (
          <> The biggest gap is synthesis — <span className="text-accent">{stats.synthesis_opportunities} research docs</span> could be distilled.</>
        )}
      </p>

      {/* Stage rows */}
      {stats.stages.map((stage: any) => (
        <PipelineStage
          key={stage.stage}
          stage={stage.stage}
          label={stage.label}
          count={stage.count}
          health={stage.health}
          description={stage.description}
          items={stage.items}
          proportion={stage.count / maxCount}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
