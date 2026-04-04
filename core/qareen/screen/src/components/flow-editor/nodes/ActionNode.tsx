import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '../types';
import BaseNode from './BaseNode';

function ActionNode(props: NodeProps) {
  return <BaseNode {...props} inputs={1} outputs={1} />;
}

export default memo(ActionNode);
