import { useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

// ---------------------------------------------------------------------------
// FloatingSidebar — reusable floating glass panel anchored below the
// hamburger pill. Used for session lists, context panels, filters, etc.
//
// Props:
//   title       — overline label ("Sessions", "Filters", etc.)
//   icon        — collapsed state icon (ReactNode)
//   actions     — header action buttons (ReactNode, e.g. "+" button)
//   children    — scrollable content area
//   defaultOpen — start expanded (default true)
//   width       — panel width (default 220px)
//   className   — extra classes on outer container
// ---------------------------------------------------------------------------

interface FloatingSidebarProps {
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  width?: number;
  className?: string;
}

export function FloatingSidebar({
  title,
  icon,
  actions,
  children,
  defaultOpen = true,
  width = 220,
  className = '',
}: FloatingSidebarProps) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);

  // Collapsed: show a small glass pill button to re-open
  if (collapsed) {
    return (
      <div className={`fixed top-14 left-3 z-[305] ${className}`}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="
            w-8 h-8 rounded-full flex items-center justify-center
            bg-bg-secondary/60 backdrop-blur-md
            border border-border/40
            shadow-[0_2px_12px_rgba(0,0,0,0.3)]
            text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/70
            transition-all cursor-pointer
          "
          style={{ transitionDuration: 'var(--duration-instant)' }}
          title={`Show ${title.toLowerCase()}`}
        >
          {icon}
        </button>
      </div>
    );
  }

  // Expanded: glass panel
  return (
    <div
      className={`
        fixed top-14 left-3 z-[305]
        bg-bg-panel/90 backdrop-blur-xl
        border border-border/40
        rounded-[10px]
        shadow-[0_4px_24px_rgba(0,0,0,0.4)]
        flex flex-col
        max-h-[calc(100vh-120px)]
        ${className}
      `}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40 shrink-0">
        <span className="text-[11px] font-[590] text-text-tertiary uppercase tracking-[0.04em]">
          {title}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="w-6 h-6 rounded-[5px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer"
            style={{ transitionDuration: 'var(--duration-instant)' }}
            title="Collapse"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-1.5 scrollbar-none">
        {children}
      </div>
    </div>
  );
}
