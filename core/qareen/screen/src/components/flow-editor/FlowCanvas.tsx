/**
 * FlowCanvas — ReactFlow wrapper with warm dark theme.
 *
 * Renders the node graph with minimap, controls, and background.
 * Handles keyboard shortcuts and drag-to-add from palette.
 */
import { useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  type ReactFlowInstance,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TriggerNode from './nodes/TriggerNode';
import ActionNode from './nodes/ActionNode';
import LogicNode from './nodes/LogicNode';
import { useFlowEditor } from './hooks/useFlowEditor';

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  logic: LogicNode,
};

export default function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    setSelectedNode, addNode, removeSelected,
    mode,
  } = useFlowEditor();

  const isEditable = mode === 'edit';

  // Handle node click → select for config panel
  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // Keyboard shortcuts
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && isEditable) {
      removeSelected();
    }
  }, [isEditable, removeSelected]);

  // Drag-and-drop from palette
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const n8nType = e.dataTransfer.getData('application/reactflow');
    if (!n8nType) return;

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(n8nType, position);
  }, [screenToFlowPosition, addNode]);

  return (
    <div
      ref={reactFlowWrapper}
      className="flex-1 h-full"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isEditable ? onNodesChange : undefined}
        onEdgesChange={isEditable ? onEdgesChange : undefined}
        onConnect={isEditable ? onConnect : undefined}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDrop={isEditable ? onDrop : undefined}
        onDragOver={isEditable ? onDragOver : undefined}
        nodeTypes={nodeTypes}
        nodesDraggable={isEditable}
        nodesConnectable={isEditable}
        elementsSelectable={true}
        snapToGrid={isEditable}
        snapGrid={[25, 25]}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={25}
          size={1}
          color="rgba(255, 245, 235, 0.04)"
        />
        <MiniMap
          nodeStrokeWidth={3}
          style={{
            backgroundColor: '#0D0B09',
            border: '1px solid rgba(255, 245, 235, 0.06)',
            borderRadius: 7,
          }}
          maskColor="rgba(13, 11, 9, 0.7)"
        />
        <Controls
          showInteractive={isEditable}
          style={{
            borderRadius: 7,
            border: '1px solid rgba(255, 245, 235, 0.06)',
            overflow: 'hidden',
          }}
        />
      </ReactFlow>

      {/* React Flow CSS overrides for warm dark theme */}
      <style>{`
        .react-flow {
          --xy-background-color: transparent;
          --xy-node-border-radius: 10px;
          --xy-edge-stroke: rgba(255, 245, 235, 0.15);
          --xy-edge-stroke-selected: #D9730D;
          --xy-edge-stroke-width: 2;
          --xy-handle-background-color: #D9730D;
          --xy-handle-border-color: #151210;
          --xy-minimap-background: #0D0B09;
          --xy-controls-button-background-color: #1E1A16;
          --xy-controls-button-background-color-hover: #2A2520;
          --xy-controls-button-color: #E8E4DF;
          --xy-controls-button-border-color: rgba(255, 245, 235, 0.06);
        }
        .react-flow__edge-path {
          stroke: rgba(255, 245, 235, 0.15);
          stroke-width: 2;
        }
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #D9730D;
        }
        .react-flow__handle {
          width: 10px;
          height: 10px;
          border: 2px solid #151210;
          border-radius: 50%;
        }
        .react-flow__controls button {
          width: 28px;
          height: 28px;
        }
        .react-flow__controls button svg {
          max-width: 14px;
          max-height: 14px;
        }
      `}</style>
    </div>
  );
}
