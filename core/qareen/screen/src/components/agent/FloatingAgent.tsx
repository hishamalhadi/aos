import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mic, Send, MicOff, Minus, Plus, Maximize2, PanelRight,
  ListTodo, Search, FileText, Zap, SlidersHorizontal,
  Users, Activity, BookOpen, CalendarDays,
} from 'lucide-react'
import { format } from 'date-fns'
import { AgentOrb } from './AgentOrb'

// ---------------------------------------------------------------------------
// FloatingAgent — always-present AI presence, bottom-right.
//
// Orb: ElevenLabs-inspired organic blob — multiple shifting gradient layers,
// no hard border, audio-reactive (future). Just warm light that breathes.
//
// Panel: glass card with context-aware suggestions, message thread, and
// Notion-style input bar. Knows which page + sub-page you're on.
// ---------------------------------------------------------------------------

type AgentPhase = 'orb' | 'panel'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
}

interface Suggestion {
  icon: React.ReactNode
  label: string
  prompt: string
}

// ── Page context — granular, reads sub-routes and query params ──

function getPageContext(pathname: string, searchParams: URLSearchParams): { label: string; detail: string | null } | null {
  // Work + tabs
  if (pathname === '/work' || pathname.startsWith('/work')) {
    const tab = searchParams.get('tab')
    const tabLabels: Record<string, string> = { today: 'Today', tasks: 'Tasks', projects: 'Projects', goals: 'Goals' }
    return { label: 'Work', detail: tab ? tabLabels[tab] ?? tab : 'Today' }
  }
  // Vault + sections
  if (pathname.startsWith('/vault')) {
    if (pathname.includes('/knowledge')) return { label: 'Vault', detail: 'Knowledge' }
    if (pathname.includes('/logs')) return { label: 'Vault', detail: 'Logs' }
    return { label: 'Vault', detail: null }
  }
  // Timeline + date + view
  if (pathname === '/timeline' || pathname.startsWith('/timeline')) {
    const rest = pathname.replace('/timeline', '').replace(/^\//, '')
    if (!rest) return { label: 'Timeline', detail: 'Today' }
    // Parse view/date from path like "week/2026-04-03" or just "2026-04-03"
    const parts = rest.split('/')
    const viewLabels: Record<string, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }
    if (parts.length === 2 && viewLabels[parts[0]]) {
      const dateStr = formatDateLabel(parts[1])
      return { label: 'Timeline', detail: `${viewLabels[parts[0]]}${dateStr ? ' · ' + dateStr : ''}` }
    }
    if (parts.length === 1) {
      const dateStr = formatDateLabel(parts[0])
      return { label: 'Timeline', detail: dateStr ?? parts[0] }
    }
    return { label: 'Timeline', detail: null }
  }
  // Settings + sections
  if (pathname === '/settings') {
    const section = searchParams.get('section')
    if (section) return { label: 'Settings', detail: section.charAt(0).toUpperCase() + section.slice(1) }
    return { label: 'Settings', detail: null }
  }
  // Simple pages
  if (pathname === '/people') return { label: 'People', detail: null }
  if (pathname === '/system') return { label: 'System', detail: null }
  if (pathname === '/agents') return { label: 'Agents', detail: null }
  if (pathname === '/chat') return { label: 'Chat', detail: null }
  return null
}

function formatDateLabel(dateStr: string): string | null {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    if (isNaN(d.getTime())) return null
    return format(d, 'MMM d')
  } catch { return null }
}

// ── Context-aware suggestions ──

