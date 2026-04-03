import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PipelineStatsResponse,
  RelatedDocumentsResponse,
  VaultFileUpdate,
  VaultFileResponse,
} from '@/lib/types';

const API = '/api';

export function usePipelineStats() {
  return useQuery<PipelineStatsResponse>({
    queryKey: ['vault-pipeline'],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/pipeline`);
      if (!res.ok) throw new Error(`Pipeline stats error: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useRelatedDocuments(path: string | null) {
  return useQuery<RelatedDocumentsResponse>({
    queryKey: ['vault-related', path],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/related/${encodeURIComponent(path!)}`);
      if (!res.ok) throw new Error(`Related docs error: ${res.status}`);
      return res.json();
    },
    enabled: !!path,
    staleTime: 60_000,
  });
}

export function usePromoteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, targetStage }: { path: string; targetStage: number }) => {
      const res = await fetch(`${API}/vault/promote/${encodeURIComponent(path)}?target_stage=${targetStage}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Promote error: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
      qc.invalidateQueries({ queryKey: ['vault-collections'] });
    },
  });
}

export function useArchiveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`${API}/vault/archive/${encodeURIComponent(path)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Archive error: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
      qc.invalidateQueries({ queryKey: ['vault-collections'] });
    },
  });
}

export function useUpdateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, update }: { path: string; update: VaultFileUpdate }) => {
      const res = await fetch(`${API}/vault/file/${encodeURIComponent(path)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error(`Update error: ${res.status}`);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['vault-file', variables.path] });
      qc.invalidateQueries({ queryKey: ['vault-pipeline'] });
    },
  });
}

export function useVaultFile(path: string | null) {
  return useQuery<VaultFileResponse>({
    queryKey: ['vault-file', path],
    queryFn: async () => {
      const res = await fetch(`${API}/vault/file/${encodeURIComponent(path!)}`);
      if (!res.ok) throw new Error(`File error: ${res.status}`);
      return res.json();
    },
    enabled: !!path,
  });
}
