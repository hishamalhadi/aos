/**
 * Zustand store for the flow editor.
 *
 * Manages: nodes, edges, selection, dirty state, mode (view/edit).
 * Integrates with React Flow's change handlers.
 */
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
} from '@xyflow/react';
import type { FlowNode, FlowEdge, FlowNodeData, EditorMode, WorkflowMeta, N8nWorkflow } from '../types';
import { getNodeDefOrDefault } from '../constants';
import { n8nToFlow, flowToN8n } from './useN8nConverter';

interface FlowEditorState {
  // State
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  mode: EditorMode;
  isDirty: boolean;
  workflowMeta: WorkflowMeta | null;

  // React Flow event handlers
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // Actions
  setMode: (mode: EditorMode) => void;
  setSelectedNode: (id: string | null) => void;
  loadWorkflow: (workflow: N8nWorkflow, meta: WorkflowMeta) => void;
  addNode: (n8nType: string, position: { x: number; y: number }) => void;
  removeSelected: () => void;
  updateNodeData: (nodeId: string, updates: Partial<FlowNodeData>) => void;
  serializeToN8n: () => N8nWorkflow;
  resetDirty: () => void;
}

let nodeCounter = 0;

export const useFlowEditor = create<FlowEditorState>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  selectedNodeId: null,
  mode: 'view',
  isDirty: false,
  workflowMeta: null,

  // React Flow handlers — these get passed directly to <ReactFlow>
  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as FlowNode[],
      isDirty: state.mode === 'edit' ? true : state.isDirty,
    }));
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges) as FlowEdge[],
      isDirty: state.mode === 'edit' ? true : state.isDirty,
    }));
  },

  onConnect: (connection: Connection) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          animated: true,
          style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
        },
        state.edges,
      ) as FlowEdge[],
      isDirty: true,
    }));
  },

  // Actions
  setMode: (mode) => set({ mode }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  loadWorkflow: (workflow, meta) => {
    const { nodes, edges } = n8nToFlow(workflow);
    // Reset counter to avoid ID collisions
    nodeCounter = nodes.length + 1;
    set({
      nodes,
      edges,
      workflowMeta: meta,
      isDirty: false,
      selectedNodeId: null,
    });
  },

  addNode: (n8nType, position) => {
    const def = getNodeDefOrDefault(n8nType, '');
    const id = `new-${++nodeCounter}`;
    const name = `${def.label} ${nodeCounter}`;
    const nodeType = def.category === 'trigger' ? 'trigger' : def.category === 'logic' ? 'logic' : 'action';

    const newNode: FlowNode = {
      id,
      type: nodeType,
      position,
      data: {
        n8nType,
        n8nName: name,
        label: name,
        category: def.category,
        icon: def.icon,
        color: def.color,
        parameters: { ...def.defaultParameters },
        typeVersion: 1,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
      selectedNodeId: id,
    }));
  },

  removeSelected: () => {
    const { selectedNodeId, mode } = get();
    if (!selectedNodeId || mode !== 'edit') return;

    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== selectedNodeId),
      edges: state.edges.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId,
      ),
      selectedNodeId: null,
      isDirty: true,
    }));
  },

  updateNodeData: (nodeId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...updates } as FlowNodeData }
          : n,
      ),
      isDirty: true,
    }));
  },

  serializeToN8n: () => {
    const { nodes, edges, workflowMeta } = get();
    return flowToN8n(nodes, edges, workflowMeta?.name || 'Workflow');
  },

  resetDirty: () => set({ isDirty: false }),
}));
