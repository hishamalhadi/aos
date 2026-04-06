/**
 * ConnectorContext — Provides connector node type status to the flow editor tree.
 *
 * Wraps the flow editor so BaseNode and NodeConfigPanel can access
 * connection status without prop drilling.
 */
import { createContext, type ReactNode } from 'react';
import { useConnectorStatus } from '../../hooks/useConnectorStatus';

type NodeTypeStatus = {
  connector_id: string;
  connector_name: string;
  status: 'connected' | 'partial' | 'available' | 'broken' | 'always';
  icon: string;
  color: string;
  credential_types: string[];
};

export const ConnectorContext = createContext<Record<string, NodeTypeStatus>>({});

export function ConnectorProvider({ children }: { children: ReactNode }) {
  const { nodeTypes } = useConnectorStatus();
  return (
    <ConnectorContext.Provider value={nodeTypes}>
      {children}
    </ConnectorContext.Provider>
  );
}
