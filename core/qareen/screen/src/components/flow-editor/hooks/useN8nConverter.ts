/**
 * n8n workflow JSON <-> React Flow state converter.
 *
 * The critical mapping: n8n connections are keyed by node NAME,
 * React Flow edges reference node ID. We build name<->id lookups.
 */
import type { FlowNode, FlowEdge, FlowNodeData, N8nWorkflow, N8nNode, N8nConnection } from '../types';
import { getNodeDefOrDefault } from '../constants';

// ── n8n JSON → React Flow ──

export function n8nToFlow(workflow: N8nWorkflow): { nodes: FlowNode[]; edges: FlowEdge[] } {
  // Build name → id lookup
  const nameToId: Record<string, string> = {};
  for (const node of workflow.nodes) {
    nameToId[node.name] = node.id;
  }

  // Convert nodes
  const nodes: FlowNode[] = workflow.nodes.map((n8nNode) => {
    const def = getNodeDefOrDefault(n8nNode.type, n8nNode.name);
    const category = def.category;
    const nodeType = category === 'trigger' ? 'trigger' : category === 'logic' ? 'logic' : 'action';

    return {
      id: n8nNode.id,
      type: nodeType,
      position: { x: n8nNode.position[0], y: n8nNode.position[1] },
      data: {
        n8nType: n8nNode.type,
        n8nName: n8nNode.name,
        label: def.label !== n8nNode.name ? n8nNode.name : def.label,
        category,
        icon: def.icon,
        color: def.color,
        parameters: n8nNode.parameters || {},
        credentials: n8nNode.credentials,
        typeVersion: n8nNode.typeVersion,
      } satisfies FlowNodeData,
    };
  });

  // Convert connections to edges
  const edges: FlowEdge[] = [];
  let edgeIndex = 0;

  for (const [sourceName, outputs] of Object.entries(workflow.connections || {})) {
    const sourceId = nameToId[sourceName];
    if (!sourceId) continue;

    const mainOutputs = outputs.main || [];
    for (let outputIdx = 0; outputIdx < mainOutputs.length; outputIdx++) {
      const targets = mainOutputs[outputIdx] || [];
      for (const target of targets) {
        const targetId = nameToId[target.node];
        if (!targetId) continue;

        edges.push({
          id: `e-${edgeIndex++}`,
          source: sourceId,
          target: targetId,
          sourceHandle: `output-${outputIdx}`,
          targetHandle: `input-${target.index}`,
          animated: true,
          style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
        });
      }
    }
  }

  return { nodes, edges };
}

// ── React Flow → n8n JSON ──

export function flowToN8n(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowName: string = 'Workflow',
): N8nWorkflow {
  // Build id → name lookup
  const idToName: Record<string, string> = {};
  for (const node of nodes) {
    idToName[node.id] = (node.data as FlowNodeData).n8nName || node.id;
  }

  // Convert nodes
  const n8nNodes: N8nNode[] = nodes.map((node) => {
    const data = node.data as FlowNodeData;
    return {
      id: node.id,
      name: data.n8nName || data.label,
      type: data.n8nType,
      typeVersion: data.typeVersion || 1,
      position: [Math.round(node.position.x), Math.round(node.position.y)] as [number, number],
      parameters: data.parameters || {},
      ...(data.credentials && { credentials: data.credentials }),
    };
  });

  // Convert edges to n8n connections (grouped by source node name)
  const connections: Record<string, { main: N8nConnection[][] }> = {};

  for (const edge of edges) {
    const sourceName = idToName[edge.source];
    const targetName = idToName[edge.target];
    if (!sourceName || !targetName) continue;

    if (!connections[sourceName]) {
      connections[sourceName] = { main: [] };
    }

    // Parse output index from handle id (e.g. "output-0" → 0)
    const outputIdx = edge.sourceHandle
      ? parseInt(edge.sourceHandle.replace('output-', ''), 10)
      : 0;

    // Parse input index
    const inputIdx = edge.targetHandle
      ? parseInt(edge.targetHandle.replace('input-', ''), 10)
      : 0;

    // Ensure the output array is long enough
    while (connections[sourceName].main.length <= outputIdx) {
      connections[sourceName].main.push([]);
    }

    connections[sourceName].main[outputIdx].push({
      node: targetName,
      type: 'main',
      index: inputIdx,
    });
  }

  return {
    name: workflowName,
    nodes: n8nNodes,
    connections,
    settings: { executionOrder: 'v1' },
  };
}
