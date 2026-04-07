/**
 * TestRunButton — Triggers test execution of the current spec.
 * Shows progress during execution and overall result when done.
 */
import { Play, Loader2, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { useExecutionRunner, type RunState } from '@/hooks/useExecutionRunner';

export function TestRunButton() {
  const { runState, progress, overallStatus, errorMessage, testRun, reset, canRun } = useExecutionRunner();

  if (runState === 'completed') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          {overallStatus === 'success' ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          )}
          <span className={`text-[11px] font-[510] ${overallStatus === 'success' ? 'text-green-300' : 'text-red-300'}`}>
            {overallStatus === 'success' ? 'All passed' : errorMessage || 'Failed'}
          </span>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[10px] font-[510] text-text-quaternary hover:text-text-tertiary hover:bg-bg-tertiary transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>
    );
  }

  if (runState === 'building' || runState === 'running') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
        <span className="text-[11px] font-[510] text-text-tertiary">
          {runState === 'building' ? 'Building...' : `Step ${progress.current + 1}/${progress.total}`}
        </span>
      </div>
    );
  }

  if (runState === 'error') {
    return (
      <div className="flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
        <span className="text-[10px] text-red-300 truncate max-w-[200px]">{errorMessage}</span>
        <button
          onClick={reset}
          className="text-[10px] font-[510] text-text-quaternary hover:text-text-tertiary cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Idle
  return (
    <button
      onClick={testRun}
      disabled={!canRun}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[11px] font-[560] text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ background: canRun ? '#D9730D' : '#3A3530' }}
    >
      <Play className="w-3 h-3" /> Test Run
    </button>
  );
}
