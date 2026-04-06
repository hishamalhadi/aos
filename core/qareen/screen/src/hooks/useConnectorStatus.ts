/**
 * useConnectorStatus — Fetches connector-aware n8n node type status.
 *
 * Provides connection status per n8n node type so the flow editor
 * can show green/yellow/red indicators on each node.
 */
import { useState, useEffect, useCallback } from 'react';

export interface NodeTypeStatus {
  connector_id: string;
  connector_name: string;
  status: 'connected' | 'partial' | 'available' | 'broken' | 'always';
  icon: string;
  color: string;
  credential_types: string[];
}

interface ConnectorStatusData {
  nodeTypes: Record<string, NodeTypeStatus>;
  summary: { connected: number; available: number; always_available: number; total: number };
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useConnectorStatus(): ConnectorStatusData {
  const [nodeTypes, setNodeTypes] = useState<Record<string, NodeTypeStatus>>({});
  const [summary, setSummary] = useState({ connected: 0, available: 0, always_available: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/connectors/node-types');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setNodeTypes(data.node_types || {});
      setSummary(data.summary || { connected: 0, available: 0, always_available: 0, total: 0 });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { nodeTypes, summary, loading, error, refresh: fetch_ };
}

/** Get connection status for a specific n8n node type */
export function getNodeConnectionStatus(
  nodeTypes: Record<string, NodeTypeStatus>,
  n8nType: string,
): 'connected' | 'partial' | 'available' | 'broken' | 'always' | 'unknown' {
  const entry = nodeTypes[n8nType];
  if (entry) return entry.status;

  // Logic/utility nodes that don't need connectors
  const alwaysAvailable = [
    'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.webhook',
    'n8n-nodes-base.httpRequest', 'n8n-nodes-base.code',
    'n8n-nodes-base.set', 'n8n-nodes-base.if', 'n8n-nodes-base.switch',
    'n8n-nodes-base.wait', 'n8n-nodes-base.executeWorkflow', 'n8n-nodes-base.noOp',
    'aos.agentDispatch', 'aos.hitlApproval',
  ];
  if (alwaysAvailable.includes(n8nType)) return 'always';

  return 'unknown';
}

/** Status dot color for rendering */
export function statusDotColor(
  status: 'connected' | 'partial' | 'available' | 'broken' | 'always' | 'unknown',
): string {
  switch (status) {
    case 'connected': return '#30D158';
    case 'always': return '#30D158';
    case 'partial': return '#FFD60A';
    case 'available': return '#6B6560';
    case 'broken': return '#FF453A';
    case 'unknown': return '#6B6560';
  }
}
