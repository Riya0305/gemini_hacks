"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LinkObject, NodeObject } from "react-force-graph-2d";
import { GraphData, GraphEdge, GraphNode, NODE_COLORS } from "@/lib/types";
import EmptyState from "./EmptyState";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface GraphCanvasProps {
  graphData: GraphData;
  selectedEdge: GraphEdge | null;
  selectedNode: GraphNode | null;
  onEdgeClick: (edge: GraphEdge) => void;
  onNodeClick: (node: GraphNode) => void;
  emptyMessage?: string;
}

type ForceNode = NodeObject<GraphNode>;
type ForceLink = LinkObject<GraphNode, GraphEdge> & GraphEdge;
type PinnedPosition = { x: number; y: number };
type LegendItem = {
  colorHex: string;
  themeLabel: string;
  themeDescription: string;
  count: number;
};

function truncateLegendDescription(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 88) return cleaned;
  return `${cleaned.slice(0, 85).trimEnd()}...`;
}

function getEndpointId(endpoint: ForceLink["source"] | ForceLink["target"]): string {
  if (typeof endpoint === "string") return endpoint;
  if (typeof endpoint === "number") return String(endpoint);
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id?: unknown }).id ?? "");
  }
  return "";
}

function getLinkId(link: ForceLink): string {
  return `${getEndpointId(link.source)}::${getEndpointId(link.target)}`;
}

function getNodeColor(node: GraphNode): string {
  return node.colorHex || NODE_COLORS[node.type] || "#94a3b8";
}

function getNodeLabel(node: GraphNode): string {
  return node.displayLabel || node.paperTitle || node.id;
}

function wrapNodeLabel(label: string): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Paper"];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= 18 || currentLine.length === 0) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
    if (lines.length === 1 && currentLine.length > 18) {
      lines.push(`${currentLine.slice(0, 15)}...`);
      return lines;
    }
    if (lines.length === 2) {
      return [`${lines[0]}`, `${lines[1].slice(0, 15)}...`];
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 1 && lines[0].length > 18) {
    return [`${lines[0].slice(0, 15)}...`];
  }

  if (lines.length > 2) {
    return [lines[0], `${lines[1].slice(0, 15)}...`];
  }

  return lines;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function buildLegendItems(nodes: GraphNode[]): LegendItem[] {
  const legendMap = new Map<string, LegendItem>();

  for (const node of nodes) {
    if (!node.paperLabel || !node.themeLabel || !node.colorHex) continue;
    const key = `${node.themeLabel.toLowerCase()}::${node.colorHex}`;
    const existing = legendMap.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    legendMap.set(key, {
      colorHex: node.colorHex,
      themeLabel: node.themeLabel,
      themeDescription:
        node.themeDescription || `${node.themeLabel} papers share a common research focus.`,
      count: 1,
    });
  }

  return Array.from(legendMap.values()).sort((left, right) =>
    left.themeLabel.localeCompare(right.themeLabel)
  );
}

