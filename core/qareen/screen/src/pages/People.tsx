import { useState, useMemo } from 'react';
import {
  Search, Users, X, MessageCircle, Phone, Mail, Hash, AtSign,
  Star, Building2, ArrowUpRight,
  MessageSquare, ListTodo, Bell, TrendingUp, TrendingDown, Minus,
  Cake, Handshake, Link2, Download, Check, Loader2, Smartphone, Globe,
  Send, AlertTriangle, Play, Wifi, WifiOff, ChevronDown, ChevronUp,
  RefreshCw, Wrench,
} from 'lucide-react';
import { usePeople, usePerson, usePersonSurfaces, useContactSources, useImportContacts, usePersonMessages, useSendMessage, usePeopleHealth, useRunPipeline } from '@/hooks/usePeople';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Tag, type TagColor } from '@/components/primitives/Tag';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { Skeleton, SkeletonRows } from '@/components/primitives/Skeleton';
import { ErrorBanner } from '@/components/primitives/ErrorBanner';
import type { PersonResponse, PersonSurfaceItem, InteractionSchema, RelationshipSchema, ContactSourceInfo, ChannelMessage, ChannelPresence, HealthIssue, PipelineStatus, ChannelHealth as ChannelHealthType } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string | undefined | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function recencyColor(iso: string | undefined | null): 'green' | 'yellow' | 'orange' | 'gray' {
  if (!iso) return 'gray';
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 3) return 'green';
  if (days < 14) return 'yellow';
  if (days < 60) return 'orange';
  return 'gray';
}

function channelIcon(channel: string) {
  const c = channel.toLowerCase();
  if (c === 'whatsapp' || c === 'telegram' || c === 'sms') return <MessageCircle className="w-3 h-3" />;
  if (c === 'phone' || c === 'call') return <Phone className="w-3 h-3" />;
  if (c === 'email') return <Mail className="w-3 h-3" />;
  if (c === 'slack') return <Hash className="w-3 h-3" />;
  return <AtSign className="w-3 h-3" />;
}

const RECENCY_BG: Record<string, string> = {
  green: 'bg-green',
  yellow: 'bg-yellow',
  orange: 'bg-orange',
  gray: 'bg-text-quaternary',
};

const CHANNEL_DOT_BG: Record<string, string> = {
  green: 'bg-green',
  blue: 'bg-blue',
  purple: 'bg-purple',
  teal: 'bg-teal',
  orange: 'bg-orange',
  yellow: 'bg-yellow',
  gray: 'bg-text-quaternary',
};

const channelTagColor: Record<string, TagColor> = {
  whatsapp: 'green',
  telegram: 'blue',
  email: 'purple',
  slack: 'teal',
  sms: 'orange',
  phone: 'yellow',
  imessage: 'blue',
};

