import { X, FileText, Clock, Hash, Link } from 'lucide-react';
import { useRelatedDocuments } from '@/hooks/useKnowledge';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { Skeleton } from '@/components/primitives';
import type { ReactNode } from 'react';

const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};
const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5 mt-5 first:mt-0">
      <span className="text-text-quaternary shrink-0 [&>svg]:w-3 [&>svg]:h-3">{icon}</span>
      <span className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">{label}</span>
    </div>
  );
}

interface ContextPanelProps {
  path: string;
  frontmatter: Record<string, any>;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export function ContextPanel({ path, frontmatter, onClose, onNavigate }: ContextPanelProps) {
  const { data: related, isLoading } = useRelatedDocuments(path);

  const stage = frontmatter.stage as number | undefined;
  const type = frontmatter.type as string | undefined;
  const status = frontmatter.status as string | undefined;
  const project = frontmatter.project as string | undefined;
  const date = frontmatter.date as string | undefined;
  const tags = (frontmatter.tags as string[] | undefined) ?? [];

  return (
    <div className="h-full bg-bg-panel border-l border-border flex flex-col w-[280px] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-[11px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">Context</span>
        <button onClick={onClose} className="p-1 rounded-[5px] text-text-quaternary hover:text-text hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0">
        {/* Metadata */}
        <SectionLabel icon={<FileText />} label="Metadata" />
        <div className="flex flex-wrap gap-1.5 mb-1">
          {stage && (
            <Tag label={stageLabels[stage] || `Stage ${stage}`} color={stageColors[stage] || 'gray'} size="sm" />
          )}
          {type && <Tag label={type} color="blue" size="sm" />}
          {status && <Tag label={status} color="teal" size="sm" />}
          {project && <Tag label={project} color="purple" size="sm" />}
        </div>
        {date && (
          <div className="flex items-center gap-2 mt-2 text-[12px] text-text-tertiary">
            <Clock className="w-3 h-3 text-text-quaternary" />
            <span>{date}</span>
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex items-start gap-2 mt-2">
            <Hash className="w-3 h-3 text-text-quaternary shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <Tag key={tag} label={tag} color="gray" size="sm" />
              ))}
            </div>
          </div>
        )}

        {/* Provenance */}
        <SectionLabel icon={<Link />} label="Provenance" />
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-[5px]" />
            <Skeleton className="h-8 w-full rounded-[5px]" />
          </div>
        ) : related?.explicit_links && related.explicit_links.length > 0 ? (
          <div className="space-y-1">
            {related.explicit_links.map(link => (
              <button
                key={link.path}
                onClick={() => onNavigate(link.path)}
                className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group"
                style={{ transitionDuration: '80ms' }}
              >
                <FileText className="w-3 h-3 text-text-quaternary shrink-0 mt-0.5 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
                <div className="min-w-0">
                  <span className="text-[12px] text-text-secondary group-hover:text-text block truncate transition-colors" style={{ transitionDuration: '80ms' }}>
                    {link.title || link.path.split('/').pop()?.replace('.md', '')}
                  </span>
                  <span className="text-[10px] text-text-quaternary">{link.relationship}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-quaternary px-2">No explicit links</p>
        )}

        {/* Related */}
        <SectionLabel icon={<FileText />} label="Related" />
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-[5px]" />
            <Skeleton className="h-8 w-full rounded-[5px]" />
            <Skeleton className="h-8 w-full rounded-[5px]" />
          </div>
        ) : related?.semantic_neighbors && related.semantic_neighbors.length > 0 ? (
          <div className="space-y-1">
            {related.semantic_neighbors.map(neighbor => (
              <button
                key={neighbor.path}
                onClick={() => onNavigate(neighbor.path)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group"
                style={{ transitionDuration: '80ms' }}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] text-text-secondary group-hover:text-text block truncate transition-colors" style={{ transitionDuration: '80ms' }}>
                    {neighbor.title || neighbor.path.split('/').pop()?.replace('.md', '')}
                  </span>
                </div>
                <div className="w-8 h-1.5 rounded-full bg-bg-tertiary shrink-0 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent/40"
                    style={{ width: `${Math.round(neighbor.score * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-quaternary px-2">No related documents</p>
        )}
      </div>
    </div>
  );
}
