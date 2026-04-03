import { AlertTriangle } from 'lucide-react';
import { usePipelineStats } from '@/hooks/useKnowledge';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { Skeleton } from '@/components/primitives';
import { PipelineCard } from './PipelineCard';

const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-[7px] border border-border bg-bg-secondary p-3">
            <Skeleton className="h-5 w-20 mb-3" />
            <div className="space-y-1.5">
              <Skeleton className="h-8 w-full rounded-[5px]" />
              <Skeleton className="h-8 w-full rounded-[5px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4">
      {stats.stages.map(stage => (
        <div key={stage.stage} className="flex flex-col">
          {/* Column Header */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <Tag
              label={stageLabels[stage.stage] || `Stage ${stage.stage}`}
              color={stageColors[stage.stage] || 'gray'}
              size="sm"
            />
            <span className="text-[11px] font-[510] text-text-quaternary">{stage.count}</span>
            {stage.stale_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-yellow ml-auto">
                <AlertTriangle className="w-3 h-3" />
                <span>{stage.stale_count}</span>
              </span>
            )}
          </div>

          {/* Column Body */}
          <div className="rounded-[7px] border border-border bg-bg-secondary p-1.5 min-h-[120px] max-h-[60vh] overflow-y-auto flex-1">
            {stage.items.length === 0 ? (
              <div className="flex items-center justify-center h-full min-h-[100px]">
                <span className="text-[11px] text-text-quaternary">Empty</span>
              </div>
            ) : (
              <div className="space-y-0.5">
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
