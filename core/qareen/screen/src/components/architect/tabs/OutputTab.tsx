/**
 * OutputTab — Shows per-node output summary from test execution.
 */
import { FileOutput } from 'lucide-react';
import { useExecutionRunner } from '@/hooks/useExecutionRunner';

export function OutputTab() {
  const { runState, nodeResults } = useExecutionRunner();

  if (runState === 'idle' && nodeResults.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center opacity-25">
          <FileOutput className="w-7 h-7 text-text-quaternary mx-auto mb-2" />
          <p className="text-[11px] text-text-quaternary">Run a test to see output</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4 space-y-3">
      {nodeResults.map((r, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-[560] text-text-secondary">{r.node}</span>
            <span className="text-[9px] text-text-quaternary tabular-nums">{r.items} items</span>
          </div>
          <div
            className="rounded-[6px] px-3 py-2 text-[10px] font-mono text-text-tertiary leading-relaxed"
            style={{ background: 'rgba(13, 11, 9, 0.5)' }}
          >
            {r.status === 'success'
              ? `✓ Completed in ${r.duration_ms}ms — ${r.items} item${r.items !== 1 ? 's' : ''} produced${r.simulated ? ' (simulated)' : ''}`
              : `✗ Error: ${r.error || 'Unknown error'}`
            }
          </div>
        </div>
      ))}
    </div>
  );
}
