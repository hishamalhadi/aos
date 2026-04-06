/**
 * AutomationArchitect — Conversational automation designer.
 *
 * Split-screen with glass panels:
 *   Left:  Natural conversation — no rigid phases
 *   Right: Live step preview — clean vertical cards
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Sparkles, Rocket, Bot,
  History, Plus,
} from 'lucide-react';

import { Markdown } from '@/components/chat/Markdown';
import {
  useArchitectSession,
  type ArchitectMessage,
} from '@/hooks/useArchitectSession';
import { ExecutionWorkspace } from '@/components/architect/ExecutionWorkspace';
import { glassStyle } from '@/components/architect/constants';

// ── Sessions dropdown ──

interface SessionSummary {
  id: string;
  title: string;
  phase: string;
  updated_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function SessionsButton({
  currentId,
  onSelect,
  onNew,
}: {
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['architect-sessions'],
    queryFn: async (): Promise<{ sessions: SessionSummary[] }> => {
      const res = await fetch('/api/architect/sessions');
      return res.json();
    },
    staleTime: 10_000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 flex items-center justify-center rounded-full text-text-quaternary hover:text-text-tertiary transition-colors cursor-pointer"
        style={{
          background: 'rgba(30, 26, 22, 0.60)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 245, 235, 0.06)',
        }}
        title="Sessions"
      >
        <History className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="absolute top-10 right-0 w-[240px] rounded-[12px] overflow-hidden"
          style={{
            background: '#1E1A16',
            border: '1px solid rgba(255, 245, 235, 0.08)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[10px] font-[590] text-text-quaternary uppercase tracking-[0.04em]">Sessions</span>
            <button
              onClick={() => { onNew(); setOpen(false); }}
              className="flex items-center gap-1 text-[10px] font-[510] text-accent hover:text-accent-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {(data?.sessions || []).length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-text-quaternary">No sessions</div>
            ) : (
              (data?.sessions || []).map(s => (
                <button
                  key={s.id}
                  onClick={() => { onSelect(s.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer border-b border-border last:border-0 ${
                    s.id === currentId ? 'bg-accent/8' : ''
                  }`}
                >
                  <span className="text-[12px] font-[510] text-text-secondary truncate block">{s.title || 'Untitled'}</span>
                  <span className="text-[10px] text-text-quaternary">{timeAgo(s.updated_at)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Parse options and strip JSON from messages ──

function parseMessage(content: string): { text: string; options: string[] } {
  let cleaned = content.replace(/```json\s*\n[\s\S]*?```/g, '').trim();
  cleaned = cleaned.replace(/```\n[\s\S]*?```/g, '').trim();

  const lines = cleaned.split('\n');
  const textLines: string[] = [];
  const options: string[] = [];
  let inOptionBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('> ') && trimmed.length > 2 && trimmed.length < 120) {
      const clean = trimmed.slice(2).replace(/\*\*/g, '').replace(/\*/g, '').trim();
      if (clean) { options.push(clean); inOptionBlock = true; continue; }
    }
    if (inOptionBlock && trimmed === '') continue;
    if (inOptionBlock && !trimmed.startsWith('> ')) inOptionBlock = false;
    textLines.push(line);
  }

  return { text: textLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), options };
}

// ── Message bubble ──

