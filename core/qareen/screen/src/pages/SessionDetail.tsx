import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Clock,
  FileText, MessageSquare, Lightbulb, CheckCircle2,
  Loader2,
} from 'lucide-react'
import { AudioPlayer } from '@/components/companion/AudioPlayer'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// SessionDetail — full view of a completed session.
//
// Route: /sessions/:id
// Data: /companion/meetings/:id (merged from both session tables)
// ---------------------------------------------------------------------------

interface TranscriptBlock {
  speaker: string
  text: string
  timestamp: number
  start_time: string
}

interface SessionData {
  id: string
  title: string
  date: string
  duration_seconds: number
  participants: string[]
  transcript: TranscriptBlock[]
  notes: Record<string, string[]>
  summary: string
  audio_path: string
}

type Tab = 'summary' | 'transcript' | 'notes'

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0m'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('summary')

  useEffect(() => {
    if (!id) return
    let cancelled = false

    fetch(`/companion/meetings/${id}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setError(null) } })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [id])

  // Auto-select first available tab
  useEffect(() => {
    if (!data) return
    if (data.summary) { setActiveTab('summary'); return }
    if (data.transcript?.length) { setActiveTab('transcript'); return }
    const noteCount = Object.values(data.notes || {}).reduce((n, items) => n + items.length, 0)
    if (noteCount > 0) { setActiveTab('notes'); return }
    setActiveTab('summary')
  }, [data])

  const noteTopics = useMemo(() =>
    Object.entries(data?.notes || {}).filter(([, items]) => items.length > 0),
    [data]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-4 h-4 text-text-quaternary animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-[720px] mx-auto px-6 pt-10">
        <button
          onClick={() => navigate('/sessions')}
          className="flex items-center gap-1.5 text-[11px] text-text-quaternary hover:text-text-tertiary transition-colors mb-6 cursor-pointer"
          style={{ transitionDuration: 'var(--duration-instant)' }}
        >
          <ArrowLeft className="w-3 h-3" />
          Sessions
        </button>
        <p className="text-[13px] text-text-quaternary">{error ?? 'Session not found.'}</p>
      </div>
    )
  }

  const dateObj = data.date ? new Date(data.date) : null
  const dateStr = dateObj ? format(dateObj, 'EEEE, MMMM d, yyyy') : ''
  const timeStr = dateObj ? format(dateObj, 'h:mm a') : ''
  const hasAudio = !!data.audio_path
  const tasks = data.notes?.Tasks || data.notes?.tasks || []
  const ideas = data.notes?.Ideas || data.notes?.ideas || []
  const keyPoints = noteTopics.filter(([k]) => !['Tasks', 'Ideas', 'tasks', 'ideas'].includes(k))
  const totalNotes = noteTopics.reduce((n, [, v]) => n + v.length, 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-6 pt-10 pb-16">
        {/* Back */}
        <button
          onClick={() => navigate('/sessions')}
          className="flex items-center gap-1.5 text-[11px] text-text-quaternary hover:text-text-tertiary transition-colors mb-6 cursor-pointer"
          style={{ transitionDuration: 'var(--duration-instant)' }}
        >
          <ArrowLeft className="w-3 h-3" />
          Sessions
        </button>

        {/* Title + meta */}
        <h1 className="text-[20px] font-[600] text-text mb-2 font-serif">{data.title}</h1>

        <div className="flex items-center gap-3 flex-wrap mb-8 text-[11px] text-text-quaternary">
          {dateStr && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {dateStr} at {timeStr}
            </span>
          )}
          {data.duration_seconds > 0 && (
            <span className="tabular-nums">{formatDuration(data.duration_seconds)}</span>
          )}
          {data.transcript?.length > 0 && (
            <span className="tabular-nums">{data.transcript.length} segments</span>
          )}
        </div>

        {/* Audio */}
        {hasAudio && (
          <div className="mb-8">
            <AudioPlayer src={`/companion/meetings/${data.id}/audio`} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6">
          <TabPill
            active={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
            disabled={!data.summary}
          >
            Summary
          </TabPill>
          <TabPill
            active={activeTab === 'transcript'}
            onClick={() => setActiveTab('transcript')}
            disabled={!data.transcript?.length}
          >
            Transcript{data.transcript?.length ? ` (${data.transcript.length})` : ''}
          </TabPill>
          <TabPill
            active={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
            disabled={totalNotes === 0}
          >
            Notes{totalNotes > 0 ? ` (${totalNotes})` : ''}
          </TabPill>
        </div>

        {/* Content */}
        <div className="min-h-[200px]">
          {activeTab === 'summary' && <SummaryTab summary={data.summary} />}
          {activeTab === 'transcript' && <TranscriptTab transcript={data.transcript} />}
          {activeTab === 'notes' && <NotesTab keyPoints={keyPoints} tasks={tasks} ideas={ideas} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab pill
// ---------------------------------------------------------------------------

function TabPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        h-7 px-3 rounded-full text-[11px] font-[510] cursor-pointer
        transition-all
        disabled:opacity-20 disabled:pointer-events-none
        ${active
          ? 'bg-bg-tertiary text-text-secondary border border-border-secondary'
          : 'text-text-quaternary hover:text-text-tertiary hover:bg-hover border border-transparent'}
      `}
      style={{ transitionDuration: 'var(--duration-instant)' }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Summary — Garamond for reading surface
// ---------------------------------------------------------------------------

function SummaryTab({ summary }: { summary: string }) {
  if (!summary) {
    return (
      <p className="text-[13px] text-text-quaternary py-8 text-center">
        No summary for this session.
      </p>
    )
  }

  return (
    <div
      className="font-serif text-[14px] text-text-secondary leading-[1.7] space-y-3 session-prose"
      dangerouslySetInnerHTML={{ __html: markdownToHtml(summary) }}
    />
  )
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function TranscriptTab({ transcript }: { transcript: TranscriptBlock[] }) {
  if (!transcript?.length) {
    return (
      <p className="text-[13px] text-text-quaternary py-8 text-center">
        No transcript available.
      </p>
    )
  }

  return (
    <div className="space-y-px">
      {transcript.map((block, i) => (
        <div
          key={i}
          className="flex gap-3 px-3 py-2 rounded-[5px] hover:bg-hover transition-colors"
          style={{ transitionDuration: 'var(--duration-instant)' }}
        >
          <span className="text-[10px] text-text-quaternary font-mono tabular-nums shrink-0 w-[40px] pt-0.5">
            {block.start_time}
          </span>
          <div className="min-w-0 flex-1">
            <span className={`text-[10px] font-[600] ${block.speaker === 'You' ? 'text-accent' : 'text-blue'}`}>
              {block.speaker}
            </span>
            <p className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">
              {block.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function NotesTab({
  keyPoints,
  tasks,
  ideas,
}: {
  keyPoints: [string, string[]][]
  tasks: string[]
  ideas: string[]
}) {
  return (
    <div className="space-y-6">
      {tasks.length > 0 && (
        <NoteSection
          title="Action Items"
          icon={<CheckCircle2 className="w-3.5 h-3.5 text-green" />}
          items={tasks}
          dotColor="bg-green"
        />
      )}
      {ideas.length > 0 && (
        <NoteSection
          title="Ideas"
          icon={<Lightbulb className="w-3.5 h-3.5 text-yellow" />}
          items={ideas}
          dotColor="bg-yellow"
        />
      )}
      {keyPoints.map(([topic, items]) => (
        <NoteSection
          key={topic}
          title={topic}
          icon={<FileText className="w-3.5 h-3.5 text-text-quaternary" />}
          items={items}
        />
      ))}
    </div>
  )
}

function NoteSection({
  title,
  icon,
  items,
  dotColor = 'bg-text-quaternary',
}: {
  title: string
  icon: React.ReactNode
  items: string[]
  dotColor?: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[12px] font-[510] text-text-secondary">{title}</span>
        <span className="text-[10px] text-text-quaternary tabular-nums">({items.length})</span>
      </div>
      <div className="space-y-1 pl-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 py-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-[7px] shrink-0 opacity-60`} />
            <p className="text-[13px] text-text-secondary leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Markdown → HTML
// ---------------------------------------------------------------------------

function markdownToHtml(md: string): string {
  return md
    .split('\n')
    .map(line => {
      if (line.startsWith('### ')) return `<h3>${esc(line.slice(4))}</h3>`
      if (line.startsWith('## ')) return `<h2>${esc(line.slice(3))}</h2>`
      if (line.startsWith('# ')) return `<h1>${esc(line.slice(2))}</h1>`
      if (/^---+\s*$/.test(line)) return '<hr />'
      if (/^\d+\.\s/.test(line)) return `<li>${inlineFmt(line.replace(/^\d+\.\s/, ''))}</li>`
      if (line.startsWith('- ') || line.startsWith('* ')) return `<li>${inlineFmt(line.slice(2))}</li>`
      if (!line.trim()) return '<br />'
      return `<p>${inlineFmt(line)}</p>`
    })
    .join('\n')
}

function inlineFmt(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
