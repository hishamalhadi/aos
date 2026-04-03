import { AlertTriangle } from 'lucide-react';
import { usePipelineStats } from '@/hooks/useKnowledge';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { Skeleton } from '@/components/primitives';
import { PipelineCard } from './PipelineCard';

const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

interface KnowledgePipelineProps {
  onOpenFile: (path: string) => void;
}

export function KnowledgePipeline({ onOpenFile }: KnowledgePipelineProps) {
  const { data: stats, isLoading } = usePipelineStats();

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-[260px] shrink-0">
            <Skeleton className="h-5 w-24 mb-3" />
            <div className="rounded-[7px] border border-border bg-bg-secondary p-3 space-y-2">
              <Skeleton className="h-10 w-full rounded-[5px]" />
              <Skeleton className="h-10 w-full rounded-[5px]" />
              <Skeleton className="h-10 w-full rounded-[5px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 sm:-mx-10 sm:px-10">
      {stats.stages.map(stage => (
        <div key={stage.stage} className="w-[260px] shrink-0 flex flex-col">
          {/* Column header */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <Tag
              label={stage.label}
              color={stageColors[stage.stage] || 'gray'}
              size="sm"
            />
            <span className="text-[12px] text-text-quaternary tabular-nums">{stage.count}</span>
            {stage.stale_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-yellow ml-auto">
                <AlertTriangle className="w-3 h-3" />
                {stage.stale_count}
              </span>
            )}
          </div>

          {/* Column body */}
          <div className="rounded-[7px] border border-border bg-bg-secondary/50 p-2 flex-1 max-h-[65vh] overflow-y-auto">
            {stage.items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <span className="text-[11px] text-text-quaternary">No documents</span>
              </div>
            ) : (
              <div className="space-y-1">
                {stage.items.map(item => (
                  <PipelineCard
                    key={item.path}
                    title={item.title ?? ''}
                    path={item.path}
                    onClick={() => onOpenFile(item.path)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
