import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '../types';
import BaseNode from './BaseNode';

function TriggerNode(props: NodeProps) {
  return <BaseNode {...props} inputs={0} outputs={1} />;
}

export default memo(TriggerNode);
