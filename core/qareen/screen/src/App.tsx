import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import { Skeleton } from '@/components/primitives';

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

// ── Sub-views ──
const Sessions = lazy(() => import('@/pages/Sessions'));
const SessionDetail = lazy(() => import('@/pages/SessionDetail'));

// ── Review: pages with real UI, kept for evaluation ──
const Meeting = lazy(() => import('@/pages/Meeting'));
const Calendar = lazy(() => import('@/pages/Calendar'));
const Approvals = lazy(() => import('@/pages/Approvals'));

function PageFallback() {
  return (
    <div className="space-y-4 py-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-16 w-full rounded-[7px]" />
        <Skeleton className="h-16 w-full rounded-[7px]" />
        <Skeleton className="h-16 w-full rounded-[7px]" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
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
          <Route path="/org" element={<Org />} />

          {/* ── Sub-routes ── */}
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />

          {/* ── Review: pages kept for evaluation ── */}
          <Route path="/meeting" element={<Meeting />} />
          <Route path="/calendar" element={<Calendar />} />

          <Route path="/approvals" element={<Approvals />} />

          <Route path="/automations" element={<Automations />} />

        </Route>
      </Routes>
    </Suspense>
  );
}
