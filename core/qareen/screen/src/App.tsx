import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';

// ── Primary surfaces ──
const Companion = lazy(() => import('@/pages/Companion'));
const Work = lazy(() => import('@/pages/Work'));
const People = lazy(() => import('@/pages/People'));
const Vault = lazy(() => import('@/pages/Vault'));
const Chat = lazy(() => import('@/pages/Chat'));
const System = lazy(() => import('@/pages/System'));
const Settings = lazy(() => import('@/pages/Settings'));
const Days = lazy(() => import('@/pages/Days'));
const Agents = lazy(() => import('@/pages/Agents'));
const Automations = lazy(() => import('@/pages/Automations'));
const Org = lazy(() => import('@/pages/Org'));
const Skills = lazy(() => import('@/pages/Skills'));

// ── Sub-views ──
const Sessions = lazy(() => import('@/pages/Sessions'));
const SessionDetail = lazy(() => import('@/pages/SessionDetail'));
const AutomationEditor = lazy(() => import('@/pages/AutomationEditor'));
const AutomationArchitect = lazy(() => import('@/pages/AutomationArchitect'));
const AgentConfig = lazy(() => import('@/pages/AgentConfig'));

// ── Review: pages with real UI, kept for evaluation ──
const Meeting = lazy(() => import('@/pages/Meeting'));
const Calendar = lazy(() => import('@/pages/Calendar'));
const Approvals = lazy(() => import('@/pages/Approvals'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* ── Primary surfaces ── */}
        <Route path="/" element={<Companion />} />
        <Route path="/work" element={<Work />} />
        <Route path="/people" element={<People />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="/vault/knowledge" element={<Vault />} />
        <Route path="/vault/logs" element={<Vault />} />
        <Route path="/docs" element={<Vault />} />
        <Route path="/timeline" element={<Days />} />
        <Route path="/timeline/*" element={<Days />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/system" element={<System />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:id" element={<AgentConfig />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/org" element={<Org />} />

        {/* ── Sub-routes ── */}
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />

        {/* ── Review: pages kept for evaluation ── */}
        <Route path="/meeting" element={<Meeting />} />
        <Route path="/calendar" element={<Calendar />} />

        <Route path="/approvals" element={<Approvals />} />

        <Route path="/automations" element={<Automations />} />
        <Route path="/automations/new" element={<AutomationArchitect />} />
        <Route path="/automations/:id" element={<AutomationEditor />} />
        <Route path="/automations/:id/edit" element={<AutomationEditor />} />

      </Route>
    </Routes>
  );
}
