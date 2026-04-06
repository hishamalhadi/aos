/**
 * StepInsertButton — "+" button between steps that opens a type picker.
 * Shows as a subtle line, expands on hover to reveal the + icon.
 * Clicking opens a dropdown of available node types.
 */
import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { NODE_TYPES, CATEGORY_META } from '@/components/flow-editor/constants';
import { getStepIcon, STEP_COLORS } from '../constants';

interface StepInsertButtonProps {
  onInsert: (n8nType: string, label: string) => void;
}

export function StepInsertButton({ onInsert }: StepInsertButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group non-trigger node types by category
  const groups: Record<string, { n8nType: string; label: string; color: string }[]> = {};
  for (const [key, def] of Object.entries(NODE_TYPES)) {
    if (def.category === 'trigger') continue;
    const cat = def.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ n8nType: key, label: def.label, color: def.color });
  }

  return (
    <div ref={ref} className="relative flex items-center justify-center ml-[13px] group/insert">
      {/* Line + button */}
      <div className="w-px h-4 bg-border-secondary" />
      <button
        onClick={() => setOpen(!open)}
        className="absolute w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover/insert:opacity-100 transition-opacity cursor-pointer z-10"
        style={{
          background: '#D9730D',
          boxShadow: '0 2px 8px rgba(217, 115, 13, 0.3)',
        }}
      >
        <Plus className="w-2.5 h-2.5 text-white" />
      </button>

      {/* Type picker dropdown */}
      {open && (
        <div
          className="absolute left-8 top-1/2 -translate-y-1/2 w-[200px] rounded-[10px] overflow-hidden z-50"
          style={{
            background: '#1E1A16',
            border: '1px solid rgba(255, 245, 235, 0.08)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="px-3 py-2 border-b border-border">
            <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.04em]">Add Step</span>
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {Object.entries(groups).map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 pt-2 pb-1">
                  <span
                    className="text-[9px] font-[590] uppercase tracking-[0.06em]"
                    style={{ color: CATEGORY_META[cat]?.color || '#6B6560' }}
                  >
                    {CATEGORY_META[cat]?.label || cat}
                  </span>
                </div>
                {items.map(({ n8nType, label, color }) => {
                  const Icon = getStepIcon(n8nType);
                  return (
                    <button
                      key={n8nType}
                      onClick={() => {
                        onInsert(n8nType, label);
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary transition-colors text-left cursor-pointer"
                    >
                      <div
                        className="w-5 h-5 rounded-[5px] flex items-center justify-center shrink-0"
                        style={{ background: `${color}20` }}
                      >
                        <Icon className="w-2.5 h-2.5" style={{ color }} />
                      </div>
                      <span className="text-[11px] font-[510] text-text-secondary">{label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
