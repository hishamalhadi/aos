/**
 * TraceTab — Execution trace showing per-node results.
 * Displays after a test run completes.
 */
import { Check, AlertCircle, Activity } from 'lucide-react';
import { useExecutionRunner } from '@/hooks/useExecutionRunner';

export function TraceTab() {
  const { runState, nodeResults, overallStatus } = useExecutionRunner();

  if (runState === 'idle' && nodeResults.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center opacity-25">
          <Activity className="w-7 h-7 text-text-quaternary mx-auto mb-2" />
          <p className="text-[11px] text-text-quaternary">Run a test to see trace</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {nodeResults.map((r, i) => (
        <div key={i} className="flex items-start gap-3 mb-3">
          {/* Status icon */}
          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            r.status === 'success' ? 'bg-green-500/15' : 'bg-red-500/15'
          }`}>
            {r.status === 'success'
              ? <Check className="w-3 h-3 text-green-400" />
              : <AlertCircle className="w-3 h-3 text-red-400" />
            }
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-[560] text-text">{r.node}</span>
              {r.simulated && (
                <span className="text-[9px] text-text-quaternary italic">simulated</span>
              )}
              <span className="text-[10px] text-text-quaternary ml-auto tabular-nums">{r.duration_ms}ms</span>
            </div>
            {r.items > 0 && (
              <span className="text-[10px] text-text-quaternary">
                {r.items} item{r.items !== 1 ? 's' : ''} produced
              </span>
            )}
            {r.error && (
              <p className="text-[10px] text-red-400 mt-0.5">{r.error}</p>
            )}
          </div>
        </div>
      ))}

      {/* Summary */}
      {overallStatus && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            {overallStatus === 'success' ? (
              <><Check className="w-3.5 h-3.5 text-green-400" /><span className="text-[12px] font-[510] text-green-300">All steps passed</span></>
            ) : (
              <><AlertCircle className="w-3.5 h-3.5 text-red-400" /><span className="text-[12px] font-[510] text-red-300">Execution failed</span></>
            )}
            <span className="text-[10px] text-text-quaternary ml-auto">
              {nodeResults.reduce((sum, r) => sum + r.duration_ms, 0)}ms total
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
