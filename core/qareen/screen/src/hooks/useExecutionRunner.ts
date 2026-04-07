/**
 * useExecutionRunner — Manages test execution of architect specs.
 *
 * Calls POST /api/architect/test-run with the current spec,
 * parses SSE events (node_start, node_complete, done, error),
 * and stores results in the architect Zustand store.
 */
import { useState, useCallback, useRef } from 'react';
import { useArchitectStore } from '@/store/architect';

export interface NodeResult {
  node: string;
  status: 'success' | 'error';
  duration_ms: number;
  items: number;
  error: string | null;
  simulated: boolean;
}

export type RunState = 'idle' | 'building' | 'running' | 'completed' | 'error';

export function useExecutionRunner() {
  const [runState, setRunState] = useState<RunState>('idle');
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [nodeResults, setNodeResults] = useState<NodeResult[]>([]);
  const [overallStatus, setOverallStatus] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const spec = useArchitectStore((s) => s.spec);

  const testRun = useCallback(async () => {
    if (!spec) return;

    // Reset state
    setRunState('building');
    setNodeResults([]);
    setCurrentNode(null);
    setOverallStatus(null);
    setErrorMessage(null);
    setProgress({ current: 0, total: 0 });

    // Abort previous run
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/architect/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setRunState('error');
        setErrorMessage(`Request failed: ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'status') {
                setRunState(data.status?.includes('Building') ? 'building' : 'running');
              } else if (eventType === 'node_start') {
                setRunState('running');
                setCurrentNode(data.node);
                setProgress({ current: data.index, total: data.total });
              } else if (eventType === 'node_complete') {
                setNodeResults(prev => [...prev, data as NodeResult]);
                setProgress(prev => ({ ...prev, current: prev.current + 1 }));
              } else if (eventType === 'done') {
                setOverallStatus(data.status);
                setRunState('completed');
                setCurrentNode(null);
              } else if (eventType === 'error') {
                setErrorMessage(data.error);
                setRunState('error');
              }
            } catch {
              // Skip malformed JSON
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setRunState('error');
        setErrorMessage((err as Error).message);
      }
    } finally {
      abortRef.current = null;
    }
  }, [spec]);

  const reset = useCallback(() => {
    setRunState('idle');
    setNodeResults([]);
    setCurrentNode(null);
    setOverallStatus(null);
    setErrorMessage(null);
    setProgress({ current: 0, total: 0 });
  }, []);

  return {
    runState,
    currentNode,
    nodeResults,
    overallStatus,
    errorMessage,
    progress,
    testRun,
    reset,
    canRun: !!spec && runState !== 'building' && runState !== 'running',
  };
}
