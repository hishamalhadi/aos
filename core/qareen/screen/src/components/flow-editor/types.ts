/**
 * Flow editor type definitions.
 *
 * Bridges the gap between n8n workflow JSON and React Flow state.
 */
import type { Node, Edge } from '@xyflow/react';

// ── Node categories ──

export type NodeCategory = 'trigger' | 'action' | 'logic';

// ── Flow node data (stored in ReactFlow node.data) ──

export interface FlowNodeData extends Record<string, unknown> {
  n8nType: string;                    // e.g. "n8n-nodes-base.scheduleTrigger"
  n8nName: string;                    // Original n8n node name
  label: string;                      // Display name
  category: NodeCategory;
  icon: string;                       // Lucide icon name
  color: string;                      // Brand/category color
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  typeVersion?: number;
}

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge;

// ── Node type definition (from constants registry) ──

export interface FieldSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'toggle' | 'cron';
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  required?: boolean;
}

export interface NodeTypeDefinition {
  n8nType: string;                    // n8n-nodes-base.xxx
  label: string;                      // Display name
  category: NodeCategory;
  icon: string;                       // Lucide icon name
  color: string;                      // Accent color
  description: string;
  fields: FieldSchema[];              // Configurable parameters
  defaultParameters: Record<string, unknown>;
  credentialType?: string;            // n8n credential type this node needs
  handles: {
    inputs: number;                   // Number of input handles
    outputs: number;                  // Number of output handles
  };
}

// ── n8n workflow JSON types ──

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface N8nConnection {
  node: string;
  type: string;
  index: number;
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
  settings?: Record<string, unknown>;
}

// ── Editor state ──

export type EditorMode = 'view' | 'edit';

export interface WorkflowMeta {
  automationId: string;
  n8nWorkflowId: string;
  name: string;
}
