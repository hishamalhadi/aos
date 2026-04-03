import { FileText, Archive, ChevronRight, AlertTriangle } from 'lucide-react';
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

export { stageLabels, stageColors };

export function FeedItem({ path, title, stage, collection, isStale, onOpen, onPromote, onArchive }: FeedItemProps) {
  const nextStage = stage && stage < 6 ? stage + 1 : null;
  const displayName = title || path.split('/').pop()?.replace('.md', '') || path;

  return (
    <div
      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-[5px] hover:bg-hover transition-colors cursor-pointer"
      style={{ transitionDuration: '80ms' }}
      onClick={onOpen}
    >
      <FileText className="w-3.5 h-3.5 text-text-quaternary shrink-0 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[13px] font-serif text-text-secondary group-hover:text-text truncate transition-colors" style={{ transitionDuration: '80ms' }}>
          {displayName}
        </span>
        {isStale && <AlertTriangle className="w-3 h-3 text-yellow shrink-0" />}
      </div>
      {stage && (
        <Tag label={stageLabels[stage] || `Stage ${stage}`} color={stageColors[stage] || 'gray'} size="sm" className="shrink-0" />
      )}
      {/* Hover actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ transitionDuration: '150ms' }}>
        {nextStage && onPromote && (
          <button
            onClick={(e) => { e.stopPropagation(); onPromote(nextStage); }}
            className="px-1.5 h-5 rounded-xs text-[10px] font-[510] text-accent hover:bg-accent/10 transition-colors cursor-pointer"
            style={{ transitionDuration: '80ms' }}
            title={`Promote to ${stageLabels[nextStage]}`}
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="p-1 rounded-xs text-text-quaternary hover:text-red transition-colors cursor-pointer"
            style={{ transitionDuration: '80ms' }}
            title="Archive"
          >
            <Archive className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
