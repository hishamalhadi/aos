import { useState, useEffect, useCallback, useRef } from 'react';
import { useChatStore } from '@/store/chat';

// ---------------------------------------------------------------------------
// Chat SSE hook — manages the single Chief stream connection.
// Messages are routed to the active session in the chat store.
// ---------------------------------------------------------------------------

const API_BASE = 'http://127.0.0.1:4098';

export interface ChatEvent {
  ts: number;
  type: string;
  text?: string;
  source?: string;
  tool_id?: string;
  name?: string;
  preview?: string;
  is_error?: boolean;
  session_id?: string;
  model?: string;
  duration_ms?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  num_turns?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  source?: string;
  ts: number;
  toolName?: string;
  toolPreview?: string;
  isError?: boolean;
  durationMs?: number;
  costUsd?: number;
}

let messageIdCounter = 0;
function nextId() { return `msg-${++messageIdCounter}`; }

export function useChatStream() {
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [toolStatus, setToolStatus] = useState('');
  const currentTextRef = useRef('');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const historyLoaded = useRef(false);

  const activeId = useChatStore(s => s.activeId);
  const pushMessage = useChatStore(s => s.pushMessage);
  const setMessages = useChatStore(s => s.setMessages);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Load history into the first session on mount (once)
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;

    fetch(`${API_BASE}/history`)
      .then(r => r.json())
      .then((events: ChatEvent[]) => {
        const msgs: ChatMessage[] = [];
        let accText = '';

        for (const e of events) {
          if (e.type === 'user_message') {
            msgs.push({
              id: nextId(), role: 'user',
              text: e.text || '', source: e.source, ts: e.ts,
            });
            accText = '';
          } else if (e.type === 'tool_start') {
            msgs.push({
              id: nextId(), role: 'tool',
              text: e.preview || `Using ${e.name}...`,
              toolName: e.name, toolPreview: e.preview, ts: e.ts,
            });
          } else if (e.type === 'text_complete') {
            accText = e.text || '';
          } else if (e.type === 'result' && !e.is_error) {
            msgs.push({
              id: nextId(), role: 'assistant',
              text: accText || e.text || '', ts: e.ts,
              durationMs: e.duration_ms, costUsd: e.cost_usd,
            });
            accText = '';
          }
        }

        // Load history into the active session only if it's empty
        const store = useChatStore.getState();
        const active = store.sessions.find(s => s.id === store.activeId);
        if (active && active.messages.length === 0 && msgs.length > 0) {
          setMessages(store.activeId, msgs);
          // Auto-name from first user message
          const firstUser = msgs.find(m => m.role === 'user');
          if (firstUser && active.name === 'New chat') {
            const text = firstUser.text.trim();
            store.renameSession(store.activeId, text.length <= 30 ? text : text.slice(0, 27) + '...');
          }
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE connection with auto-reconnect
  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`${API_BASE}/stream`);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    es.onmessage = (ev) => {
      try {
        const event: ChatEvent = JSON.parse(ev.data);
        const sid = activeIdRef.current;

        switch (event.type) {
          case 'user_message':
            pushMessage(sid, {
              id: nextId(), role: 'user',
              text: event.text || '', source: event.source, ts: event.ts,
            });
            setCurrentText('');
            currentTextRef.current = '';
            setToolStatus('');
            setStreaming(true);
            break;

          case 'text_delta':
            currentTextRef.current += (event.text || '');
            setCurrentText(currentTextRef.current);
            setToolStatus('');
            break;

          case 'text_complete':
            currentTextRef.current = event.text || currentTextRef.current;
            setCurrentText(currentTextRef.current);
            break;

          case 'tool_start':
            setToolStatus(event.preview || `Using ${event.name}...`);
            pushMessage(sid, {
              id: nextId(), role: 'tool',
              text: event.preview || `Using ${event.name}...`,
              toolName: event.name, toolPreview: event.preview, ts: event.ts,
            });
            break;

          case 'tool_result':
            if (event.is_error) {
              pushMessage(sid, {
                id: nextId(), role: 'tool',
                text: event.preview || 'Tool error',
                isError: true, ts: event.ts,
              });
            }
            break;

          case 'result':
            if (currentTextRef.current) {
              pushMessage(sid, {
                id: nextId(), role: 'assistant',
                text: currentTextRef.current, ts: event.ts,
                durationMs: event.duration_ms, costUsd: event.cost_usd,
              });
            }
            setCurrentText('');
            currentTextRef.current = '';
            setToolStatus('');
            setStreaming(false);
            break;

          case 'session_init':
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      reconnectTimer.current = setTimeout(() => connect(), 3000);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const sendMessage = useCallback(async (text: string) => {
    try {
      await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: 'centcom' }),
      });
    } catch (err) {
      console.error('Failed to send:', err);
    }
  }, []);

  const cancelGeneration = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  }, []);

  return {
    currentText,
    streaming,
    connected,
    toolStatus,
    sendMessage,
    cancelGeneration,
  };
}
