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
    <div className="group px-4 py-3.5 rounded-[7px] border border-border-secondary hover:border-border-tertiary bg-bg-secondary transition-all cursor-pointer" style={{ transitionDuration: '150ms' }}>
      <div className="flex items-start gap-3">
        <FileText className="w-4 h-4 text-text-quaternary shrink-0 mt-1 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
        <div className="flex-1 min-w-0" onClick={onOpen}>
          <span className="text-[14px] font-serif font-[500] text-text-secondary group-hover:text-text block truncate leading-tight transition-colors" style={{ transitionDuration: '80ms' }}>
            {displayName}
          </span>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {stage && <Tag label={stageLabels[stage] || `Stage ${stage}`} color={stageColors[stage] || 'gray'} size="sm" />}
            {collection && <Tag label={collection} color="gray" size="sm" />}
            {isStale && (
              <span className="inline-flex items-center gap-1 text-[10px] text-yellow">
                <AlertTriangle className="w-3 h-3" />
                <span>Stale</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ transitionDuration: '150ms' }}>
          {nextStage && onPromote && (
            <button onClick={(e) => { e.stopPropagation(); onPromote(nextStage); }} className="flex items-center gap-1 px-2 h-7 rounded-[5px] text-[11px] font-[510] text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }} title={`Promote to ${stageLabels[nextStage]}`}>
              <ChevronRight className="w-3 h-3" />
              {stageLabels[nextStage]}
            </button>
          )}
          {onArchive && (
            <button onClick={(e) => { e.stopPropagation(); onArchive(); }} className="p-1.5 rounded-[5px] text-text-quaternary hover:text-red hover:bg-red/10 transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }} title="Archive">
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
