import { FileText } from 'lucide-react';

interface PipelineCardProps {
  title: string;
  path: string;
  onClick: () => void;
}

export function PipelineCard({ title, path, onClick }: PipelineCardProps) {
  const displayName = title || path.split('/').pop()?.replace('.md', '') || path;
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-2.5 rounded-[5px] hover:bg-hover transition-colors cursor-pointer group" style={{ transitionDuration: '80ms' }}>
      <div className="flex items-start gap-2">
        <FileText className="w-3.5 h-3.5 text-text-quaternary shrink-0 mt-0.5 group-hover:text-accent transition-colors" style={{ transitionDuration: '80ms' }} />
        <span className="text-[13px] text-text-secondary group-hover:text-text line-clamp-2 leading-tight transition-colors" style={{ transitionDuration: '80ms' }}>{displayName}</span>
      </div>
    </button>
  );
}
