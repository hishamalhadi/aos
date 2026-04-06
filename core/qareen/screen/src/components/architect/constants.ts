/**
 * Shared icon/color maps for architect step types.
 * Extracted from AutomationArchitect.tsx for reuse across tabs.
 */
import {
  Zap, Mail, Calendar, MessageCircle, Code, GitBranch,
  Globe, Clock, Bot, Hand, Hash, Send, StickyNote,
  BookOpen, Github, FileText, Database, Sheet,
  type LucideIcon,
} from 'lucide-react';

export const STEP_ICONS: Record<string, LucideIcon> = {
  'n8n-nodes-base.gmail': Mail,
  'n8n-nodes-base.googleCalendar': Calendar,
  'n8n-nodes-base.telegram': MessageCircle,
  'n8n-nodes-base.code': Code,
  'n8n-nodes-base.if': GitBranch,
  'n8n-nodes-base.switch': GitBranch,
  'n8n-nodes-base.set': Code,
  'n8n-nodes-base.httpRequest': Globe,
  'n8n-nodes-base.scheduleTrigger': Clock,
  'n8n-nodes-base.webhook': Globe,
  'n8n-nodes-base.wait': Clock,
  'aos.agentDispatch': Bot,
  'aos.hitlApproval': Hand,
};

export function getStepIcon(type: string): LucideIcon {
  return STEP_ICONS[type] || Zap;
}

export const STEP_COLORS: Record<string, string> = {
  'n8n-nodes-base.gmail': '#EA4335',
  'n8n-nodes-base.googleCalendar': '#4285F4',
  'n8n-nodes-base.telegram': '#0088CC',
  'n8n-nodes-base.code': '#BF5AF2',
  'n8n-nodes-base.if': '#BF5AF2',
  'n8n-nodes-base.set': '#BF5AF2',
  'n8n-nodes-base.httpRequest': '#6B6560',
  'n8n-nodes-base.scheduleTrigger': '#D9730D',
  'n8n-nodes-base.webhook': '#D9730D',
  'aos.agentDispatch': '#A855F7',
  'aos.hitlApproval': '#F59E0B',
};

// ── Connector icon map (YAML icon strings → lucide components) ──

const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  mail: Mail,
  send: Send,
  hash: Hash,
  calendar: Calendar,
  'message-circle': MessageCircle,
  'sticky-note': StickyNote,
  'book-open': BookOpen,
  github: Github,
  'file-text': FileText,
  globe: Globe,
  database: Database,
  code: Code,
  clock: Clock,
  bot: Bot,
  sheet: Sheet,
};

export function getConnectorIcon(iconName: string): LucideIcon {
  return CONNECTOR_ICONS[iconName] || Zap;
}

export const glassStyle: React.CSSProperties = {
  background: 'rgba(21, 18, 16, 0.45)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
};
