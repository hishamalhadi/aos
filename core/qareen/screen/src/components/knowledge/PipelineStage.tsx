import { useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { Tag, type TagColor } from '@/components/primitives/Tag';

const stageColors: Record<number, TagColor> = {
  1: 'gray', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

const healthColors: Record<string, string> = {
  healthy: 'bg-green/60',
  bottleneck: 'bg-yellow/60',
  needs_attention: 'bg-yellow/60',
  low_quality: 'bg-red/40',
  review: 'bg-blue/40',
};

const healthBorder: Record<string, string> = {
  healthy: 'border-green/10',
  bottleneck: 'border-yellow/15',
  needs_attention: 'border-yellow/15',
  low_quality: 'border-red/10',
  review: 'border-blue/10',
};

interface StageItem {
  path: string;
  title: string;
  size_bytes?: number;
}

interface PipelineStageProps {
  stage: number;
  label: string;
  count: number;
  health: string;
  description: string;
  items: StageItem[];
  /** 0-1 proportion relative to largest stage */
  proportion: number;
  onOpenFile: (path: string) => void;
}

export function PipelineStage({
  stage, label, count, health, description, items, proportion, onOpenFile,
}: PipelineStageProps) {
  const [expanded, setExpanded] = useState(false);

  const barColor = healthColors[health] || 'bg-text-quaternary/30';
  const borderColor = healthBorder[health] || 'border-border';

  return (
    <div>
      {/* Stage row — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left rounded-[7px] border ${borderColor} bg-bg-secondary/30 hover:bg-bg-secondary/60 px-4 py-4 transition-colors cursor-pointer group`}
        style={{ transitionDuration: '150ms' }}
      >
        {/* Top line: tag + count + expand chevron */}
        <div className="flex items-center gap-3 mb-2.5">
          <Tag label={label} color={stageColors[stage] || 'gray'} size="sm" />
          <span className="text-[14px] font-[600] text-text tabular-nums">{count}</span>
          <div className="flex-1" />
          <ChevronRight
            className={`w-3.5 h-3.5 text-text-quaternary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        </div>

        {/* Health bar — proportional width */}
        <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-300`}
            style={{ width: `${Math.max(4, proportion * 100)}%` }}
          />
        </div>

        {/* Description — serif, one sentence */}
        <p className="text-[13px] font-serif text-text-tertiary leading-[1.5]">
          {description}
        </p>
      </button>

      {/* Expanded items list */}
      {expanded && items.length > 0 && (
        <div className="mt-1 ml-4 border-l border-border pl-4 py-2 space-y-0.5">
          {items.map(item => (
            <button
              key={item.path}
              onClick={() => onOpenFile(item.path)}
              className="w-full text-left flex items-center gap-2.5 px-2 py-2 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group/item"
              style={{ transitionDuration: '80ms' }}
            >
              <FileText className="w-3.5 h-3.5 text-text-quaternary shrink-0 group-hover/item:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
              <span className="text-[13px] font-serif text-text-secondary group-hover/item:text-text truncate transition-colors" style={{ transitionDuration: '80ms' }}>
                {item.title || item.path.split('/').pop()?.replace('.md', '') || item.path}
              </span>
              {item.size_bytes !== undefined && item.size_bytes < 500 && (
                <span className="text-[9px] text-text-quaternary shrink-0 ml-auto">thin</span>
              )}
            </button>
          ))}
          {count > items.length && (
            <p className="text-[11px] text-text-quaternary px-2 py-1">
              + {count - items.length} more
            </p>
          )}
        </div>
      )}

      {expanded && items.length === 0 && (
        <div className="mt-1 ml-4 border-l border-border pl-4 py-4">
          <p className="text-[12px] text-text-quaternary">No documents in this stage</p>
        </div>
      )}
    </div>
  );
}
