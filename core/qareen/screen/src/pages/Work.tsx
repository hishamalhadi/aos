import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import TasksContent from '@/pages/Tasks';
import ProjectsContent from '@/pages/Projects';
import AnalyticsContent from '@/pages/Analytics';
import TodayContent from '@/pages/Today';

type WorkTab = 'today' | 'tasks' | 'projects' | 'goals';

export default function WorkPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as WorkTab | null;
  const [activeTab, setActiveTab] = useState<WorkTab>(
    tabParam && ['today', 'tasks', 'projects', 'goals'].includes(tabParam) ? tabParam : 'today'
  );
  const [projectFilter, setProjectFilter] = useState<string | null>(searchParams.get('project'));

  const handleTabChange = useCallback((tab: WorkTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

  const handleProjectClick = useCallback((projectId: string) => {
    setProjectFilter(projectId);
    setActiveTab('tasks');
    setSearchParams({ tab: 'tasks', project: projectId }, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab pills — centered, glass */}
      <div className="shrink-0 flex justify-center pt-3 pb-2 pointer-events-none">
        <div
          className="flex items-center gap-1 h-8 px-1 rounded-full border pointer-events-auto"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px)',
            borderColor: 'var(--glass-border)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          {(['today', 'tasks', 'projects', 'goals'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-3.5 h-6 rounded-full text-[12px] font-[510] cursor-pointer transition-all duration-150 ${
                activeTab === tab
                  ? 'bg-[rgba(255,245,235,0.10)] text-text'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'today' && <TodayContent />}
        {activeTab === 'tasks' && <TasksContent initialProjectFilter={projectFilter} />}
        {activeTab === 'projects' && <ProjectsContent onProjectClick={handleProjectClick} />}
        {activeTab === 'goals' && <AnalyticsContent />}
      </div>
    </div>
  );
}
