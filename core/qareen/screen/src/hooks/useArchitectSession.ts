/**
 * useArchitectSession — Manages the automation architect conversation.
 *
 * Creates a session, sends messages via SSE, splits events into
 * conversation messages and flow spec updates.
 */
import { useState, useCallback, useRef } from 'react';
import type { FlowNode, FlowEdge } from '@/components/flow-editor/types';
import { getNodeDefOrDefault } from '@/components/flow-editor/constants';
import { useArchitectStore } from '@/store/architect';

// Re-export types from shared location (avoids circular deps with store)
export type {
  ArchitectMessage,
  ArchitectPhase,
  FlowSystemSpec,
} from '@/lib/architect-types';

import type { ArchitectMessage, ArchitectPhase, FlowSystemSpec } from '@/lib/architect-types';

// ── Spec to React Flow converter ──

export function specToReactFlow(spec: FlowSystemSpec): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let edgeIdx = 0;

  // Layout: vertical pipeline — steps flow top-to-bottom, centered
  let pipelineX = 100;

  for (const pipeline of spec.pipelines) {
    const x = pipelineX;
    let y = 50;
    const stepNodeIds: Record<string, string> = {};
    const yStep = 120;

    // Trigger node
    const triggerId = `${pipeline.id}-trigger`;
    const triggerType = pipeline.trigger?.type || 'n8n-nodes-base.scheduleTrigger';
    const triggerDef = getNodeDefOrDefault(triggerType, 'Trigger');

    nodes.push({
      id: triggerId,
      type: 'trigger',
      position: { x, y },
      data: {
        n8nType: triggerType,
        n8nName: 'Trigger',
        label: triggerDef.label,
        category: 'trigger',
        icon: triggerDef.icon,
        color: triggerDef.color,
        parameters: pipeline.trigger?.parameters || {},
      },
    });
    y += yStep;

    // Step nodes
    for (const step of pipeline.steps) {
      const nodeId = `${pipeline.id}-${step.id}`;
      stepNodeIds[step.id] = nodeId;

      // Determine visual type
      let n8nType: string;
      let nodeType: 'trigger' | 'action' | 'logic';

      if (step.type === 'agent_dispatch') {
        n8nType = 'aos.agentDispatch';
        nodeType = 'action';
      } else if (step.type === 'hitl_approval') {
        n8nType = 'aos.hitlApproval';
        nodeType = 'logic';
      } else if (step.type === 'sub_workflow') {
        n8nType = 'n8n-nodes-base.executeWorkflow';
        nodeType = 'logic';
      } else {
        n8nType = step.n8n_type || 'n8n-nodes-base.set';
        const def = getNodeDefOrDefault(n8nType, step.label);
        nodeType = def.category === 'trigger' ? 'trigger' : def.category === 'logic' ? 'logic' : 'action';
      }

      const def = getNodeDefOrDefault(n8nType, step.label);

      // Branching steps offset horizontally
      const branchOffset = step.branch_conditions?.length
        ? 0
        : 0;

      nodes.push({
        id: nodeId,
        type: nodeType,
        position: { x: x + branchOffset, y },
        data: {
          n8nType,
          n8nName: step.label,
          label: step.label,
          category: def.category,
          icon: def.icon,
          color: def.color,
          parameters: step.parameters || {},
        },
      });

      y += yStep;
    }

    // Build edges: trigger -> first step
    if (pipeline.steps.length > 0) {
      const firstStepId = stepNodeIds[pipeline.steps[0].id];
      edges.push({
        id: `e-${edgeIdx++}`,
        source: triggerId,
        target: firstStepId,
        sourceHandle: 'output-0',
        targetHandle: 'input-0',
        animated: true,
        style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
      });
    }

    // Build edges between steps
    for (const step of pipeline.steps) {
      const sourceId = stepNodeIds[step.id];

      if (step.branch_conditions && step.branch_conditions.length > 0) {
        // Branching edges
        step.branch_conditions.forEach((bc, idx) => {
          const targetId = stepNodeIds[bc.target_step];
          if (targetId) {
            edges.push({
              id: `e-${edgeIdx++}`,
              source: sourceId,
              target: targetId,
              sourceHandle: `output-${idx}`,
              targetHandle: 'input-0',
              animated: true,
              label: bc.condition,
              style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
            });
          }
        });
      } else if (step.next && step.next.length > 0) {
        // Explicit next
        for (const nextId of step.next) {
          const targetId = stepNodeIds[nextId];
          if (targetId) {
            edges.push({
              id: `e-${edgeIdx++}`,
              source: sourceId,
              target: targetId,
              sourceHandle: 'output-0',
              targetHandle: 'input-0',
              animated: true,
              style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
            });
          }
        }
      } else {
        // Auto-connect to next step in sequence
        const stepIdx = pipeline.steps.indexOf(step);
        if (stepIdx < pipeline.steps.length - 1) {
          const nextStep = pipeline.steps[stepIdx + 1];
          const targetId = stepNodeIds[nextStep.id];
          edges.push({
            id: `e-${edgeIdx++}`,
            source: sourceId,
            target: targetId,
            sourceHandle: 'output-0',
            targetHandle: 'input-0',
            animated: true,
            style: { stroke: 'rgba(255, 245, 235, 0.15)', strokeWidth: 2 },
          });
        }
      }
    }

    pipelineX += 350; // Offset next pipeline horizontally
  }

  return { nodes, edges };
}