export default function GraphCanvas({
  graphData,
  selectedEdge,
  selectedNode,
  onEdgeClick,
  onNodeClick,
  emptyMessage = "Upload papers to generate a knowledge graph",
}: GraphCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [pinnedPositions, setPinnedPositions] = useState<Record<string, PinnedPosition>>({});
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);

  useEffect(() => {
    if (!viewportRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      setDimensions({ width, height });
    });

    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  const forceData = useMemo(
    () => ({
      nodes: graphData.nodes.map((node) => {
        const pinned = pinnedPositions[node.id];
        return pinned
          ? ({ ...node, x: pinned.x, y: pinned.y, fx: pinned.x, fy: pinned.y } as ForceNode)
          : ({ ...node } as ForceNode);
      }),
      links: graphData.edges.map((edge) => ({ ...edge })) as ForceLink[],
    }),
    [graphData, pinnedPositions]
  );

  const legendItems = useMemo(() => buildLegendItems(graphData.nodes), [graphData.nodes]);
  const selectedId = selectedEdge
    ? `${selectedEdge.source}::${selectedEdge.target}`
    : null;
  const selectedNodeId = selectedNode?.id ?? null;
  const compactLegendItems = legendItems.slice(0, 3);

  const handleLinkClick = useCallback(
    (rawLink: LinkObject<GraphNode, GraphEdge>) => {
      const link = rawLink as ForceLink;
      const source = getEndpointId(link.source);
      const target = getEndpointId(link.target);
      if (!source || !target) return;

      onEdgeClick({
        source,
        target,
        relation: link.relation,
        explanation: link.explanation,
        evidence: link.evidence,
      });
    },
    [onEdgeClick]
  );

  const handleNodeClick = useCallback(
    (rawNode: NodeObject<GraphNode>) => {
      const node = rawNode as ForceNode;
      onNodeClick({
        id: String(node.id ?? ""),
        type: node.type ?? "concept",
        summary: node.summary,
        evidence: node.evidence,
        paperLabel: node.paperLabel,
        displayLabel: node.displayLabel,
        paperTitle: node.paperTitle,
        themeLabel: node.themeLabel,
        themeDescription: node.themeDescription,
        colorHex: node.colorHex,
      });
    },
    [onNodeClick]
  );

  const handleNodeDragEnd = useCallback((rawNode: NodeObject<GraphNode>) => {
    const node = rawNode as ForceNode;
    const id = String(node.id ?? "");
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    node.fx = x;
    node.fy = y;
    setPinnedPositions((previous) => ({
      ...previous,
      [id]: { x, y },
    }));
  }, []);

  const nodeCanvasObject = useCallback(
    (rawNode: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D) => {
      const node = rawNode as ForceNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const nodeId = String(node.id ?? "");
      const isSelected = selectedNodeId === nodeId;
      const isPaperNode = Boolean(node.paperLabel);
      const radius = isPaperNode ? (isSelected ? 9 : 7.5) : isSelected ? 7.5 : 6;
      const color = getNodeColor(node);
      const labelLines = wrapNodeLabel(getNodeLabel(node));
      const fontSize = isPaperNode ? 4.4 : 3.8;
      const lineHeight = fontSize + 1.4;

      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "#22d3ee2a" : `${color}22`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}18`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.lineWidth = isSelected ? 1.1 : 0.75;
      ctx.strokeStyle = isSelected ? "#d8f6ff" : `${color}aa`;
      ctx.stroke();

      ctx.font = `${isPaperNode ? 600 : 500} ${fontSize}px sans-serif`;
      const maxTextWidth = Math.max(...labelLines.map((line) => ctx.measureText(line).width));
      const boxWidth = maxTextWidth + 6;
      const boxHeight = labelLines.length * lineHeight + 4;
      const boxX = x - boxWidth / 2;
      const boxY = y + radius + 4;

      drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 3);
      ctx.fillStyle = "rgba(3, 7, 18, 0.88)";
      ctx.fill();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = isPaperNode ? `${color}66` : "rgba(148, 163, 184, 0.25)";
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e5e7eb";

      labelLines.forEach((line, index) => {
        const lineY = boxY + 3 + lineHeight / 2 + index * lineHeight;
        ctx.fillText(line, x, lineY);
      });
    },
    [selectedNodeId]
  );

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
        <div className="border-b border-gray-800/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
            4. Explore
          </p>
          <h2 className="mt-2 text-lg font-semibold text-gray-100">
            Interactive Knowledge Graph
          </h2>
        </div>

        <div ref={viewportRef} className="min-h-0 flex-1 bg-background">
          <EmptyState
            message={emptyMessage}
            icon={
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <circle cx="4" cy="6" r="2" />
                <circle cx="20" cy="6" r="2" />
                <circle cx="4" cy="18" r="2" />
                <circle cx="20" cy="18" r="2" />
                <line x1="6" y1="6" x2="9.5" y2="10.5" />
                <line x1="18" y1="6" x2="14.5" y2="10.5" />
                <line x1="6" y1="18" x2="9.5" y2="13.5" />
                <line x1="18" y1="18" x2="14.5" y2="13.5" />
              </svg>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800/80 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
            4. Explore
          </p>
          <h2 className="mt-2 text-lg font-semibold text-gray-100">
            Interactive Knowledge Graph
          </h2>
        </div>
        <div className="rounded-full border border-cyan-accent/20 bg-cyan-accent/10 px-3 py-1 text-xs text-cyan-accent">
          {selectedEdge
            ? "Connection selected"
            : selectedNode
            ? "Node selected"
            : "Drag or inspect"}
        </div>
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 bg-background">
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={forceData}
          backgroundColor="#030712"
          nodeCanvasObject={nodeCanvasObject as never}
          nodePointerAreaPaint={((rawNode: NodeObject<GraphNode>, color: string, ctx: CanvasRenderingContext2D) => {
            const node = rawNode as ForceNode;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, node.paperLabel ? 18 : 14, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }) as never}
          linkColor={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            return getLinkId(link) === selectedId ? "#22d3ee" : "#374151";
          }) as never}
          linkWidth={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            return getLinkId(link) === selectedId ? 2.5 : 1.15;
          }) as never}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={() => "#22d3ee"}
          onLinkClick={handleLinkClick as never}
          onNodeClick={handleNodeClick as never}
          onNodeDragEnd={handleNodeDragEnd as never}
          enableNodeDrag={true}
          cooldownTicks={100}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />

        <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-amber-accent/20 bg-gray-950/90 px-4 py-2 text-xs text-gray-300 shadow-[0_12px_24px_rgba(0,0,0,0.28)]">
          Drag nodes to reposition them. Click any node or connection to inspect it.
        </div>

        {legendItems.length > 0 ? (
          <div className="pointer-events-auto absolute bottom-4 right-4 max-w-[240px]">
            <div className="rounded-2xl border border-gray-800/80 bg-gray-950/80 px-3 py-2.5 shadow-[0_14px_30px_rgba(0,0,0,0.28)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-accent/80">
                    Legend
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {legendItems.length} theme{legendItems.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLegendExpanded((previous) => !previous)}
                  className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-cyan-accent/30 hover:text-cyan-accent"
                >
                  {isLegendExpanded ? "Hide" : "Show"}
                </button>
              </div>

              {!isLegendExpanded ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {compactLegendItems.map((item) => (
                    <div
                      key={`${item.themeLabel}-${item.colorHex}`}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/70 px-2.5 py-1.5 text-xs text-gray-300"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: item.colorHex }}
                      />
                      <span className="max-w-[110px] truncate">{item.themeLabel}</span>
                      <span className="text-gray-500">{item.count}</span>
                    </div>
                  ))}
                  {legendItems.length > compactLegendItems.length ? (
                    <div className="inline-flex items-center rounded-full border border-gray-800 bg-gray-900/70 px-2.5 py-1.5 text-xs text-gray-500">
                      +{legendItems.length - compactLegendItems.length} more
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {legendItems.map((item) => (
                    <div
                      key={`${item.themeLabel}-${item.colorHex}`}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-xl border border-gray-800/80 bg-gray-900/55 px-2.5 py-2"
                    >
                      <span
                        className="mt-1 h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: item.colorHex }}
                      />
                      <div>
                        <p className="text-xs font-medium text-gray-100">{item.themeLabel}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                          {truncateLegendDescription(item.themeDescription)}
                        </p>
                      </div>
                      <span className="rounded-full border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
