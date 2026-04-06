import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = '/api/integrations';

// ── Types ──

export interface Provider {
  id: string;
  type: string;           // harness | api | gateway | local
  display_name: string;
  description: string;
  endpoint: string | null;
  credential: string | null;
  credential_ok: boolean | null;
  models: string[];
  is_default: boolean;
  status: string;         // active | configured | not-configured | not-running
}

export interface Connector {
  id: string;
  type: string;
  display_name: string;
  description: string;
  scope: string;          // global | project | agent
  credential: string | null;
  tags: string[];
  is_configured: boolean;
  status: string;         // connected | partial | available | not-configured | broken | not-running
  status_detail?: string;
  health?: Array<{ name: string; status: string; detail: string; description?: string }>;
  capabilities?: Array<{ id: string; label: string; description: string }>;
  icon?: string;
  color?: string;
  tier?: number;
  category?: string;
  automation_ideas?: Array<Record<string, unknown>>;
  accounts?: string[];
}

export interface Credential {
  name: string;
  description: string;
  used_by: Record<string, string[]>;
  created: string | null;
  present: boolean;       // actually in keychain
}

// ── Hooks ──

export function useProviders() {
  return useQuery({
    queryKey: ['integrations', 'providers'],
    queryFn: async (): Promise<Provider[]> => {
      const res = await fetch(`${API}/providers`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.providers ?? [];
    },
    staleTime: 30_000,
  });
}

export function useConnectors() {
  return useQuery({
    queryKey: ['integrations', 'connectors'],
    queryFn: async () => {
      const res = await fetch(`${API}/connectors`);
      if (!res.ok) return { connectors: [] as Connector[], global: [], project: [], agent: [], configured: 0, total: 0 };
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: ['integrations', 'credentials'],
    queryFn: async (): Promise<Credential[]> => {
      const res = await fetch(`${API}/credentials`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.credentials ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAddConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connector: Record<string, unknown>) => {
      const res = await fetch(`${API}/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connector),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useUpdateConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`${API}/connectors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useSyncConnectors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/sync`, { method: 'POST' });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useAddProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: Record<string, unknown>) => {
      const res = await fetch(`${API}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useVerifyProvider() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/providers/${id}/verify`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Verification failed: ${res.status}`);
      }
      return res.json();
    },
  });
}

export function useRefreshHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/health/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error(`Health refresh failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}