function trendIcon(trend: string | undefined) {
  if (trend === 'growing') return <TrendingUp className="w-3 h-3" />;
  if (trend === 'drifting') return <TrendingDown className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

function trendColor(trend: string | undefined): TagColor {
  if (trend === 'growing') return 'green';
  if (trend === 'drifting') return 'orange';
  return 'gray';
}

function importanceLabel(imp: number): string {
  if (imp === 1) return 'Inner circle';
  if (imp === 2) return 'Key';
  if (imp === 3) return 'Regular';
  return 'Acquaintance';
}

function Initials({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const letters = clean.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const dims = size === 'lg' ? 'w-14 h-14 text-[18px]' : size === 'md' ? 'w-10 h-10 text-[14px]' : 'w-8 h-8 text-[12px]';
  return (
    <div className={`${dims} rounded-full bg-bg-tertiary border border-border-secondary flex items-center justify-center font-[590] text-text-tertiary shrink-0 transition-colors`} style={{ transitionDuration: 'var(--duration-instant)' }}>
      {letters || '?'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person Row — compact, reusable across Now + Directory
// ---------------------------------------------------------------------------

function PersonRow({ person, active, onClick, reason }: { person: PersonResponse; active: boolean; onClick: () => void; reason?: string }) {
  const recency = recencyColor(person.last_contact);
  const channels = person.channels ? Object.keys(person.channels) : [];

  return (
    <button
      onClick={onClick}
      className={`
        group w-full text-left flex items-center gap-3.5 px-3.5 py-3
        bg-transparent rounded-[7px] transition-all cursor-pointer
        ${active ? 'bg-selected' : 'hover:bg-hover'}
      `}
      style={{ transitionDuration: 'var(--duration-instant)' }}
    >
      <div className="relative shrink-0">
        <Initials name={person.name} size="sm" />
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg ${RECENCY_BG[recency]}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-[510] text-text-secondary truncate group-hover:text-text transition-colors" style={{ transitionDuration: 'var(--duration-instant)' }}>
            {person.name}
          </span>
          {person.importance <= 2 && <Star className="w-3 h-3 text-accent shrink-0" />}
          {person.relationship_trend && (
            <Tag label={person.relationship_trend} color={trendColor(person.relationship_trend)} size="sm" icon={trendIcon(person.relationship_trend)} />
          )}
        </div>
        {reason ? (
          <p className="text-[12px] text-text-tertiary truncate leading-[1.5]">{reason}</p>
        ) : (person.organization || person.role) ? (
          <p className="text-[12px] text-text-quaternary truncate leading-[1.5]">
            {[person.role, person.organization].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3.5 shrink-0">
        {channels.length > 0 && (
          <div className="flex items-center gap-1">
            {channels.slice(0, 3).map(ch => (
              <span key={ch} className="text-text-quaternary">{channelIcon(ch)}</span>
            ))}
          </div>
        )}
        <span className="text-[10px] text-text-quaternary tabular-nums">{timeAgo(person.last_contact)}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Person Detail Panel — the dossier (slide-over)
// ---------------------------------------------------------------------------

function PersonDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: person, isLoading } = usePerson(id);
  const { data: msgData } = usePersonMessages(id);
  const sendMutation = useSendMessage();
  const [showCompose, setShowCompose] = useState(false);
  const [composeChannel, setComposeChannel] = useState<string>('');
  const [composeText, setComposeText] = useState('');
  const [detailTab, setDetailTab] = useState<'messages' | 'info'>('messages');

  if (isLoading || !person) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <SkeletonRows count={6} />
      </div>
    );
  }

  const channels = person.channels ? Object.entries(person.channels) : [];
  const recency = recencyColor(person.last_contact);
  const presence = person.presence ?? msgData?.presence ?? [];
  const messages = msgData?.messages ?? [];

  const handleSend = async () => {
    if (!composeText.trim() || !composeChannel) return;
    await sendMutation.mutateAsync({ personId: id, channel: composeChannel, text: composeText });
    setComposeText('');
    setShowCompose(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-4">
            <div className="relative">
              <Initials name={person.name} size="lg" />
              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-panel ${RECENCY_BG[recency]}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[22px] font-[600] text-text tracking-[-0.015em] leading-tight">{person.name}</h2>
                {person.importance <= 2 && <Star className="w-4 h-4 text-accent" />}
              </div>
              {(person.organization || person.role) && (
                <p className="text-[12px] text-text-secondary mt-1 flex items-center gap-1.5">
                  {person.role && <span>{person.role}</span>}
                  {person.role && person.organization && <span className="text-text-quaternary">at</span>}
                  {person.organization && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-text-quaternary" />
                      {person.organization}
                    </span>
                  )}
                </p>
              )}
              {person.relationship_trend && person.importance <= 3 ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <Tag label={person.relationship_trend} color={trendColor(person.relationship_trend)} size="sm" icon={trendIcon(person.relationship_trend)} />
                  <span className="text-[10px] text-text-quaternary">{timeAgo(person.last_contact)}</span>
                </div>
              ) : person.last_contact ? (
                <span className="text-[10px] text-text-quaternary mt-1.5 block">{timeAgo(person.last_contact)}</span>
              ) : null}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-sm hover:bg-hover text-text-tertiary cursor-pointer transition-colors" style={{ transitionDuration: 'var(--duration-instant)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Channel presence */}
        {presence.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            {presence.map((p: ChannelPresence) => {
              const color = channelTagColor[p.channel] || 'gray';
              const dotBg = CHANNEL_DOT_BG[color] || 'bg-text-quaternary';
              return (
                <div key={p.channel} className="flex items-center gap-1.5 px-2 py-1 rounded-[5px] bg-bg-secondary/50 border border-border">
                  <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />
                  <span className="text-[10px] text-text-tertiary capitalize">{p.channel}</span>
                  <span className="text-[10px] text-text-quaternary tabular-nums">{timeAgo(p.last_message_at)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions + tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowCompose(!showCompose);
                if (!composeChannel && channels.length > 0) setComposeChannel(channels[0][0]);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border text-[11px] font-[510] transition-colors cursor-pointer ${
                showCompose
                  ? 'bg-accent text-bg border-accent'
                  : 'bg-bg-secondary border-border-secondary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary'
              }`}
              style={{ transitionDuration: 'var(--duration-instant)' }}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Message
            </button>
            {[
              { icon: <ListTodo className="w-3.5 h-3.5" />, label: 'Task' },
              { icon: <Bell className="w-3.5 h-3.5" />, label: 'Remind' },
            ].map(action => (
              <button
                key={action.label}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-bg-secondary border border-border-secondary text-[11px] font-[510] text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
                style={{ transitionDuration: 'var(--duration-instant)' }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDetailTab('messages')} className={`px-2 py-1 rounded-[3px] text-[10px] font-[510] transition-colors cursor-pointer ${detailTab === 'messages' ? 'bg-bg-tertiary text-text-secondary' : 'text-text-quaternary hover:text-text-tertiary'}`} style={{ transitionDuration: 'var(--duration-instant)' }}>Messages</button>
            <button onClick={() => setDetailTab('info')} className={`px-2 py-1 rounded-[3px] text-[10px] font-[510] transition-colors cursor-pointer ${detailTab === 'info' ? 'bg-bg-tertiary text-text-secondary' : 'text-text-quaternary hover:text-text-tertiary'}`} style={{ transitionDuration: 'var(--duration-instant)' }}>Info</button>
          </div>
        </div>
      </div>

      {/* Compose bar */}
      {showCompose && (
        <div className="shrink-0 px-6 py-3 border-b border-border bg-bg-secondary/50">
          <div className="flex items-center gap-2 mb-2">
            {channels.map(([ch]) => (
              <button
                key={ch}
                onClick={() => setComposeChannel(ch)}
                className={`px-2 py-0.5 rounded-[3px] text-[10px] font-[510] capitalize transition-colors cursor-pointer ${composeChannel === ch ? 'bg-accent text-bg' : 'bg-bg-tertiary text-text-tertiary hover:text-text-secondary'}`}
                style={{ transitionDuration: 'var(--duration-instant)' }}
              >
                {ch}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={`Message via ${composeChannel}...`}
              className="flex-1 bg-bg-secondary border border-border-secondary rounded-[5px] px-3 py-2 text-[13px] text-text placeholder:text-text-quaternary outline-none focus:border-border-tertiary transition-colors"
              style={{ transitionDuration: 'var(--duration-fast)' }}
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={!composeText.trim() || sendMutation.isPending}
              className="flex items-center justify-center w-8 h-8 rounded-[5px] bg-accent text-bg hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
              style={{ transitionDuration: 'var(--duration-instant)' }}
            >
              {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {sendMutation.isError && <p className="text-[11px] text-red mt-1">Failed to send. Try again.</p>}
          {sendMutation.isSuccess && sendMutation.data?.success && <p className="text-[11px] text-green mt-1">Sent.</p>}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {detailTab === 'messages' ? (
          <div className="px-6 py-4">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="w-8 h-8 text-text-quaternary mx-auto mb-3" />
                <p className="text-[13px] text-text-tertiary">No messages with {person.name} yet</p>
                <p className="text-[11px] text-text-quaternary mt-1">Messages will appear as you communicate across channels.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg: ChannelMessage) => {
                  const color = channelTagColor[msg.channel?.toLowerCase()] || 'gray';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col py-2.5 px-3 rounded-[5px] transition-colors hover:bg-hover ${msg.from_me ? 'items-end' : 'items-start'}`}
                      style={{ transitionDuration: 'var(--duration-instant)' }}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        {!msg.from_me && <span className="text-[10px] font-[510] text-text-tertiary">{msg.sender}</span>}
                        {msg.from_me && <span className="text-[10px] font-[510] text-accent">you</span>}
                        <Tag label={msg.channel} color={color} size="sm" />
                        <span className="text-[10px] text-text-quaternary tabular-nums">{timeAgo(msg.timestamp)}</span>
                      </div>
                      <div className={`max-w-[85%] px-3 py-2 rounded-[7px] ${msg.from_me ? 'bg-accent-subtle' : 'bg-bg-secondary border border-border'}`}>
                        {msg.text ? (
                          <p className="text-[13px] text-text-secondary leading-[1.6] break-words">{msg.text}</p>
                        ) : (
                          <p className="text-[11px] text-text-quaternary italic">{msg.media_type || 'media'}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {channels.length > 0 && (
              <div>
                <SectionHeader label="Channels" />
                <div className="space-y-1.5">
                  {channels.map(([ch, val]) => {
                    const color = channelTagColor[ch.toLowerCase()] || 'gray';
                    return (
                      <div key={ch} className="flex items-center gap-3 py-2 px-3 rounded-[5px] bg-bg-secondary/50 border border-border transition-colors hover:bg-bg-secondary cursor-default" style={{ transitionDuration: 'var(--duration-instant)' }}>
                        <span className="text-text-quaternary">{channelIcon(ch)}</span>
                        <Tag label={ch} color={color} size="sm" />
                        <span className="text-[12px] text-text-tertiary font-mono truncate max-w-[180px] flex-1 text-right">{val}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {person.relationships && person.relationships.length > 0 && (
              <div>
                <SectionHeader label="Relationships" count={person.relationships.length} />
                <div className="space-y-1.5">
                  {person.relationships.map((rel: RelationshipSchema, i: number) => (
                    <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-[5px] bg-bg-secondary/50 border border-border">
                      <Link2 className="w-3 h-3 text-text-quaternary shrink-0" />
                      <Tag label={rel.link_type} color="purple" size="sm" />
                      <span className="text-[12px] text-text-secondary truncate">{rel.target_name || rel.target_id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {person.tags && person.tags.length > 0 && (
              <div>
                <SectionHeader label="Tags" />
                <div className="flex flex-wrap gap-1.5">
                  {person.tags.map(t => <Tag key={t} label={t} color="gray" />)}
                </div>
              </div>
            )}

            {person.notes && (
              <div>
                <SectionHeader label="Notes" />
                <p className="text-[13px] text-text-tertiary leading-[1.7]">{person.notes}</p>
              </div>
            )}

            {(person.birthday || person.how_met) && (
              <div>
                <SectionHeader label="Details" />
                <div className="space-y-2">
                  {person.birthday && (
                    <div className="flex items-center gap-2 text-[12px]">
                      <Cake className="w-3.5 h-3.5 text-text-quaternary" />
                      <span className="text-text-tertiary">Birthday:</span>
                      <span className="text-text-secondary">{person.birthday}</span>
                    </div>
                  )}
                  {person.how_met && (
                    <div className="flex items-center gap-2 text-[12px]">
                      <Handshake className="w-3.5 h-3.5 text-text-quaternary" />
                      <span className="text-text-tertiary">Met via:</span>
                      <span className="text-text-secondary">{person.how_met}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[12px]">
                    <Star className="w-3.5 h-3.5 text-text-quaternary" />
                    <span className="text-text-tertiary">Importance:</span>
                    <span className="text-text-secondary">{importanceLabel(person.importance)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Now Tab — relationship pulse
// ---------------------------------------------------------------------------

function NowTab({ people, surfaces, surfacesLoading, onSelect, selectedId }: {
  people: PersonResponse[];
  surfaces: PersonSurfaceItem[];
  surfacesLoading: boolean;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  // Derive sections from data
  const drifting = useMemo(() =>
    people.filter(p => p.importance <= 2 && (p.relationship_trend === 'drifting' || p.relationship_trend === 'dormant')),
    [people]
  );

  const growing = useMemo(() =>
    people.filter(p => p.relationship_trend === 'growing').slice(0, 6),
    [people]
  );

  const recentlyActive = useMemo(() =>
    [...people]
      .filter(p => p.last_contact)
      .sort((a, b) => new Date(b.last_contact!).getTime() - new Date(a.last_contact!).getTime())
      .slice(0, 8),
    [people]
  );

  const hasSurfaces = surfaces.length > 0;
  const hasDrifting = drifting.length > 0;
  const hasGrowing = growing.length > 0;
  const hasRecent = recentlyActive.length > 0;
  const isEmpty = !hasSurfaces && !hasDrifting && !hasGrowing && !hasRecent;

  if (surfacesLoading) return <SkeletonRows count={6} />;

  if (isEmpty) {
    return (
      <EmptyState
        icon={<Users />}
        title="Your relationship pulse will appear here"
        description="As you communicate across channels, the qareen tracks who matters and what needs attention."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Needs attention — surfaced people + drifting inner circle */}
      {(hasSurfaces || hasDrifting) && (
        <div>
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-3 px-1">
            Needs attention
          </h2>
          <div className="space-y-1">
            {surfaces.map((item, i) => (
              <PersonRow
                key={`s-${i}`}
                person={item.person}
                active={selectedId === item.person.id}
                onClick={() => onSelect(item.person.id)}
                reason={item.suggested_action || item.reason}
              />
            ))}
            {/* Drifting people not already in surfaces */}
            {drifting
              .filter(p => !surfaces.some(s => s.person.id === p.id))
              .map(p => (
                <PersonRow
                  key={p.id}
                  person={p}
                  active={selectedId === p.id}
                  onClick={() => onSelect(p.id)}
                  reason={`${importanceLabel(p.importance)} · drifting · last contact ${timeAgo(p.last_contact)}`}
                />
              ))}
          </div>
        </div>
      )}

      {/* Growing connections */}
      {hasGrowing && (
        <div>
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-3 px-1">
            Growing
          </h2>
          <div className="space-y-1">
            {growing.map(p => (
              <PersonRow
                key={p.id}
                person={p}
                active={selectedId === p.id}
                onClick={() => onSelect(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {hasRecent && (
        <div>
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-3 px-1">
            Recent
          </h2>
          <div className="space-y-1">
            {recentlyActive.map(p => (
              <PersonRow
                key={p.id}
                person={p}
                active={selectedId === p.id}
                onClick={() => onSelect(p.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory Tab — compact lookup grouped by tier
// ---------------------------------------------------------------------------

function DirectoryTab({ people, isLoading, searchQuery, setSearchQuery, onSelect, selectedId }: {
  people: PersonResponse[];
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const grouped = useMemo(() => {
    const tiers: Record<string, PersonResponse[]> = {
      'Inner circle': [],
      'Key': [],
      'Regular': [],
      'Acquaintance': [],
    };
    for (const p of people) {
      const label = importanceLabel(p.importance);
      (tiers[label] ??= []).push(p);
    }
    // Sort each tier by last_contact descending
    for (const arr of Object.values(tiers)) {
      arr.sort((a, b) => {
        if (!a.last_contact) return 1;
        if (!b.last_contact) return -1;
        return new Date(b.last_contact).getTime() - new Date(a.last_contact).getTime();
      });
    }
    return Object.entries(tiers).filter(([, arr]) => arr.length > 0);
  }, [people]);

  return (
    <div>
      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-quaternary" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search people..."
          className="w-full h-8 pl-8 pr-3 bg-bg-secondary border border-border rounded-sm text-[12px] text-text placeholder:text-text-quaternary focus:border-accent/40 focus:outline-none transition-colors"
          style={{ transitionDuration: 'var(--duration-fast)' }}
          autoFocus
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-xs hover:bg-hover transition-colors cursor-pointer"
            style={{ transitionDuration: 'var(--duration-instant)' }}
          >
            <X className="w-3 h-3 text-text-quaternary" />
          </button>
        )}
      </div>

      {isLoading ? (
        <SkeletonRows count={8} />
      ) : people.length === 0 && searchQuery ? (
        <EmptyState
          icon={<Search />}
          title="No one matched"
          description="Try a different name, tag, or organization."
        />
      ) : people.length === 0 ? (
        <ContactOnboarding />
      ) : (
        <div className="space-y-6">
          {grouped.map(([tier, persons]) => (
            <div key={tier}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">{tier}</h2>
                <span className="text-[10px] text-text-quaternary tabular-nums">{persons.length}</span>
              </div>
              <div className="space-y-px">
                {persons.map(p => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    active={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maintain Tab — data hygiene task queue
// ---------------------------------------------------------------------------

function MaintainTab({ people, onSelect, selectedId }: {
  people: PersonResponse[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const { data: health } = usePeopleHealth();
  const runPipeline = useRunPipeline();
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRun = async (pipelineId: string) => {
    setRunningId(pipelineId);
    try { await runPipeline.mutateAsync(pipelineId); } finally { setRunningId(null); }
  };

  // Enrichment queue: contacts missing org, role, or tags
  const needsEnrichment = useMemo(() =>
    people.filter(p => !p.organization && !p.role && p.tags.length === 0).slice(0, 20),
    [people]
  );

  // Tier review: people with high interaction but low importance
  const tierReview = useMemo(() =>
    people.filter(p =>
      p.importance >= 3 &&
      p.relationship_trend === 'growing' &&
      p.last_contact &&
      (Date.now() - new Date(p.last_contact).getTime()) < 30 * 86400000
    ).slice(0, 10),
    [people]
  );

  const totalContacts = people.length;
  const enriched = people.filter(p => p.organization || p.role || p.tags.length > 0).length;
  const enrichPct = totalContacts > 0 ? Math.round((enriched / totalContacts) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Enrichment progress */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">Enrichment</h2>
          <span className="text-[11px] text-text-quaternary tabular-nums">{enriched}/{totalContacts} contacts detailed</span>
        </div>
        <div className="h-1.5 bg-bg-quaternary rounded-full overflow-hidden mb-4">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${enrichPct}%`, transitionDuration: 'var(--duration-normal)' }} />
        </div>
        {needsEnrichment.length > 0 ? (
          <div className="space-y-1">
            {needsEnrichment.map(p => (
              <PersonRow
                key={p.id}
                person={p}
                active={selectedId === p.id}
                onClick={() => onSelect(p.id)}
                reason="Missing organization, role, and tags"
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-text-tertiary px-1">All contacts have basic details filled in.</p>
        )}
      </div>

      {/* Tier review */}
      {tierReview.length > 0 && (
        <div>
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-3 px-1">
            Review importance
          </h2>
          <p className="text-[12px] text-text-tertiary mb-3 px-1">
            These contacts are growing but classified lower than their activity suggests.
          </p>
          <div className="space-y-1">
            {tierReview.map(p => (
              <PersonRow
                key={p.id}
                person={p}
                active={selectedId === p.id}
                onClick={() => onSelect(p.id)}
                reason={`Classified as ${importanceLabel(p.importance)} but trending up`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pipeline health */}
      {health && (
        <div>
          <h2 className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-3 px-1">
            Pipelines & channels
          </h2>

          {health.issues.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {health.issues.map((issue: HealthIssue, i: number) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2 rounded-[5px] bg-bg-secondary/50 border border-border">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${issue.severity === 'error' ? 'bg-red' : 'bg-yellow'}`} />
                  <span className="text-[11px] text-text-tertiary flex-1">{issue.message}</span>
                  {issue.action_id && (
                    <button
                      onClick={() => handleRun(issue.action_id!)}
                      disabled={runningId === issue.action_id}
                      className="flex items-center gap-1 px-2 py-1 rounded-[3px] bg-bg-tertiary text-[10px] font-[510] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
                      style={{ transitionDuration: 'var(--duration-instant)' }}
                    >
                      {runningId === issue.action_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 px-3.5 py-2.5 rounded-[5px] bg-bg-secondary/50 border border-border">
            <div className="flex items-center gap-2">
              {health.channels.map((ch: ChannelHealthType) => (
                <div key={ch.channel} className="flex items-center gap-1">
                  {ch.connected ? <Wifi className="w-3 h-3 text-green" /> : <WifiOff className="w-3 h-3 text-text-quaternary" />}
                  <span className={`text-[10px] capitalize ${ch.connected ? 'text-text-tertiary' : 'text-text-quaternary'}`}>{ch.channel}</span>
                </div>
              ))}
            </div>
            <span className="w-px h-3 bg-border-secondary" />
            <div className="flex items-center gap-2 flex-1">
              {health.pipelines.map((p: PipelineStatus) => (
                <div key={p.name} className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${p.stale ? 'bg-yellow' : 'bg-green'}`} />
                  <span className="text-[10px] text-text-quaternary capitalize">{p.name}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { handleRun('extraction'); handleRun('patterns'); }}
              disabled={!!runningId}
              className="flex items-center gap-1 px-2 py-1 rounded-[3px] bg-bg-tertiary text-[10px] font-[510] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
              style={{ transitionDuration: 'var(--duration-instant)' }}
            >
              <RefreshCw className={`w-3 h-3 ${runningId ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {runPipeline.isSuccess && runPipeline.data && (
            <div className="mt-2 px-3.5 py-2 rounded-[5px] bg-green-muted border border-green/20">
              <p className="text-[11px] text-green">{runPipeline.data.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact Onboarding — shown when directory is empty
// ---------------------------------------------------------------------------

function sourceIcon(type: string) {
  if (type === 'apple') return <Smartphone className="w-5 h-5" />;
  if (type === 'google') return <Globe className="w-5 h-5" />;
  if (type === 'whatsapp') return <MessageCircle className="w-5 h-5" />;
  if (type === 'telegram') return <Send className="w-5 h-5" />;
  return <Users className="w-5 h-5" />;
}

function SourceCard({ source, onImport, importing }: { source: ContactSourceInfo; onImport: () => void; importing: boolean }) {
  const isReady = source.available && source.status === 'ready';

  return (
    <div className={`
      p-5 rounded-[7px] border transition-all
      ${isReady
        ? 'bg-bg-secondary border-border-secondary hover:border-border-tertiary cursor-pointer'
        : 'bg-bg-secondary/50 border-border opacity-60 cursor-default'
      }
    `}
    style={{ transitionDuration: 'var(--duration-fast)' }}
    >
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-[7px] flex items-center justify-center shrink-0 ${isReady ? 'bg-accent-subtle text-accent' : 'bg-bg-tertiary text-text-quaternary'}`}>
          {sourceIcon(source.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-[510] text-text">{source.name}</span>
            {isReady && (
              <span className="inline-flex items-center gap-1 text-[10px] text-green font-[510]">
                <Check className="w-3 h-3" /> ready
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-tertiary mt-0.5">{source.description}</p>
          {source.estimated_count > 0 && (
            <p className="text-[11px] text-text-quaternary mt-1 tabular-nums">
              {source.estimated_count.toLocaleString()} contacts available
            </p>
          )}
        </div>
        {isReady && (
          <button
            onClick={(e) => { e.stopPropagation(); onImport(); }}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-accent text-bg text-[11px] font-[590] hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
            style={{ transitionDuration: 'var(--duration-instant)' }}
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {importing ? 'Importing...' : 'Import'}
          </button>
        )}
      </div>
    </div>
  );
}

function ContactOnboarding() {
  const { data: sources, isLoading } = useContactSources();
  const importMutation = useImportContacts();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const handleImport = async (sourceId: string) => {
    setImportingId(sourceId);
    setImportResult(null);
    try {
      const result = await importMutation.mutateAsync(sourceId);
      setImportResult(result.message);
    } catch {
      setImportResult('Import failed. Try again or import via the Companion.');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-bg-secondary border border-border-secondary flex items-center justify-center mx-auto mb-5">
            <Users className="w-7 h-7 text-accent" />
          </div>
          <h2 className="text-[24px] font-[600] text-text tracking-[-0.015em] leading-tight">
            Your people, all in one place
          </h2>
          <p className="text-[14px] text-text-tertiary leading-[1.6] mt-3 max-w-sm mx-auto">
            Qareen learns who matters to you — your conversations, your patterns, your commitments. Bring your contacts in to get started.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-[7px]" />
            <Skeleton className="h-20 w-full rounded-[7px]" />
            <Skeleton className="h-20 w-full rounded-[7px]" />
          </div>
        ) : (
          <div className="space-y-3">
            {(sources?.sources ?? []).map((source: ContactSourceInfo) => (
              <SourceCard
                key={source.id}
                source={source}
                onImport={() => handleImport(source.id)}
                importing={importingId === source.id}
              />
            ))}
          </div>
        )}

        {importResult && (
          <div className="mt-4 px-4 py-3 rounded-[5px] bg-bg-secondary border border-border-secondary">
            <p className="text-[12px] text-text-secondary leading-[1.6]">{importResult}</p>
          </div>
        )}

        <p className="text-center text-[11px] text-text-quaternary mt-6">
          Contacts also appear automatically as you message people across channels.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main People Page
// ---------------------------------------------------------------------------

type PeopleTab = 'now' | 'directory' | 'maintain';

export default function PeoplePage() {
  const [tab, setTab] = useState<PeopleTab>('now');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError } = usePeople(searchQuery || undefined);
  const { data: allData } = usePeople(); // unfiltered for Now + Maintain
  const { data: surfaceData, isLoading: surfacesLoading } = usePersonSurfaces();

  const allPeople = allData?.people ?? [];
  const filteredPeople = data?.people ?? [];
  const surfaces = surfaceData?.surfaces ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Glass pill tabs */}
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
          {([
            { id: 'now' as const, label: 'Now' },
            { id: 'directory' as const, label: 'Directory' },
            { id: 'maintain' as const, label: 'Maintain' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 h-6 rounded-full text-[12px] font-[510] cursor-pointer transition-all duration-150 ${
                tab === t.id
                  ? 'bg-[rgba(255,245,235,0.10)] text-text'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[860px] mx-auto px-6 md:px-8 pt-4 pb-8">
          {isError && <div className="mb-4"><ErrorBanner /></div>}

          {/* Show onboarding if no contacts at all */}
          {!isLoading && allPeople.length === 0 ? (
            <ContactOnboarding />
          ) : tab === 'now' ? (
            <NowTab
              people={allPeople}
              surfaces={surfaces}
              surfacesLoading={surfacesLoading || isLoading}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          ) : tab === 'directory' ? (
            <DirectoryTab
              people={filteredPeople}
              isLoading={isLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          ) : (
            <MaintainTab
              people={allPeople}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          )}
        </div>
      </div>

      {/* Detail slide-over */}
      {selectedId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
            style={{ animation: 'peopleOverlayIn 180ms var(--ease-out)' }}
          />
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[440px] bg-bg-panel border-l border-border shadow-[var(--shadow-high)]"
            style={{ animation: 'peopleSlideIn 180ms var(--ease-out)' }}
          >
            <PersonDetail id={selectedId} onClose={() => setSelectedId(null)} />
          </div>
          <style>{`
            @keyframes peopleOverlayIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes peopleSlideIn {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}
