/**
 * AutomationEditor — Page wrapper for the visual workflow editor.
 *
 * Routes:
 *   /automations/:id       → View mode (read-only)
 *   /automations/:id/edit  → Edit mode (full editor)
 *   /automations/new/edit  → Create new (empty canvas)
 */
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import FlowEditor from '@/components/flow-editor/FlowEditor';
import { useWorkflowDetail } from '@/hooks/useAutomations';
import type { N8nWorkflow } from '@/components/flow-editor/types';
import type { EditorMode } from '@/components/flow-editor/types';

export default function AutomationEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const navigate = useNavigate();
  const isNew = id === 'new';
  const modeParam = searchParams.get('mode');
  const initialMode: EditorMode = modeParam === 'edit' || isNew ? 'edit' : 'view';

  // Fetch workflow if editing existing
  const { data: workflowData, isLoading } = useWorkflowDetail(isNew ? null : (id ?? null));

  // Fetch snapshot for restore
  const { data: snapshotData } = useQuery({
    queryKey: ['workflow-snapshot', id],
    queryFn: async () => {
      const res = await fetch(`/api/automations/${id}/snapshot`);
      return res.json();
    },
    enabled: !!id && !isNew,
    staleTime: 30_000,
  });

  // Save mutation — creates record first for new automations
  const saveMutation = useMutation({
    mutationFn: async (workflow: N8nWorkflow) => {
      let targetId = id;

      if (isNew || !targetId) {
        const createRes = await fetch('/api/automations/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workflow.name || 'Untitled Automation' }),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
        const { id: newId } = await createRes.json();
        targetId = newId;
      }

      const res = await fetch(`/api/automations/${targetId}/workflow`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      return { ...(await res.json()), _newId: isNew ? targetId : undefined };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['n8n-automations'] });
      if (data?._newId) {
        navigate(`/automations/${data._newId}?mode=edit`, { replace: true });
      }
    },
  });

  // Build meta from available data
  const meta = id && !isNew ? {
    automationId: id,
    n8nWorkflowId: workflowData?.id || '',
    name: workflowData?.name || 'Automation',
  } : null;

  const emptyWorkflow: N8nWorkflow = { name: 'Untitled Automation', nodes: [], connections: {}, settings: {} };
  const hasSnapshot = !!snapshotData?.snapshot;

  const handleRestore = () => {
    if (snapshotData?.snapshot) {
      qc.setQueryData(['workflow-detail', id], snapshotData.snapshot);
      qc.invalidateQueries({ queryKey: ['workflow-detail', id] });
    }
  };

  return (
    <FlowEditor
      workflow={isNew ? emptyWorkflow : (workflowData ?? null)}
      meta={meta}
      initialMode={initialMode}
      isLoading={!isNew && isLoading}
      onSave={(wf) => saveMutation.mutate(wf)}
      isSaving={saveMutation.isPending}
      canRestore={hasSnapshot}
      onRestore={handleRestore}
    />
  );
}
