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
  CircleListResponse,
  CircleDetailResponse,
  OrgListResponse,
  OrgDetailResponse,
  FamilyTreeResponse,
  HygieneListResponse,
  HygieneStatsResponse,
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

// ---------------------------------------------------------------------------
// Recent activity feed
// ---------------------------------------------------------------------------

export interface RecentActivityItem {
  person_id: string
  person_name: string
  importance: number
  channel: string
  direction: string
  msg_count: number
  occurred_at?: string
  organization?: string
}

export interface RecentActivityResponse {
  items: RecentActivityItem[]
  total: number
}

export function useRecentActivity(days = 14, limit = 30) {
  return useQuery({
    queryKey: ['people-recent', days, limit],
    queryFn: async (): Promise<RecentActivityResponse> => {
      const res = await fetch(`${API}/people/recent?days=${days}&limit=${limit}`);
      if (!res.ok) throw new Error(`Recent activity API error: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Relationship graph
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
  name: string
  importance: number
  organization?: string
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  subtype?: string
  context?: string
  strength: number
}

export interface RelationshipGraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function useRelationshipGraph() {
  return useQuery({
    queryKey: ['people-graph'],
    queryFn: async (): Promise<RelationshipGraphResponse> => {
      const res = await fetch(`${API}/people/graph`);
      if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export function useCircles() {
  return useQuery({
    queryKey: ['people-circles'],
    queryFn: async (): Promise<CircleListResponse> => {
      const res = await fetch(`${API}/people/circles`);
      if (!res.ok) throw new Error(`Circles API error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useCircleDetail(id: string | null) {
  return useQuery({
    queryKey: ['people-circle', id],
    queryFn: async (): Promise<CircleDetailResponse> => {
      const res = await fetch(`${API}/people/circles/${id}`);
      if (!res.ok) throw new Error(`Circle detail error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function useOrgs() {
  return useQuery({
    queryKey: ['people-orgs'],
    queryFn: async (): Promise<OrgListResponse> => {
      const res = await fetch(`${API}/people/orgs`);
      if (!res.ok) throw new Error(`Orgs API error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useOrgDetail(id: string | null) {
  return useQuery({
    queryKey: ['people-org', id],
    queryFn: async (): Promise<OrgDetailResponse> => {
      const res = await fetch(`${API}/people/orgs/${id}`);
      if (!res.ok) throw new Error(`Org detail error: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Family Tree
// ---------------------------------------------------------------------------

export function useFamilyTree() {
  return useQuery({
    queryKey: ['people-family'],
    queryFn: async (): Promise<FamilyTreeResponse> => {
      const res = await fetch(`${API}/people/graph/family`);
      if (!res.ok) throw new Error(`Family tree error: ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Hygiene Queue
// ---------------------------------------------------------------------------

export function useHygieneQueue(status = 'pending') {
  return useQuery({
    queryKey: ['people-hygiene', status],
    queryFn: async (): Promise<HygieneListResponse> => {
      const res = await fetch(`${API}/people/hygiene?status=${status}`);
      if (!res.ok) throw new Error(`Hygiene API error: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useHygieneStats() {
  return useQuery({
    queryKey: ['people-hygiene-stats'],
    queryFn: async (): Promise<HygieneStatsResponse> => {
      const res = await fetch(`${API}/people/hygiene/stats`);
      if (!res.ok) throw new Error(`Hygiene stats error: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useApproveHygiene() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (issueId: string) => {
      const res = await fetch(`${API}/people/hygiene/${issueId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people-hygiene'] });
      qc.invalidateQueries({ queryKey: ['people-hygiene-stats'] });
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export function useRejectHygiene() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ issueId, notes }: { issueId: string; notes?: string }) => {
      const res = await fetch(`${API}/people/hygiene/${issueId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || '' }),
      });
      if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people-hygiene'] });
      qc.invalidateQueries({ queryKey: ['people-hygiene-stats'] });
    },
  });
}

export function useRunHygieneScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/people/hygiene/run`, { method: 'POST' });
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people-hygiene'] });
      qc.invalidateQueries({ queryKey: ['people-hygiene-stats'] });
    },
  });
}
