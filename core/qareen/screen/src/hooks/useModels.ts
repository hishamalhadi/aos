import { useQuery } from '@tanstack/react-query';

const API = '/api/models';

export interface Model {
  id: string;
  name: string;
  purpose: string;
  runtime: string;
  source: string;
  status: string;
  size_gb?: number;
  repo?: string;
  path?: string;
  endpoint?: string;
  credential?: string;
  model_ids?: string[];
  is_default?: boolean;
  running?: boolean;
  on_disk?: boolean;
  in_registry?: boolean;
}

export interface ModelSummary {
  total: number;
  total_disk_gb: number;
  by_purpose: Record<string, {
    count: number;
    preferred: string | null;
    disk_gb: number;
  }>;
}

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: async (): Promise<{ models: Model[]; by_purpose: Record<string, Model[]>; total: number; total_disk_gb: number }> => {
      const res = await fetch(API);
      if (!res.ok) return { models: [], by_purpose: {}, total: 0, total_disk_gb: 0 };
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useModelSummary() {
  return useQuery({
    queryKey: ['models', 'summary'],
    queryFn: async (): Promise<ModelSummary | null> => {
      const res = await fetch(`${API}/summary`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
}
