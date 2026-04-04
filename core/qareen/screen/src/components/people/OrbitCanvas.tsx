/**
 * OrbitCanvas — Contact constellation visualization.
 *
 * Renders contacts as nodes in concentric rings by importance.
 * Canvas 2D for performance (1,000+ nodes). Warm dark palette from DESIGN.md.
 *
 * Node properties:
 *   - Ring: importance 1 (inner) → 4 (outer)
 *   - Size: interaction count (more = larger)
 *   - Color: relationship trend (warm = healthy, cool = drifting/dormant)
 *   - Glow: importance 1-2 get a subtle glow
 *
 * Interactions:
 *   - Click: selects person (calls onSelect)
 *   - Hover: shows tooltip with name + org
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { OrbitNode } from '@/lib/types';

// ---------------------------------------------------------------------------
// Design tokens (from DESIGN.md warm dark palette)
// ---------------------------------------------------------------------------

const COLORS = {
  bg: '#0D0B09',
  ring: 'rgba(255, 245, 235, 0.04)',
  ringLabel: 'rgba(255, 245, 235, 0.15)',
  // Node colors by trend
  growing: '#D9730D',    // accent orange — warm, active
  stable: '#9A9490',     // text-tertiary — neutral
  drifting: '#6B6560',   // text-quaternary — cool
  dormant: '#3A3530',    // bg-quaternary — very dim
  default: '#6B6560',    // fallback
  // Highlight
  selected: '#D9730D',
  hover: '#E8842A',
  glow: 'rgba(217, 115, 13, 0.3)',
  // Text
  text: '#FFFFFF',
  textDim: '#9A9490',
  textMuted: '#6B6560',
  tooltipBg: 'rgba(21, 18, 16, 0.92)',
  tooltipBorder: 'rgba(255, 245, 235, 0.10)',
};

const RING_LABELS = ['', 'Inner Circle', 'Key', 'Regular', 'Acquaintance'];

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface LayoutNode extends OrbitNode {
  x: number;
  y: number;
  radius: number;
  color: string;
  ring: number;
  angle: number;
}

function layoutNodes(
  nodes: OrbitNode[],
  cx: number,
  cy: number,
  maxRadius: number,
): LayoutNode[] {
  // Group by importance
  const rings: Record<number, OrbitNode[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const n of nodes) {
    const imp = Math.min(4, Math.max(1, n.importance));
    rings[imp].push(n);
  }

  const laid: LayoutNode[] = [];
  const ringRadii = [0, maxRadius * 0.18, maxRadius * 0.38, maxRadius * 0.65, maxRadius * 0.88];

  for (let ring = 1; ring <= 4; ring++) {
    const group = rings[ring];
    if (group.length === 0) continue;

    const ringR = ringRadii[ring];
    // Jitter radius slightly so nodes don't sit on a perfect circle
    const jitterR = maxRadius * 0.06;

    for (let i = 0; i < group.length; i++) {
      const n = group[i];
      // Distribute evenly around the ring with a slight golden-ratio offset
      const angle = (i / group.length) * Math.PI * 2 + ring * 0.7;
      const r = ringR + (Math.sin(i * 2.39996) * jitterR); // golden angle jitter

      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      // Node size: based on interaction count, clamped
      const ix = n.interaction_count || 0;
      const minSize = ring <= 2 ? 4 : 2.5;
      const maxSize = ring <= 2 ? 14 : 8;
      const sizeT = Math.min(1, ix / 50); // normalize: 50+ interactions = max size
      const radius = minSize + sizeT * (maxSize - minSize);

      // Color by trend
      let color = COLORS.default;
      if (n.trend === 'growing') color = COLORS.growing;
      else if (n.trend === 'stable') color = COLORS.stable;
      else if (n.trend === 'drifting') color = COLORS.drifting;
      else if (n.trend === 'dormant') color = COLORS.dormant;
      else if (ix > 0) color = COLORS.stable;

      laid.push({ ...n, x, y, radius, color, ring, angle });
    }
  }

  return laid;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrbitCanvasProps {
  nodes: OrbitNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function OrbitCanvas({ nodes, selectedId, onSelect }: OrbitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<LayoutNode[]>([]);
  const hoverRef = useRef<string | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; org?: string; trend?: string } | null>(null);

  // Compute layout when nodes or canvas size changes
  const computeLayout = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxR = Math.min(cx, cy) * 0.92;
    layoutRef.current = layoutNodes(nodes, cx, cy, maxR);
  }, [nodes]);

  // Resize handler
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      computeLayout();
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(container);
    return () => obs.disconnect();
  }, [computeLayout]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(cx, cy) * 0.92;

      tRef.current += 0.003;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Draw ring guides
      const ringRadii = [0, maxR * 0.18, maxR * 0.38, maxR * 0.65, maxR * 0.88];
      for (let ring = 1; ring <= 4; ring++) {
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadii[ring], 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.ring;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ring label
        ctx.fillStyle = COLORS.ringLabel;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(RING_LABELS[ring], cx, cy - ringRadii[ring] - 6);
      }

      // Center dot (operator)
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.growing;
      ctx.fill();

      // Draw nodes
      const laid = layoutRef.current;
      for (const node of laid) {
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoverRef.current;

        // Subtle orbital drift
        const drift = Math.sin(tRef.current + node.angle * 3) * 1.5;
        const nx = node.x + drift;
        const ny = node.y + Math.cos(tRef.current + node.angle * 2) * 1.2;

        // Glow for inner circle / selected
        if (isSelected || (node.ring <= 2 && node.interaction_count > 5)) {
          ctx.beginPath();
          ctx.arc(nx, ny, node.radius + (isSelected ? 8 : 4), 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? COLORS.glow : `rgba(217, 115, 13, ${0.08 + Math.sin(tRef.current * 2) * 0.04})`;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? COLORS.selected : isHovered ? COLORS.hover : node.color;
        ctx.fill();

        // Name label for large nodes (importance 1-2 with interactions)
        if (node.ring <= 2 && node.radius >= 6) {
          ctx.fillStyle = isSelected ? COLORS.text : COLORS.textDim;
          ctx.font = `${isSelected ? '11' : '10'}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(node.name.split(' ')[0], nx, ny + node.radius + 13);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [selectedId, nodes]);

  // Hit testing
  const findNode = useCallback((ex: number, ey: number): LayoutNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ex - rect.left;
    const y = ey - rect.top;

    // Check from front to back (inner ring first = higher priority)
    for (const node of layoutRef.current) {
      const dx = x - node.x;
      const dy = y - node.y;
      const hitR = Math.max(node.radius + 4, 8); // min 8px hit target
      if (dx * dx + dy * dy <= hitR * hitR) {
        return node;
      }
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
    const node = findNode(e.clientX, e.clientY);
    const canvas = canvasRef.current;

    if (node) {
      hoverRef.current = node.id;
      if (canvas) canvas.style.cursor = 'pointer';
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 40,
        name: node.name,
        org: node.organization || undefined,
        trend: node.trend || undefined,
      });
    } else {
      hoverRef.current = null;
      if (canvas) canvas.style.cursor = 'default';
      setTooltip(null);
    }
  }, [findNode]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const node = findNode(e.clientX, e.clientY);
    if (node) {
      onSelect(node.id);
    }
  }, [findNode, onSelect]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { hoverRef.current = null; setTooltip(null); }}
        onClick={handleClick}
      />
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none px-3 py-1.5 rounded-[5px] border z-10"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
            background: COLORS.tooltipBg,
            borderColor: COLORS.tooltipBorder,
          }}
        >
          <span className="text-[12px] font-[510] text-white block">{tooltip.name}</span>
          {tooltip.org && <span className="text-[10px] text-[#9A9490] block">{tooltip.org}</span>}
          {tooltip.trend && <span className="text-[10px] text-[#6B6560] capitalize block">{tooltip.trend}</span>}
        </div>
      )}
      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex items-center gap-4 text-[10px] text-[#6B6560]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: COLORS.growing }} />
          growing
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: COLORS.stable }} />
          stable
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: COLORS.drifting }} />
          drifting
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: COLORS.dormant }} />
          dormant
        </div>
      </div>
      {/* Count */}
      <div className="absolute top-4 right-4 text-[11px] text-[#6B6560] tabular-nums">
        {nodes.length} contacts
      </div>
    </div>
  );
}
