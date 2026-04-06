import { useQuery } from '@tanstack/react-query';

const API = '/api/executions';

export interface Execution {
  id: string;
  timestamp: string;
  agent_id: string | null;
  provider: string;
  model: string;
  prompt_preview: string | null;
  status: string;          // ok | error | timeout
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ExecutionSummary {
  period: string;
  since: string;
  total_executions: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  avg_duration_ms: number;
  successes: number;
  errors: number;
  by_agent: Array<{ agent_id: string; count: number; tokens: number; cost_usd: number }>;
  by_provider: Array<{ provider: string; count: number; tokens: number; cost_usd: number }>;
  by_model: Array<{ model: string; count: number; tokens: number; cost_usd: number }>;
}

interface ExecutionFilters {
  agent_id?: string;
  provider?: string;
  status?: string;
  limit?: number;
}

export function useExecutions(filters?: ExecutionFilters) {
  const params = new URLSearchParams();
  if (filters?.agent_id) params.set('agent_id', filters.agent_id);
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', String(filters.limit));

  const qs = params.toString();
  return useQuery({
    queryKey: ['executions', filters],
    queryFn: async (): Promise<{ executions: Execution[]; total: number }> => {
      const res = await fetch(`${API}${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { executions: [], total: 0 };
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useExecutionSummary(period: string = 'today') {
  return useQuery({
    queryKey: ['executions', 'summary', period],
    queryFn: async (): Promise<ExecutionSummary | null> => {
      const res = await fetch(`${API}/summary?period=${period}`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
