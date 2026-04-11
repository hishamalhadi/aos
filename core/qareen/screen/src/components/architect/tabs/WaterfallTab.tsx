/**
 * WaterfallTab — Live CSS Gantt chart showing per-node timing.
 * Bars animate in during execution via CSS transitions.
 */
import { BarChart3 } from 'lucide-react';
import { useExecutionRunner } from '@/hooks/useExecutionRunner';
import { STEP_COLORS } from '../constants';

const DEFAULT_COLOR = '#6B6560';

export function WaterfallTab() {
  const { runState, nodeResults } = useExecutionRunner();

  if (nodeResults.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center opacity-25">
          <BarChart3 className="w-7 h-7 text-text-quaternary mx-auto mb-2" />
          <p className="text-[11px] text-text-quaternary">Run a test to see timing</p>
        </div>
      </div>
    );
  }

  const minStart = Math.min(...nodeResults.map((r) => r.started_at));
  const maxEnd = Math.max(...nodeResults.map((r) => r.started_at + r.duration_ms));
  const totalSpan = maxEnd - minStart || 1;

  // Time axis markers (up to 5)
  const markerCount = Math.min(5, Math.max(2, Math.ceil(totalSpan / 500)));
  const markers = Array.from({ length: markerCount + 1 }, (_, i) =>
    Math.round((totalSpan * i) / markerCount),
  );

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {/* Time axis */}
      <div className="flex mb-3" style={{ paddingLeft: 120 }}>
        <div className="flex-1 relative h-4">
          {markers.map((ms) => {
            const pct = ((ms) / totalSpan) * 100;
            return (
              <span
                key={ms}
                className="absolute text-[9px] text-text-quaternary tabular-nums -translate-x-1/2"
                style={{ left: `${pct}%` }}
              >
                {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
              </span>
            );
          })}
        </div>
      </div>

      {/* Bars */}
      {nodeResults.map((r, i) => {
        const left = ((r.started_at - minStart) / totalSpan) * 100;
        const width = (r.duration_ms / totalSpan) * 100;
        const color = _colorForNode(r.node) || DEFAULT_COLOR;

        return (
          <div key={i} className="flex items-center gap-0 mb-1.5 h-7">
            {/* Node name */}
            <div
              className="shrink-0 text-[11px] font-[510] text-text-secondary truncate pr-2"
              style={{ width: 120 }}
              title={r.node}
            >
              {r.node}
            </div>

            {/* Bar area */}
            <div className="flex-1 relative h-full">
              <div
                className="absolute top-1 h-5 rounded-[4px] flex items-center px-1.5"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 1)}%`,
                  background: r.status === 'error'
                    ? 'rgba(239,68,68,0.35)'
                    : `${color}55`,
                  borderLeft: `2px solid ${r.status === 'error' ? '#ef4444' : color}`,
                  transition: runState === 'running' ? 'width 150ms ease-out' : 'none',
                }}
              >
                <span className="text-[9px] text-text-tertiary tabular-nums whitespace-nowrap">
                  {r.duration_ms}ms
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Total */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-text-quaternary">
          {nodeResults.length} node{nodeResults.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[10px] text-text-quaternary tabular-nums">
          {totalSpan >= 1000 ? `${(totalSpan / 1000).toFixed(2)}s` : `${totalSpan}ms`} total
        </span>
      </div>
    </div>
  );
}

/** Try to match a node name back to a step color via substring. */
function _colorForNode(nodeName: string): string | undefined {
  const lower = nodeName.toLowerCase();
  for (const [key, color] of Object.entries(STEP_COLORS)) {
    const short = key.split('.').pop()?.toLowerCase() ?? '';
    if (lower.includes(short)) return color;
  }
  return undefined;
}
