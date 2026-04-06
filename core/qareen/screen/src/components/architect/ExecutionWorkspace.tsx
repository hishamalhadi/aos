/**
 * ExecutionWorkspace — Tabbed right panel for the Automation Architect.
 * Tabs: Flow (step cards), Trace, Waterfall, Output.
 * Tab strip uses glass pill pattern per DESIGN.md.
 */
import { Activity, BarChart3, FileOutput, Workflow } from 'lucide-react';
import { FlowTab } from './tabs/FlowTab';
import { ReadinessBar } from './ReadinessBar';
import { useArchitectStore, type WorkspaceTab } from '@/store/architect';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'trace', label: 'Trace' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'output', label: 'Output' },
];

function GlassPillTabs({
  active,
  onChange,
}: {
  active: WorkspaceTab;
  onChange: (id: WorkspaceTab) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 h-8 rounded-full px-1"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="px-3 h-6 rounded-full text-[11px] font-[510] transition-colors cursor-pointer"
            style={{
              background: isActive ? 'rgba(255, 245, 235, 0.10)' : 'transparent',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-quaternary)',
              transitionDuration: '150ms',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyTab({ icon: Icon, message }: { icon: typeof Workflow; message: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center opacity-25">
        <Icon className="w-7 h-7 text-text-quaternary mx-auto mb-2" />
        <p className="text-[11px] text-text-quaternary">{message}</p>
      </div>
    </div>
  );
}

export function ExecutionWorkspace() {
  const activeTab = useArchitectStore((s) => s.activeTab);
  const setActiveTab = useArchitectStore((s) => s.setActiveTab);

  return (
    <div className="flex flex-col h-full">
      {/* Glass pill tab strip */}
      <div className="shrink-0 px-4 pt-3 pb-1">
        <GlassPillTabs active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Readiness bar — auto-hides when spec has no steps */}
      <ReadinessBar />

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'flow' && <FlowTab />}
        {activeTab === 'trace' && <EmptyTab icon={Activity} message="Run a test to see trace" />}
        {activeTab === 'waterfall' && <EmptyTab icon={BarChart3} message="Run a test to see timing" />}
        {activeTab === 'output' && <EmptyTab icon={FileOutput} message="Run a test to see output" />}
      </div>
    </div>
  );
}
