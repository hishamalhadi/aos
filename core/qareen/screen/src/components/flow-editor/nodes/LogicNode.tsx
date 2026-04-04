import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '../types';
import BaseNode from './BaseNode';

function LogicNode(props: NodeProps) {
  const data = props.data as FlowNodeData;

  let outputs = 1;
  if (data.n8nType === 'n8n-nodes-base.if') {
    outputs = 2;
  } else if (data.n8nType === 'n8n-nodes-base.switch') {
    outputs = 3;
  }

  return <BaseNode {...props} inputs={1} outputs={outputs} />;
}

export default memo(LogicNode);