function MessageBubble({
  message, isLast, isStreaming, statusText, onOption,
}: {
  message: ArchitectMessage;
  isLast: boolean;
  isStreaming: boolean;
  statusText?: string | null;
  onOption?: (text: string) => void;
}) {
  const isUser = message.role === 'user';
  const isEmpty = !message.content;
  const { text: displayText, options } = !isUser && message.content
    ? parseMessage(message.content) : { text: message.content, options: [] };
  const showOptions = !isUser && isLast && !isStreaming && options.length > 0;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center mr-2 mt-0.5 shrink-0">
          <Bot className="w-2.5 h-2.5 text-accent" />
        </div>
      )}
      <div className="max-w-[90%]">
        <div
          className={`rounded-[10px] ${
            isUser
              ? 'bg-accent/12 rounded-br-[3px] px-3 py-2'
              : 'bg-[rgba(30,26,22,0.6)] rounded-bl-[3px] px-3 py-2'
          }`}
        >
          {isEmpty ? (
            <div className="flex items-center gap-2.5 py-0.5">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-[11px] text-text-quaternary">{statusText || 'Thinking...'}</span>
            </div>
          ) : isUser ? (
            <span className="text-[13px] leading-[1.55] text-text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
              {message.content}
            </span>
          ) : (
            <Markdown content={displayText} />
          )}
        </div>

        {showOptions && (
          <div className="flex flex-col gap-1.5 mt-2 ml-1">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onOption?.(opt)}
                className="text-left px-3 py-2 rounded-[8px] text-[12px] font-[510] text-text-tertiary hover:text-text transition-all cursor-pointer"
                style={{
                  background: 'rgba(30, 26, 22, 0.5)',
                  border: '1px solid rgba(255, 245, 235, 0.06)',
                }}
                onMouseEnter={e => {
                  (e.target as HTMLElement).style.borderColor = 'rgba(217, 115, 13, 0.4)';
                }}
                onMouseLeave={e => {
                  (e.target as HTMLElement).style.borderColor = 'rgba(255, 245, 235, 0.06)';
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Conversation panel ──

function ConversationPanel({
  messages, isStreaming, statusText, spec,
  onSend, onBuild, isBuilding,
}: {
  messages: ArchitectMessage[];
  isStreaming: boolean;
  statusText: string | null;
  spec: any;
  onSend: (text: string) => void;
  onBuild: () => void;
  isBuilding: boolean;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll — track both message count and last message content length
  const lastMsgLen = messages.length > 0 ? messages[messages.length - 1].content.length : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages.length, lastMsgLen]);

  useEffect(() => { inputRef.current?.focus(); }, [isStreaming]);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value?.trim() || input.trim();
    if (!text || isStreaming) return;
    setInput('');
    if (inputRef.current) inputRef.current.value = '';
    onSend(text);
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mb-3">
              <Sparkles className="w-4 h-4 text-accent/60" />
            </div>
            <p className="text-[13px] text-text-tertiary font-[510] mb-1">Automation Architect</p>
            <p className="text-[11px] text-text-quaternary leading-relaxed max-w-[220px]">
              Describe what you want to automate. I'll design it, you refine it, then deploy.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              isLast={i === messages.length - 1}
              isStreaming={isStreaming}
              statusText={statusText}
              onOption={onSend}
            />
          ))
        )}
      </div>

      {/* Build & Test */}
      {spec && !isStreaming && (
        <div className="shrink-0 px-4 py-2">
          <button
            onClick={onBuild}
            disabled={isBuilding}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[10px] text-[13px] font-[560] text-white transition-colors cursor-pointer"
            style={{ background: isBuilding ? '#3A3530' : '#D9730D' }}
          >
            {isBuilding ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Building & testing...</>
            ) : (
              <><Rocket className="w-4 h-4" /> Build & Test</>
            )}
          </button>
        </div>
      )}

      {/* Input pill */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div
          className="rounded-[14px]"
          style={{
            background: 'rgba(30, 26, 22, 0.80)',
            border: '1px solid rgba(255, 245, 235, 0.08)',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.length === 0 ? 'Describe what you want to automate...' : 'Reply...'}
            rows={1}
            disabled={isStreaming}
            className="w-full resize-none bg-transparent text-[13px] text-text-secondary placeholder:text-text-quaternary focus:outline-none min-h-[36px] max-h-[100px] px-4 pt-3 pb-1"
            style={{ lineHeight: '1.5' }}
          />
          <div className="flex items-center justify-between px-3 pb-2 pt-0">
            <div />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-accent text-white disabled:opacity-20 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {isStreaming ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="10" x2="6" y2="2"/><polyline points="2,5 6,1 10,5"/></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──

function AutomationArchitectInner() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    sessionId, messages, phase, spec, flowNodes, flowEdges,
    isStreaming, statusText, sendMessage, loadSession, resetSession,
  } = useArchitectSession();

  const buildMutation = useMutation({
    mutationFn: async () => {
      if (!spec) throw new Error('No spec');

      const buildRes = await fetch('/api/flow-builder/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
      });
      if (!buildRes.ok) throw new Error('Build failed');
      const { workflows } = await buildRes.json();

      const deployRes = await fetch('/api/flow-builder/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflows,
          activate: true,
          name: spec.name,
          description: spec.objective,
        }),
      });
      if (!deployRes.ok) throw new Error('Deploy failed');
      return deployRes.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['n8n-automations'] });
      navigate('/automations');
    },
  });

  return (
    <div className="flex h-full pt-14 overflow-hidden gap-px">
      {/* Top-right: sessions */}
      <div className="fixed top-3 right-3 z-[300]">
        <SessionsButton
          currentId={sessionId}
          onSelect={loadSession}
          onNew={resetSession}
        />
      </div>

      {/* Left: Conversation */}
      <div className="w-2/5 min-w-[300px] max-w-[460px] shrink-0 h-full rounded-tr-[16px]" style={glassStyle}>
        <ConversationPanel
          messages={messages}
          isStreaming={isStreaming}
          statusText={statusText}
          spec={spec}
          onSend={sendMessage}
          onBuild={() => buildMutation.mutate()}
          isBuilding={buildMutation.isPending}
        />
      </div>

      {/* Right: Execution workspace */}
      <div className="flex-1 h-full">
        <ExecutionWorkspace />
      </div>
    </div>
  );
}

export default function AutomationArchitect() {
  return <AutomationArchitectInner />;
}