// ── Hook ──

export function useArchitectSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ArchitectMessage[]>([]);
  const [phase, setPhase] = useState<ArchitectPhase>('investigate');
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Spec dual-tracked: local state for hook consumers, store for workspace components
  const [spec, setSpec] = useState<FlowSystemSpec | null>(null);

  const createSession = useCallback(async () => {
    const res = await fetch('/api/architect/session', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create session');
    const data = await res.json();
    setSessionId(data.session_id);
    setMessages([]);
    setPhase('investigate');
    setSpec(null);
    useArchitectStore.getState().clearSpec();
    setFlowNodes([]);
    setFlowEdges([]);
    return data.session_id;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    let sid = sessionId;
    if (!sid) {
      sid = await createSession();
    }

    // Add user message immediately
    const userMsg: ArchitectMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    // Abort previous stream if any
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/architect/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Show error in chat
        const errText = await res.text().catch(() => 'Request failed');
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${errText}`,
          timestamp: new Date().toISOString(),
        }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';

      // Add empty assistant message to fill in
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);

              if (eventType === 'status' && data.status) {
                setStatusText(data.status);
              } else if (eventType === 'text' && data.chunk) {
                setStatusText(null); // Clear status once text starts
                assistantText += data.chunk;
                // Update the last message (assistant) with accumulated text
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: assistantText };
                  }
                  return updated;
                });
              } else if (eventType === 'flow_update' && data.spec) {
                setSpec(data.spec);
                useArchitectStore.getState().setSpec(data.spec);
                const { nodes, edges } = specToReactFlow(data.spec);
                setFlowNodes(nodes);
                setFlowEdges(edges);
              } else if (eventType === 'phase' && data.phase) {
                setPhase(data.phase);
              }
            } catch {
              // Skip malformed JSON
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Architect stream error:', err);
        // Show error in the last assistant message
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content: `Connection error: ${(err as Error).message}`,
            };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      setStatusText(null);
      abortRef.current = null;
    }
  }, [sessionId, createSession]);

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/architect/session/${id}`);
    if (!res.ok) return;
    const data = await res.json();

    setSessionId(data.id);
    setMessages(data.messages || []);
    setPhase(data.phase || 'investigate');
    setSpec(data.spec || null);
    useArchitectStore.getState().setSpec(data.spec || null);

    if (data.spec) {
      const { nodes, edges } = specToReactFlow(data.spec);
      setFlowNodes(nodes);
      setFlowEdges(edges);
    } else {
      setFlowNodes([]);
      setFlowEdges([]);
    }
  }, []);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setPhase('investigate');
    setSpec(null);
    useArchitectStore.getState().clearSpec();
    setFlowNodes([]);
    setFlowEdges([]);
  }, []);

  return {
    sessionId,
    messages,
    phase,
    spec,
    flowNodes,
    flowEdges,
    isStreaming,
    statusText,
    createSession,
    sendMessage,
    loadSession,
    resetSession,
  };
}