function getSuggestions(pathname: string): Suggestion[] {
  if (pathname === '/work' || pathname.startsWith('/work')) {
    return [
      { icon: <ListTodo className="w-3.5 h-3.5" />, label: 'What should I work on next?', prompt: 'What should I work on next?' },
      { icon: <Zap className="w-3.5 h-3.5" />, label: 'Add a task', prompt: 'Add a task: ' },
      { icon: <FileText className="w-3.5 h-3.5" />, label: 'Summarize my progress', prompt: 'Summarize my progress on current tasks' },
    ]
  }
  if (pathname.startsWith('/vault')) {
    return [
      { icon: <Search className="w-3.5 h-3.5" />, label: 'Search the vault', prompt: 'Search the vault for ' },
      { icon: <BookOpen className="w-3.5 h-3.5" />, label: 'What did I write about recently?', prompt: 'What are my most recent vault entries about?' },
      { icon: <FileText className="w-3.5 h-3.5" />, label: 'Summarize a document', prompt: 'Summarize the document about ' },
    ]
  }
  if (pathname === '/people' || pathname.startsWith('/people')) {
    return [
      { icon: <Users className="w-3.5 h-3.5" />, label: 'Who did I last talk to?', prompt: 'Who did I communicate with most recently?' },
      { icon: <Search className="w-3.5 h-3.5" />, label: 'Find a contact', prompt: 'Find contact ' },
    ]
  }
  if (pathname === '/system' || pathname.startsWith('/system')) {
    return [
      { icon: <Activity className="w-3.5 h-3.5" />, label: 'System health check', prompt: 'How is the system doing? Run a health check.' },
      { icon: <Search className="w-3.5 h-3.5" />, label: 'Check service status', prompt: 'What services are running?' },
    ]
  }
  if (pathname === '/timeline' || pathname.startsWith('/timeline')) {
    return [
      { icon: <CalendarDays className="w-3.5 h-3.5" />, label: 'What happened today?', prompt: 'Give me a summary of today' },
      { icon: <FileText className="w-3.5 h-3.5" />, label: 'Review this week', prompt: 'Give me a weekly review' },
    ]
  }
  return [
    { icon: <ListTodo className="w-3.5 h-3.5" />, label: 'What should I work on?', prompt: 'What should I work on next?' },
    { icon: <Search className="w-3.5 h-3.5" />, label: 'Find something in the vault', prompt: 'Search the vault for ' },
    { icon: <FileText className="w-3.5 h-3.5" />, label: 'Summarize today', prompt: 'Give me a summary of today' },
    { icon: <Zap className="w-3.5 h-3.5" />, label: 'Quick task', prompt: 'Add a task: ' },
  ]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FloatingAgent() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState<AgentPhase>('orb')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = useMemo(() => getSuggestions(location.pathname), [location.pathname])
  const pageCtx = useMemo(() => getPageContext(location.pathname, searchParams), [location.pathname, searchParams])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, thinking])

  useEffect(() => {
    if (phase === 'panel') setTimeout(() => inputRef.current?.focus(), 220)
  }, [phase])

  useEffect(() => {
    if (phase !== 'panel') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPhase('orb') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  const togglePanel = useCallback(() => setPhase(p => p === 'orb' ? 'panel' : 'orb'), [])

  const sendText = useCallback((text: string) => {
    if (!text.trim()) return
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: text.trim(), ts: Date.now() }])
    setInput('')
    setThinking(true)
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setTimeout(() => {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: `I heard: "${text.trim()}". Backend wiring coming soon.`, ts: Date.now() }])
      setThinking(false)
    }, 1200)
  }, [])

  const handleSend = useCallback(() => sendText(input), [input, sendText])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handleSuggestion = useCallback((s: Suggestion) => {
    if (s.prompt.endsWith(' ')) { setInput(s.prompt); inputRef.current?.focus() }
    else sendText(s.prompt)
  }, [sendText])

  const handleNewChat = useCallback(() => { setMessages([]); setThinking(false); setInput('') }, [])
  const handleFullscreen = useCallback(() => { setPhase('orb'); navigate('/chat') }, [navigate])
  const toggleMic = useCallback(() => setListening(l => !l), [])

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  const hasMessages = messages.length > 0 || thinking

  // Don't show on Companion page
  if (location.pathname === '/') return null

  // Context label for header
  const contextLabel = pageCtx
    ? pageCtx.detail
      ? `${pageCtx.label} · ${pageCtx.detail}`
      : pageCtx.label
    : null

  return (
    <>
      {/* ── Orb — ElevenLabs WebGL orb with warm AOS colors ── */}
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Open agent"
        className={`
          fixed bottom-6 right-6 z-[280]
          w-12 h-12 rounded-full overflow-hidden
          cursor-pointer
          transition-all duration-[220ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]
          hover:scale-[1.15]
          ${phase === 'panel'
            ? 'scale-0 opacity-0 pointer-events-none'
            : 'scale-100 opacity-100'
          }
        `}
      >
        <AgentOrb
          colors={["#E8842A", "#D9730D"]}
          agentState={listening ? 'listening' : null}
          seed={42}
          className="absolute inset-0"
        />
      </button>

      {/* ── Panel ── */}
      <div
        className={`
          fixed bottom-6 right-6 z-[280]
          w-[360px] max-w-[calc(100vw-48px)]
          flex flex-col
          rounded-[16px]
          overflow-hidden
          transition-all duration-[220ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]
          ${phase === 'panel'
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-[0.92] translate-y-3 pointer-events-none'
          }
        `}
        style={{
          height: 'min(480px, calc(100dvh - 80px))',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 16px 56px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,245,235,0.03)',
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-[rgba(255,245,235,0.05)]">
          <div className="flex items-center gap-1.5">
            <div className="w-[6px] h-[6px] rounded-full bg-accent animate-pulse" />
            <span className="text-[11px] font-[530] text-text-secondary tracking-[-0.01em]">
              Qareen
            </span>
            {contextLabel && (
              <>
                <span className="text-[10px] text-text-quaternary">·</span>
                <span className="text-[10px] font-[450] text-text-quaternary">{contextLabel}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={handleNewChat} className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="New conversation">
              <Plus className="w-3 h-3" />
            </button>
            <button type="button" className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="Open in sidebar">
              <PanelRight className="w-3 h-3" />
            </button>
            <button type="button" onClick={handleFullscreen} className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="Open full screen">
              <Maximize2 className="w-3 h-3" />
            </button>
            <button type="button" onClick={togglePanel} className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="Minimize">
              <Minus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 min-h-0">
          {!hasMessages ? (
            <div className="flex flex-col pt-5 pb-2">
              <p className="text-[14px] font-[530] text-text tracking-[-0.01em] mb-0.5">
                What can I help with?
              </p>
              <p className="text-[11px] text-text-quaternary leading-[1.4] mb-4">
                {pageCtx
                  ? `You're on ${contextLabel}. Try one of these:`
                  : 'Ask anything, or try one of these:'
                }
              </p>
              <div className="space-y-1">
                {suggestions.map(s => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handleSuggestion(s)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-left cursor-pointer border border-[rgba(255,245,235,0.06)] bg-[rgba(255,245,235,0.02)] hover:bg-[rgba(255,245,235,0.05)] hover:border-[rgba(255,245,235,0.10)] transition-all group"
                    style={{ transitionDuration: 'var(--duration-instant)' }}
                  >
                    <span className="text-text-quaternary group-hover:text-text-tertiary transition-colors" style={{ transitionDuration: 'var(--duration-instant)' }}>{s.icon}</span>
                    <span className="text-[12px] font-[450] text-text-tertiary group-hover:text-text-secondary transition-colors" style={{ transitionDuration: 'var(--duration-instant)' }}>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2 py-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3 py-1.5 rounded-[12px] text-[12px] font-[440] leading-[1.55] ${msg.role === 'user' ? 'bg-[rgba(255,245,235,0.08)] text-text border border-[rgba(255,245,235,0.06)]' : 'text-text-secondary font-serif text-[13px]'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-quaternary" style={{ animation: 'agent-dot 1.4s ease-in-out infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-quaternary" style={{ animation: 'agent-dot 1.4s ease-in-out 0.2s infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-quaternary" style={{ animation: 'agent-dot 1.4s ease-in-out 0.4s infinite' }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div className="shrink-0 px-2.5 pb-2.5 pt-0.5">
          <div
            className="rounded-[10px] px-2.5 pt-2 pb-1 border border-[rgba(255,245,235,0.07)] bg-[rgba(21,18,16,0.45)] focus-within:border-[rgba(217,115,13,0.18)] transition-colors"
            style={{ transitionDuration: 'var(--duration-fast)' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); resizeTextarea() }}
              onKeyDown={handleKeyDown}
              placeholder="Do anything with AI..."
              rows={1}
              className="w-full bg-transparent text-[12px] font-[440] text-text placeholder:text-text-quaternary outline-none resize-none leading-[1.5] max-h-[100px]"
            />
            <div className="flex items-center justify-between mt-1 -mx-0.5">
              <div className="flex items-center gap-0.5">
                <button type="button" className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="Add context">
                  <Plus className="w-3 h-3" />
                </button>
                <button type="button" className="w-6 h-6 rounded-[4px] flex items-center justify-center text-text-quaternary hover:text-text-tertiary hover:bg-hover transition-colors cursor-pointer" style={{ transitionDuration: 'var(--duration-instant)' }} title="Options">
                  <SlidersHorizontal className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-0.5">
                <span className="text-[10px] font-[500] text-text-quaternary px-1">Auto</span>
                <button type="button" onClick={toggleMic} className={`w-6 h-6 rounded-[4px] flex items-center justify-center shrink-0 transition-all cursor-pointer ${listening ? 'bg-accent/15 text-accent' : 'text-text-quaternary hover:text-text-tertiary hover:bg-hover'}`} style={{ transitionDuration: 'var(--duration-instant)' }} title={listening ? 'Stop listening' : 'Voice input'}>
                  {listening ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                </button>
                <button type="button" onClick={handleSend} disabled={!input.trim()} className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${input.trim() ? 'bg-accent text-bg cursor-pointer hover:bg-accent-hover' : 'text-text-quaternary cursor-default opacity-20'}`} style={{ transitionDuration: 'var(--duration-instant)' }}>
                  <Send className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes agent-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}
