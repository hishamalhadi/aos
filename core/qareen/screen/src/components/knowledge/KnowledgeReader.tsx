import { useState, useRef } from 'react';
import { ArrowLeft, FolderTree as FolderTreeIcon, PanelRight } from 'lucide-react';
import { useVaultFile } from '@/hooks/useKnowledge';
import { MarkdownRenderer } from '@/components/primitives/MarkdownRenderer';
import { Skeleton } from '@/components/primitives';
import { ContextPanel } from './ContextPanel';
import { FrontmatterEditor } from './FrontmatterEditor';

interface KnowledgeReaderProps {
  path: string;
  onBack: () => void;
  onNavigate: (path: string) => void;
  onBrowse?: () => void;
}

export function KnowledgeReader({ path, onBack, onNavigate, onBrowse }: KnowledgeReaderProps) {
  const { data: file, isLoading } = useVaultFile(path);
  const [contextOpen, setContextOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = path.split('/');
  const title = file?.frontmatter?.title as string | undefined
    || file?.title
    || path.split('/').pop()?.replace('.md', '')
    || path;
  const frontmatter = file?.frontmatter ?? {};
  const stage = frontmatter.stage as number | undefined;
  const tags = (frontmatter.tags as string[] | undefined) ?? [];

  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-bg">
        <div className="shrink-0 px-4 sm:px-6 py-2 sm:py-3 border-b border-border">
          <div className="max-w-[720px] mx-auto flex items-center gap-2">
            <button onClick={onBack} className="p-2 sm:p-1.5 -ml-2 sm:-ml-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>
              <ArrowLeft className="w-4 h-4 text-text-tertiary" />
            </button>
            <Skeleton className="h-4 w-48 rounded-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-6 sm:py-10 space-y-4">
            <Skeleton className="h-8 w-2/3 rounded-[5px]" />
            <Skeleton className="h-4 w-1/3 rounded-xs" />
            <div className="mt-8 space-y-3">
              <Skeleton className="h-4 w-full rounded-xs" />
              <Skeleton className="h-4 w-5/6 rounded-xs" />
              <Skeleton className="h-4 w-4/5 rounded-xs" />
              <Skeleton className="h-4 w-full rounded-xs" />
              <Skeleton className="h-4 w-3/4 rounded-xs" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="h-full flex flex-col bg-bg items-center justify-center">
        <p className="text-[13px] text-text-quaternary">File not found</p>
        <button onClick={onBack} className="mt-3 text-[12px] text-accent hover:text-accent/80 transition-colors cursor-pointer" style={{ transitionDuration: '80ms' }}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-bg">
      {/* Main reader column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2 sm:py-3 border-b border-border">
          <div className="max-w-[720px] mx-auto flex items-center gap-1 sm:gap-2">
            <button
              onClick={onBack}
              className="p-2 sm:p-1.5 -ml-2 sm:-ml-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors"
              style={{ transitionDuration: '80ms' }}
            >
              <ArrowLeft className="w-4 h-4 text-text-tertiary" />
            </button>

            {/* Title on mobile */}
            <h1 className="sm:hidden text-[14px] font-[590] text-text truncate flex-1">
              {title}
            </h1>

            {/* Breadcrumbs on desktop */}
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-text-quaternary flex-1 min-w-0">
              <button onClick={onBack} className="hover:text-text-tertiary shrink-0 cursor-pointer transition-colors" style={{ transitionDuration: '80ms' }}>knowledge</button>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  <span className="text-text-quaternary shrink-0">/</span>
                  <span className={`truncate ${i === breadcrumbs.length - 1 ? 'text-text-tertiary font-[510]' : ''}`}>{crumb.replace('.md', '')}</span>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-1">
              {onBrowse && (
                <button
                  onClick={onBrowse}
                  className="p-2 sm:p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors"
                  style={{ transitionDuration: '80ms' }}
                  title="Browse files"
                >
                  <FolderTreeIcon className="w-4 h-4 text-text-quaternary" />
                </button>
              )}
              <button
                onClick={() => setContextOpen(!contextOpen)}
                className={`p-2 sm:p-1.5 rounded-[5px] hover:bg-hover cursor-pointer transition-colors ${contextOpen ? 'bg-hover text-text-secondary' : ''}`}
                style={{ transitionDuration: '80ms' }}
                title="Toggle context panel"
              >
                <PanelRight className={`w-4 h-4 ${contextOpen ? 'text-accent' : 'text-text-quaternary'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Document content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-5 sm:px-8 py-6 sm:py-10">
            <h1 className="hidden sm:block text-[26px] font-[700] text-text tracking-[-0.025em] leading-[1.2]">
              {title}
            </h1>

            {/* Inline frontmatter editor (stage + tags) */}
            <div className="mt-4">
              <FrontmatterEditor
                path={path}
                stage={stage}
                tags={tags}
              />
            </div>

            <div className="mt-6 sm:mt-8" />
            <MarkdownRenderer content={file.content} />
          </div>
        </div>
      </div>

      {/* Context panel — slides in from right */}
      {contextOpen && (
        <ContextPanel
          path={path}
          frontmatter={frontmatter}
          onClose={() => setContextOpen(false)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
