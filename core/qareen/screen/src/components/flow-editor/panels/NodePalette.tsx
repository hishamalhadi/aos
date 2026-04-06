/**
 * NodePalette — Draggable sidebar of available node types.
 *
 * Grouped by category (Triggers, Actions, Logic).
 * Drag items onto the canvas to add nodes.
 */
import { useContext, useState } from 'react';
import {
  Clock, Send, Mail, Calendar, Sheet, Globe,
  GitBranch, Code, Edit, Zap, Webhook, Search,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { getNodeTypesByCategory, CATEGORY_META } from '../constants';
import { ConnectorContext } from '../ConnectorContext';
import { getNodeConnectionStatus, statusDotColor } from '../../../hooks/useConnectorStatus';
import type { NodeTypeDefinition } from '../types';

const ICONS: Record<string, typeof Zap> = {
  clock: Clock, send: Send, mail: Mail, calendar: Calendar, sheet: Sheet,
  globe: Globe, 'git-branch': GitBranch, code: Code, edit: Edit, zap: Zap,
  webhook: Webhook,
};

function PaletteItem({ def }: { def: NodeTypeDefinition }) {
  const Icon = ICONS[def.icon] || Zap;
  const connectorNodeTypes = useContext(ConnectorContext);
  const status = getNodeConnectionStatus(connectorNodeTypes, def.n8nType);
  const isDisconnected = status === 'available' || status === 'broken';

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow', def.n8nType);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-2.5 px-3 py-2 rounded-[7px] cursor-grab hover:bg-hover active:cursor-grabbing transition-colors"
      style={{ opacity: isDisconnected ? 0.45 : 1 }}
    >
      <div
        className="w-7 h-7 rounded-[5px] flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: def.color + '20' }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: def.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-[510] text-text-secondary block">{def.label}</span>
        <span className="text-[10px] text-text-quaternary block truncate">{def.description}</span>
      </div>
      {status !== 'always' && (
        <div
          className="w-[5px] h-[5px] rounded-full flex-shrink-0"
          style={{ backgroundColor: statusDotColor(status) }}
        />
      )}
    </div>
  );
}

function CategoryGroup({ category, defs }: { category: string; defs: NodeTypeDefinition[] }) {
  const [expanded, setExpanded] = useState(true);
  const meta = CATEGORY_META[category] || { label: category, color: '#6B6560' };
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 cursor-pointer"
      >
        <Chevron className="w-3 h-3 text-text-quaternary" />
        <span className="text-[10px] font-[590] uppercase tracking-[0.06em]" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="text-[10px] text-text-quaternary">{defs.length}</span>
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {defs.map((def) => <PaletteItem key={def.n8nType} def={def} />)}
        </div>
      )}
    </div>
  );
}

export default function NodePalette() {
  const [filter, setFilter] = useState('');
  const groups = getNodeTypesByCategory();

  const filteredGroups = Object.entries(groups).map(([cat, defs]) => ({
    category: cat,
    defs: filter
      ? defs.filter((d) => d.label.toLowerCase().includes(filter.toLowerCase()))
      : defs,
  })).filter((g) => g.defs.length > 0);

  return (
    <div className="p-2">
      {/* Search */}
      <div className="relative mb-3 px-1">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search nodes..."
          className="w-full h-7 pl-7 pr-2 rounded-[5px] bg-bg-tertiary border border-border text-[11px] text-text-secondary placeholder:text-text-quaternary focus:outline-none focus:border-accent/40"
        />
      </div>

      {/* Node categories */}
      {filteredGroups.map(({ category, defs }) => (
        <CategoryGroup key={category} category={category} defs={defs} />
      ))}

      {filteredGroups.length === 0 && (
        <p className="text-[11px] text-text-quaternary text-center py-4">No matching nodes</p>
      )}
    </div>
  );
}
