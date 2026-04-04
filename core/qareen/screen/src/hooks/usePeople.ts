import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PersonListResponse,
  PersonDetailResponse,
  PersonSurfaceResponse,
  TimelineResponse,
  ContactSourcesResponse,
  ImportResponse,
  PersonMessagesResponse,
  SendMessageResponse,
  PeopleHealthResponse,
  PipelineRunResponse,
  OrbitResponse,
  UpdatePersonRequest,
} from '@/lib/types';

const API = '/api';

async function fetchPeople(query?: string): Promise<PersonListResponse> {
  const url = query ? `${API}/people?q=${encodeURIComponent(query)}` : `${API}/people`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`People API error: ${res.status}`);
  return res.json();
}

async function fetchPerson(id: string): Promise<PersonDetailResponse> {
  const res = await fetch(`${API}/people/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Person API error: ${res.status}`);
  return res.json();
}

async function fetchSurfaces(): Promise<PersonSurfaceResponse> {
  const res = await fetch(`${API}/people/surfaces`);
  if (!res.ok) throw new Error(`Surfaces API error: ${res.status}`);
  return res.json();
}

async function fetchTimeline(id: string, limit = 50): Promise<TimelineResponse> {
  const res = await fetch(`${API}/people/${encodeURIComponent(id)}/timeline?limit=${limit}`);
  if (!res.ok) throw new Error(`Timeline API error: ${res.status}`);
  return res.json();
}

export function usePeople(query?: string) {
  return useQuery({
    queryKey: ['people', query ?? ''],
    queryFn: () => fetchPeople(query),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

export function usePerson(id: string | null) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => fetchPerson(id!),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function usePersonSurfaces() {
  return useQuery({
    queryKey: ['people-surfaces'],
    queryFn: fetchSurfaces,
    staleTime: 30_000,
    refetchInterval: 300_000,
  });
}

export function usePersonTimeline(id: string | null, limit = 50) {
  return useQuery({
    queryKey: ['person-timeline', id],
    queryFn: () => fetchTimeline(id!, limit),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePersonRequest }) => {
      const res = await fetch(`${API}/people/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Update person failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['people'] });
      qc.invalidateQueries({ queryKey: ['person', id] });
      qc.invalidateQueries({ queryKey: ['person-timeline', id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Contact Sources — onboarding
// ---------------------------------------------------------------------------

async function fetchContactSources(): Promise<ContactSourcesResponse> {
  const res = await fetch(`${API}/people/sources`);
  if (!res.ok) throw new Error(`Sources API error: ${res.status}`);
  return res.json();
}

export function useContactSources() {
  return useQuery({
    queryKey: ['contact-sources'],
    queryFn: fetchContactSources,
    staleTime: 60_000,
  });
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<ImportResponse> => {
      const res = await fetch(`${API}/people/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId }),
      });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people'] });
      qc.invalidateQueries({ queryKey: ['contact-sources'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Messages — real channel messages
// ---------------------------------------------------------------------------

async function fetchPersonMessages(id: string, limit = 30, days = 90): Promise<PersonMessagesResponse> {
  const res = await fetch(`${API}/people/${encodeURIComponent(id)}/messages?limit=${limit}&days=${days}`);
  if (!res.ok) throw new Error(`Messages API error: ${res.status}`);
  return res.json();
}

export function usePersonMessages(id: string | null, limit = 30, days = 90) {
  return useQuery({
    queryKey: ['person-messages', id, limit, days],
    queryFn: () => fetchPersonMessages(id!, limit, days),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ personId, channel, text }: { personId: string; channel: string; text: string }): Promise<SendMessageResponse> => {
      const res = await fetch(`${API}/people/${personId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text }),
      });
      if (!res.ok) throw new Error(`Send failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (_, { personId }) => {
      qc.invalidateQueries({ queryKey: ['person-messages', personId] });
      qc.invalidateQueries({ queryKey: ['person-timeline', personId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Health & Pipelines
// ---------------------------------------------------------------------------

export function usePeopleHealth() {
  return useQuery({
    queryKey: ['people-health'],
    queryFn: async (): Promise<PeopleHealthResponse> => {
      const res = await fetch(`${API}/people/health`);
      if (!res.ok) throw new Error(`Health API error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}

export function useRunPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pipeline: string): Promise<PipelineRunResponse> => {
      const res = await fetch(`${API}/people/pipelines/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline }),
      });
      if (!res.ok) throw new Error(`Pipeline trigger failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people-health'] });
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Orbit visualization data
// ---------------------------------------------------------------------------

export function useOrbitData() {
  return useQuery({
    queryKey: ['people-orbit'],
    queryFn: async (): Promise<OrbitResponse> => {
      const res = await fetch(`${API}/people/orbit`);
      if (!res.ok) throw new Error(`Orbit API error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}
