/**
 * useSpecReadiness — Derives connector readiness from the current spec.
 *
 * Walks all pipeline steps/triggers, looks up each n8n type in the
 * connector status map, and returns a deduplicated readiness summary.
 */
import { useMemo } from 'react';
import { useArchitectStore } from '@/store/architect';
import {
  useConnectorStatus,
  getNodeConnectionStatus,
} from '@/hooks/useConnectorStatus';

export interface ConnectorReadiness {
  connectorId: string;
  connectorName: string;
  icon: string;
  color: string;
  status: 'connected' | 'partial' | 'available' | 'broken' | 'always' | 'unknown';
  nodeTypes: string[];
}

const STATUS_ORDER: Record<string, number> = {
  broken: 0,
  available: 1,
  partial: 2,
  unknown: 3,
  connected: 4,
  always: 5,
};

export function useSpecReadiness() {
  const spec = useArchitectStore((s) => s.spec);
  const { nodeTypes, loading } = useConnectorStatus();

  const result = useMemo(() => {
    if (!spec?.pipelines?.length) {
      return { connectors: [] as ConnectorReadiness[], ready: 0, total: 0, allReady: true };
    }

    // Collect all unique n8n types from spec
    const usedTypes = new Set<string>();
    for (const pipeline of spec.pipelines) {
      if (pipeline.trigger?.type) usedTypes.add(pipeline.trigger.type);
      for (const step of pipeline.steps) {
        const n8nType = step.n8n_type
          || (step.type === 'agent_dispatch' ? 'aos.agentDispatch' : '')
          || (step.type === 'hitl_approval' ? 'aos.hitlApproval' : '');
        if (n8nType) usedTypes.add(n8nType);
      }
    }

    // Group by connector, skip 'always' types (no connector needed)
    const byConnector = new Map<string, ConnectorReadiness>();

    for (const n8nType of usedTypes) {
      const status = getNodeConnectionStatus(nodeTypes, n8nType);
      if (status === 'always') continue;

      const entry = nodeTypes[n8nType];
      const connectorId = entry?.connector_id || n8nType;
      const existing = byConnector.get(connectorId);

      if (existing) {
        existing.nodeTypes.push(n8nType);
        // Keep worst status
        if (STATUS_ORDER[status] < STATUS_ORDER[existing.status]) {
          existing.status = status;
        }
      } else {
        byConnector.set(connectorId, {
          connectorId,
          connectorName: entry?.connector_name || n8nType.split('.').pop() || n8nType,
          icon: entry?.icon || 'zap',
          color: entry?.color || '#6B6560',
          status,
          nodeTypes: [n8nType],
        });
      }
    }

    const connectors = Array.from(byConnector.values())
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));

    const ready = connectors.filter(c => c.status === 'connected').length;
    const total = connectors.length;

    return {
      connectors,
      ready,
      total,
      allReady: ready === total,
    };
  }, [spec, nodeTypes]);

  return { ...result, loading };
}
