/**
 * Today — the main Work landing page.
 *
 * Shows the full hierarchy from high level to low level:
 *   Goals (where you're going) → Projects (what you're building) → Tasks (what to do now)
 *
 * This is the morning briefing view — everything you need at a glance.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Target, FolderOpen, User } from 'lucide-react';
import { useWork, type Task } from '@/hooks/useWork';
import { useUpdateTask } from '@/hooks/useTasks';
import { useMetrics } from '@/hooks/useMetrics';
import { StatusDot } from '@/components/primitives/StatusDot';
import { TaskStatus } from '@/lib/types';
import { format, isPast, isToday, isTomorrow, differenceInDays } from 'date-fns';

const PRI: Record<number, string> = { 1: '#FF453A', 2: '#D9730D', 3: '#6B6560', 4: '#0A84FF', 5: '#4A4540' };

function formatDue(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return { text: 'Today', overdue: false };
  if (isTomorrow(d)) return { text: 'Tomorrow', overdue: false };
  if (isPast(d)) return { text: `${Math.abs(differenceInDays(d, new Date()))}d overdue`, overdue: true };
  const days = differenceInDays(d, new Date());
  return days <= 7 ? { text: `in ${days}d`, overdue: false } : { text: format(d, 'MMM d'), overdue: false };
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const done = task.status === 'done';
  const due = task.due ? formatDue(task.due) : null;
  return (
    <div className="flex items-center gap-3 h-10 px-2 rounded-lg hover:bg-bg-secondary transition-colors duration-75 group">
      <button onClick={onToggle}
        className="w-[16px] h-[16px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 cursor-pointer"
        style={{ borderColor: done ? '#30D158' : 'rgba(255,245,235,0.15)', backgroundColor: done ? '#30D158' : 'transparent' }}>
        {done && <svg width="8" height="6" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#0D0B09" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      <div className="w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: PRI[task.priority] }} />
      <span className={`flex-1 min-w-0 text-[13px] truncate ${done ? 'text-text-quaternary line-through' : 'text-text-secondary'}`}>{task.title}</span>
      <div className="flex items-center gap-2 text-[10px] text-text-quaternary opacity-0 group-hover:opacity-100 transition-opacity duration-75">
        {task.project && <span>{task.project}</span>}
        {due && <span className={due.overdue ? 'text-red' : ''}>{due.text}</span>}
      </div>
    </div>
  );
}

export default function TodayPage() {
  const { data, isLoading } = useWork();
  const update = useUpdateTask();
  const now = new Date();

  const tasks = data?.tasks ?? [];
  const projects = data?.projects ?? [];
  const goals = (data?.goals ?? []) as Array<{ id: string; title: string; description?: string; status?: string; key_results?: Array<{ title: string; current: number; target: number }> }>;

  const notDone = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';
  const overdue = tasks.filter(t => t.due && isPast(new Date(t.due)) && !isToday(new Date(t.due)) && notDone(t));
  const todayTasks = tasks.filter(t => t.due && isToday(new Date(t.due)) && notDone(t));
  const activeTasks = tasks.filter(t => t.status === 'active');
  const todoCount = tasks.filter(t => t.status === 'todo').length;
  const doneToday = tasks.filter(t => t.status === 'done' && t.completed && isToday(new Date(t.completed)));

  const [showDone, setShowDone] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center h-full"><p className="text-text-quaternary">Loading...</p></div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[640px] mx-auto px-4 py-6">
        {/* Header */}
        <h2 className="text-[24px] font-[600] text-text mb-0.5">Today</h2>
        <p className="text-[13px] text-text-tertiary mb-8">{format(now, 'EEEE, MMMM d')}</p>

        {/* ── Summary stats ── */}
        <div className="flex items-center gap-6 mb-8 text-[12px]">
          {overdue.length > 0 && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red" /><span className="text-red font-[510]">{overdue.length} overdue</span></div>}
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue" /><span className="text-text-tertiary">{activeTasks.length} active</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-text-quaternary" /><span className="text-text-tertiary">{todoCount} todo</span></div>
          {doneToday.length > 0 && <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green" /><span className="text-green">{doneToday.length} done today</span></div>}
        </div>

        {/* ── Goals (highest level) ── */}
        {goals.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-text-quaternary" />
              <h3 className="text-[12px] font-[590] text-text-tertiary uppercase tracking-[0.04em]">Goals</h3>
              <span className="text-[10px] font-mono text-text-quaternary">{goals.length}</span>
            </div>
            <div className="space-y-2">
              {goals.map(goal => {
                const krs = goal.key_results ?? [];
                const progress = krs.length > 0
                  ? Math.round(krs.reduce((sum, kr) => sum + (kr.target > 0 ? kr.current / kr.target : 0), 0) / krs.length * 100)
                  : 0;
                return (
                  <div key={goal.id} className="px-3 py-2.5 rounded-lg bg-bg-secondary border border-border">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13px] font-[510] text-text-secondary">{goal.title}</span>
                      <span className="text-[10px] font-mono text-text-quaternary">{progress}%</span>
                    </div>
                    <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${progress >= 100 ? 'bg-green' : progress >= 50 ? 'bg-accent' : 'bg-yellow'}`} style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Active Projects ── */}
        {projects.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-4 h-4 text-text-quaternary" />
              <h3 className="text-[12px] font-[590] text-text-tertiary uppercase tracking-[0.04em]">Projects</h3>
              <span className="text-[10px] font-mono text-text-quaternary">{projects.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {projects.map(proj => {
                const projTasks = tasks.filter(t => t.project === proj.id || t.project === proj.title);
                const doneCount = projTasks.filter(t => t.status === 'done').length;
                const total = projTasks.length;
                const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                return (
                  <div key={proj.id} className="px-3 py-2 rounded-lg bg-bg-secondary border border-border min-w-[140px]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-[510] text-text-secondary">{proj.title}</span>
                      <span className="text-[9px] font-mono text-text-quaternary">{doneCount}/{total}</span>
                    </div>
                    <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Overdue ── */}
        {overdue.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 px-2 mb-1">
              <h3 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-red">Overdue</h3>
              <span className="text-[10px] font-mono text-text-quaternary">{overdue.length}</span>
            </div>
            {overdue.map(t => <TaskRow key={t.id} task={t} onToggle={() => update.mutate({ id: t.id, data: { status: TaskStatus.DONE } })} />)}
          </div>
        )}

        {/* ── Due Today ── */}
        {todayTasks.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 px-2 mb-1">
              <h3 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">Due today</h3>
              <span className="text-[10px] font-mono text-text-quaternary">{todayTasks.length}</span>
            </div>
            {todayTasks.map(t => <TaskRow key={t.id} task={t} onToggle={() => update.mutate({ id: t.id, data: { status: TaskStatus.DONE } })} />)}
          </div>
        )}

        {/* ── In Progress ── */}
        {activeTasks.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-2 px-2 mb-1">
              <h3 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">In progress</h3>
              <span className="text-[10px] font-mono text-text-quaternary">{activeTasks.length}</span>
            </div>
            {activeTasks.map(t => <TaskRow key={t.id} task={t} onToggle={() => update.mutate({ id: t.id, data: { status: TaskStatus.DONE } })} />)}
          </div>
        )}

        {/* ── Completed today ── */}
        {doneToday.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border">
            <button onClick={() => setShowDone(!showDone)} className="flex items-center gap-2 px-2 cursor-pointer">
              {showDone ? <ChevronDown className="w-3 h-3 text-text-quaternary" /> : <ChevronRight className="w-3 h-3 text-text-quaternary" />}
              <span className="text-[10px] font-[590] uppercase tracking-[0.06em] text-green">Completed today</span>
              <span className="text-[10px] font-mono text-text-quaternary">{doneToday.length}</span>
            </button>
            {showDone && doneToday.map(t => <TaskRow key={t.id} task={t} onToggle={() => update.mutate({ id: t.id, data: { status: TaskStatus.TODO } })} />)}
          </div>
        )}

        {/* Empty state */}
        {overdue.length === 0 && todayTasks.length === 0 && activeTasks.length === 0 && goals.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[15px] text-text-quaternary opacity-50">Nothing on the plate.</p>
            <p className="text-[11px] text-text-quaternary opacity-30 mt-1">Goals, projects, and tasks will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
