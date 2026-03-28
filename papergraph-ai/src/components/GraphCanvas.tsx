"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";
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
type ForceGraphHandle = ForceGraphMethods<GraphNode, GraphEdge>;
type ManyBodyForce = { strength: (value: number) => ManyBodyForce };
type LinkForceController = { distance: (value: number) => LinkForceController };
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
  return `${getEndpointId(link.source)}::${getEndpointId(link.target)}::${link.relation || ""}`;
}

function getNodeId(rawNode: NodeObject<GraphNode> | null): string | null {
  if (!rawNode) return null;
  if (typeof rawNode.id === "string") return rawNode.id;
  if (typeof rawNode.id === "number") return String(rawNode.id);
  return null;
}

function resolveForceNode(endpoint: ForceLink["source"] | ForceLink["target"]): ForceNode | null {
  if (!endpoint || typeof endpoint !== "object" || !("x" in endpoint)) return null;
  return endpoint as ForceNode;
}

function buildLayoutKey(graphData: GraphData): string {
  const nodeSignature = graphData.nodes
    .map((node) => node.id)
    .sort()
    .join("|");
  const edgeSignature = graphData.edges
    .map((edge) => `${edge.source}->${edge.target}:${edge.relation}`)
    .sort()
    .join("|");

  return `${nodeSignature}__${edgeSignature}`;
}

function buildForceData(
  graphData: GraphData,
  pinnedLayout: Record<string, PinnedPosition> = {}
): { nodes: ForceNode[]; links: ForceLink[] } {
  return {
    nodes: graphData.nodes.map((node) => {
      const pinned = pinnedLayout[node.id];
      return pinned
        ? ({ ...node, x: pinned.x, y: pinned.y, fx: pinned.x, fy: pinned.y } as ForceNode)
        : ({ ...node } as ForceNode);
    }),
    links: graphData.edges.map((edge) => ({ ...edge })) as ForceLink[],
  };
}

function getNodeColor(node: GraphNode): string {
  return node.colorHex || NODE_COLORS[node.type] || "#94a3b8";
}

function getNodeLabel(node: GraphNode): string {
  // For paper nodes, show the actual paper title (truncated for canvas)
  if (node.paperLabel) {
    const title = node.paperTitle || node.id;
    // Truncate long titles to fit the canvas label box
    return title.length > 28 ? `${title.slice(0, 26).trimEnd()}…` : title;
  }
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
  const graphRef = useRef<ForceGraphHandle | undefined>(undefined);
  const pinnedLayoutsRef = useRef<Record<string, Record<string, PinnedPosition>>>({});
  const draggingNodeIdRef = useRef<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [pinnedLayouts, setPinnedLayouts] = useState<Record<string, Record<string, PinnedPosition>>>({});
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  const [activeDragNodeId, setActiveDragNodeId] = useState<string | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);

  // refs mirror hover/drag/selection state so canvas paint callbacks stay stable
  const hoveredNodeIdRef = useRef<string | null>(null);
  const hoveredLinkIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const activeDragNodeIdRef = useRef<string | null>(null);
  const selectedEdgeIdRef = useRef<string | null>(null);

  const layoutKey = useMemo(() => buildLayoutKey(graphData), [graphData]);
  const activePinnedLayout = useMemo(
    () => pinnedLayouts[layoutKey] || {},
    [layoutKey, pinnedLayouts]
  );

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

  useEffect(() => {
    const nodeIds = new Set(graphData.nodes.map((node) => node.id));
    const pinnedLayout = pinnedLayoutsRef.current[layoutKey];

    if (pinnedLayout) {
      Object.keys(pinnedLayout).forEach((nodeId) => {
        if (!nodeIds.has(nodeId)) {
          delete pinnedLayout[nodeId];
        }
      });
    }

    draggingNodeIdRef.current = null;
  }, [graphData.nodes, layoutKey]);

  useEffect(() => {
    if (!graphData.nodes.length) return;

    const timeoutId = window.setTimeout(() => {
      graphRef.current?.zoomToFit(500, 112);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [graphData.nodes.length, layoutKey, layoutRevision]);

  useEffect(() => {
    if (!graphData.nodes.length) return;

    const timeoutId = window.setTimeout(() => {
      const graph = graphRef.current;
      if (!graph) return;

      const nodeCount = graphData.nodes.length;
      const linkCount = graphData.edges.length;
      const linkDistance = Math.min(
        180,
        Math.max(60, 70 + Math.sqrt(nodeCount) * 8 - Math.min(linkCount, 40) * 0.6)
      );
      const chargeStrength = -Math.min(
        500,
        Math.max(180, 200 + nodeCount * 6 - Math.min(linkCount, nodeCount * 2) * 1.5)
      );

      (graph.d3Force("link") as LinkForceController | undefined)?.distance?.(linkDistance);
      (graph.d3Force("charge") as ManyBodyForce | undefined)?.strength?.(chargeStrength);
      graph.d3ReheatSimulation();
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [graphData.edges.length, graphData.nodes.length, layoutRevision]);

  const pinNodePosition = useCallback(
    (nodeId: string, x: number, y: number, syncState = false) => {
      if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const nextLayout = {
        ...(pinnedLayoutsRef.current[layoutKey] || {}),
        [nodeId]: { x, y },
      };
      pinnedLayoutsRef.current = {
        ...pinnedLayoutsRef.current,
        [layoutKey]: nextLayout,
      };
      if (syncState) {
        setPinnedLayouts((previous) => ({
          ...previous,
          [layoutKey]: nextLayout,
        }));
      }
    },
    [layoutKey]
  );

  // only rebuild force data when the graph itself changes or on layout remix,
  // NOT on every pinned position update — that causes re-render loops / zoom glitches
  const initialPinnedRef = useRef<Record<string, PinnedPosition>>({});
  useEffect(() => {
    initialPinnedRef.current = pinnedLayoutsRef.current[layoutKey] || {};
  }, [layoutKey, layoutRevision]);

  const forceData = useMemo(
    () => buildForceData(graphData, initialPinnedRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphData, layoutKey, layoutRevision]
  );

  const legendItems = useMemo(() => buildLegendItems(graphData.nodes), [graphData.nodes]);
  const selectedId = selectedEdge
    ? `${selectedEdge.source}::${selectedEdge.target}::${selectedEdge.relation}`
    : null;
  const selectedNodeId = selectedNode?.id ?? null;
  const compactLegendItems = legendItems.slice(0, 3);
  const hoveredNode = hoveredNodeId
    ? graphData.nodes.find((node) => node.id === hoveredNodeId) ?? null
    : null;
  const hoveredLink = hoveredLinkId
    ? graphData.edges.find(
        (edge) =>
          `${edge.source}::${edge.target}::${edge.relation}` === hoveredLinkId
      ) ?? null
    : null;
  const activeDragNode = activeDragNodeId
    ? graphData.nodes.find((node) => node.id === activeDragNodeId) ?? null
    : null;
  const effectiveHoveredNodeId = hoveredNode ? hoveredNodeId : null;
  const effectiveHoveredLinkId = hoveredLink ? hoveredLinkId : null;
  const effectiveActiveDragNodeId = isDraggingNode && activeDragNode ? activeDragNodeId : null;

  // keep refs in sync so canvas paint reads current state without deps
  hoveredNodeIdRef.current = effectiveHoveredNodeId;
  hoveredLinkIdRef.current = effectiveHoveredLinkId;
  selectedNodeIdRef.current = selectedNodeId;
  activeDragNodeIdRef.current = effectiveActiveDragNodeId;
  selectedEdgeIdRef.current = selectedId;
  const interactionLabel = effectiveActiveDragNodeId && activeDragNode
    ? `Dragging ${getNodeLabel(activeDragNode)}`
    : hoveredNode
    ? `Hovering ${getNodeLabel(hoveredNode)}`
    : hoveredLink
    ? `Tracing ${hoveredLink.relation}`
    : selectedEdge
    ? "Connection selected"
    : selectedNode
    ? "Node selected"
    : "Freeform constellation";

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

  const handleNodeHover = useCallback((rawNode: NodeObject<GraphNode> | null) => {
    setHoveredNodeId(getNodeId(rawNode));
    if (rawNode) {
      setHoveredLinkId(null);
    }
  }, []);

  const handleLinkHover = useCallback(
    (rawLink: LinkObject<GraphNode, GraphEdge> | null) => {
      setHoveredLinkId(rawLink ? getLinkId(rawLink as ForceLink) : null);
      if (rawLink) {
        setHoveredNodeId(null);
      }
    },
    []
  );

  const handleNodeDrag = useCallback(
    (rawNode: NodeObject<GraphNode>) => {
      const node = rawNode as ForceNode;
      const id = String(node.id ?? "");
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (!id) return;

      if (draggingNodeIdRef.current !== id) {
        draggingNodeIdRef.current = id;
        setActiveDragNodeId(id);
        setIsDraggingNode(true);
      }

      node.fx = x;
      node.fy = y;
      pinNodePosition(id, x, y, false);
    },
    [pinNodePosition]
  );

  const handleNodeDragEnd = useCallback(
    (rawNode: NodeObject<GraphNode>) => {
      const node = rawNode as ForceNode;
      const id = String(node.id ?? "");
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      if (!id) return;

      node.fx = x;
      node.fy = y;
      pinNodePosition(id, x, y, true);
      draggingNodeIdRef.current = null;
      setActiveDragNodeId(null);
      setIsDraggingNode(false);
    },
    [pinNodePosition]
  );

  const handleEngineStop = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const nextPinnedLayout = { ...(pinnedLayoutsRef.current[layoutKey] || {}) };
    let changed = false;

    forceData.nodes.forEach((rawNode) => {
      const node = rawNode as ForceNode;
      const id = String(node.id ?? "");
      const x = node.x;
      const y = node.y;

      if (
        !id ||
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        return;
      }

      const prev = nextPinnedLayout[id];
      if (prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5) {
        return;
      }

      node.fx = x;
      node.fy = y;
      nextPinnedLayout[id] = { x, y };
      changed = true;
    });

    if (!changed) return;

    pinnedLayoutsRef.current = {
      ...pinnedLayoutsRef.current,
      [layoutKey]: nextPinnedLayout,
    };
    setPinnedLayouts((previous) => ({
      ...previous,
      [layoutKey]: nextPinnedLayout,
    }));
  }, [forceData.nodes, layoutKey]);

  const handleZoomToFit = useCallback(() => {
    graphRef.current?.zoomToFit(450, 112);
  }, []);

  const handleRemixLayout = useCallback(() => {
    delete pinnedLayoutsRef.current[layoutKey];
    draggingNodeIdRef.current = null;
    setHoveredNodeId(null);
    setHoveredLinkId(null);
    setActiveDragNodeId(null);
    setIsDraggingNode(false);
    setPinnedLayouts((previous) => {
      const nextLayouts = { ...previous };
      delete nextLayouts[layoutKey];
      return nextLayouts;
    });
    setLayoutRevision((previous) => previous + 1);
  }, [layoutKey]);

  const nodeCanvasObject = useCallback(
    (rawNode: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D) => {
      const node = rawNode as ForceNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const nodeId = String(node.id ?? "");
      // read interaction state from refs to avoid re-creating this callback on hover
      const isSelected = selectedNodeIdRef.current === nodeId;
      const isHovered = hoveredNodeIdRef.current === nodeId;
      const isDragging = activeDragNodeIdRef.current === nodeId;
      const isPaperNode = Boolean(node.paperLabel);
      const color = getNodeColor(node);
      const labelLines = wrapNodeLabel(getNodeLabel(node));
      const active = isHovered || isSelected || isDragging;

      if (isPaperNode) {
        // -- PAPER NODE: large colored circle, clearly distinguishable --
        const r = 9 + (active ? 1.5 : 0);

        // outer glow ring
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `${color}40`;
        ctx.stroke();

        // strong glow
        ctx.shadowColor = color;
        ctx.shadowBlur = active ? 20 : 12;

        // filled circle with the paper's theme color
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;

        // border
        ctx.lineWidth = isSelected ? 2 : active ? 1.4 : 1;
        ctx.strokeStyle = isSelected ? "#ffffff" : isDragging ? "#ffffff" : `${color}ee`;
        ctx.stroke();

        // white doc icon inside the circle
        const iconW = r * 0.55;
        const iconTop = y - iconW * 0.5;
        for (let i = 0; i < 3; i++) {
          const lY = iconTop + i * 2.6;
          const lW = i === 2 ? iconW * 0.6 : iconW;
          ctx.beginPath();
          ctx.moveTo(x - lW / 2, lY);
          ctx.lineTo(x + lW / 2, lY);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.stroke();
        }

        // label below
        const fontSize = 4.2 + (active ? 0.2 : 0);
        const lineHeight = fontSize + 1.6;
        ctx.font = `600 ${fontSize}px sans-serif`;
        const maxTW = Math.max(...labelLines.map((l) => ctx.measureText(l).width));
        const boxW = maxTW + 7;
        const boxH = labelLines.length * lineHeight + 4.5;
        const boxX = x - boxW / 2;
        const boxY = y + r + 4;

        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 3);
        ctx.fillStyle = "rgba(6, 12, 28, 0.92)";
        ctx.fill();
        ctx.lineWidth = active ? 0.7 : 0.45;
        ctx.strokeStyle = isSelected ? "#67e8f9aa" : `${color}55`;
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#e2e8f0";
        labelLines.forEach((line, i) => {
          ctx.fillText(line, x, boxY + 3 + lineHeight / 2 + i * lineHeight);
        });
      } else {
        // -- TOPIC/CONCEPT NODE: smaller dot, these are the key connectors --
        const r = 4 + (isHovered ? 0.5 : 0) + (isSelected ? 0.7 : 0) + (isDragging ? 0.4 : 0);

        // glow
        ctx.shadowColor = color;
        ctx.shadowBlur = active ? 10 : 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (active) {
          ctx.lineWidth = isSelected ? 1 : 0.7;
          ctx.strokeStyle = isSelected ? "#d8f6ff" : isDragging ? "#ffffff" : `${color}bb`;
          ctx.stroke();
        }

        // label
        const fontSize = 3.6 + (active ? 0.2 : 0);
        const lineHeight = fontSize + 1.4;
        ctx.font = `500 ${fontSize}px sans-serif`;
        const maxTW = Math.max(...labelLines.map((l) => ctx.measureText(l).width));
        const boxW = maxTW + 6;
        const boxH = labelLines.length * lineHeight + 4;
        const boxX = x - boxW / 2;
        const boxY = y + r + 3;

        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 2.5);
        ctx.fillStyle = "rgba(5, 10, 24, 0.88)";
        ctx.fill();
        if (active) {
          ctx.lineWidth = 0.5;
          ctx.strokeStyle = isSelected ? "#67e8f9aa" : `${color}44`;
          ctx.stroke();
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#cbd5e1";
        labelLines.forEach((line, i) => {
          ctx.fillText(line, x, boxY + 2.5 + lineHeight / 2 + i * lineHeight);
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const linkPointerAreaPaint = useCallback(
    (
      rawLink: LinkObject<GraphNode, GraphEdge>,
      color: string,
      ctx: CanvasRenderingContext2D
    ) => {
      const link = rawLink as ForceLink;
      const sourceNode = resolveForceNode(link.source);
      const targetNode = resolveForceNode(link.target);

      if (!sourceNode || !targetNode) return;

      const linkId = getLinkId(link);
      ctx.beginPath();
      ctx.moveTo(sourceNode.x ?? 0, sourceNode.y ?? 0);
      ctx.lineTo(targetNode.x ?? 0, targetNode.y ?? 0);
      ctx.lineWidth = linkId === selectedEdgeIdRef.current ? 14 : hoveredLinkIdRef.current === linkId ? 12 : 10;
      ctx.strokeStyle = color;
      ctx.stroke();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
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
          {interactionLabel}
        </div>
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <div className="graph-canvas-aurora pointer-events-none absolute inset-0" />
        <div className="graph-canvas-grid pointer-events-none absolute inset-0 opacity-50" />
        <ForceGraph2D
          ref={graphRef as never}
          width={dimensions.width}
          height={dimensions.height}
          graphData={forceData}
          backgroundColor="rgba(0, 0, 0, 0)"
          nodeCanvasObject={nodeCanvasObject as never}
          nodePointerAreaPaint={((rawNode: NodeObject<GraphNode>, color: string, ctx: CanvasRenderingContext2D) => {
            const node = rawNode as ForceNode;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, node.paperLabel ? 14 : 10, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }) as never}
          onNodeHover={handleNodeHover as never}
          onLinkHover={handleLinkHover as never}
          linkColor={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            const linkId = getLinkId(link);
            if (linkId === selectedId) return "#67e8f9";
            if (linkId === effectiveHoveredLinkId) return "#94a3b8";
            return "#4b6a8a";
          }) as never}
          linkWidth={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            const linkId = getLinkId(link);
            if (linkId === selectedId) return 3;
            if (linkId === effectiveHoveredLinkId) return 2.2;
            return 1.4;
          }) as never}
          linkCurvature={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            return getLinkId(link) === selectedId ? 0.06 : effectiveHoveredLinkId === getLinkId(link) ? 0.025 : 0;
          }) as never}
          linkDirectionalParticles={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            const linkId = getLinkId(link);
            if (linkId === selectedId) return 4;
            if (linkId === effectiveHoveredLinkId) return 3;
            return 1;
          }) as never}
          linkDirectionalParticleWidth={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            return getLinkId(link) === selectedId ? 2.4 : effectiveHoveredLinkId === getLinkId(link) ? 1.8 : 1.2;
          }) as never}
          linkDirectionalParticleColor={((rawLink: LinkObject<GraphNode, GraphEdge>) => {
            const link = rawLink as ForceLink;
            return getLinkId(link) === selectedId ? "#cffafe" : "#22d3ee";
          }) as never}
          linkDirectionalParticleSpeed={0.0035}
          linkPointerAreaPaint={linkPointerAreaPaint as never}
          onLinkClick={handleLinkClick as never}
          onNodeClick={handleNodeClick as never}
          onNodeDrag={handleNodeDrag as never}
          onNodeDragEnd={handleNodeDragEnd as never}
          onBackgroundClick={() => {
            setHoveredNodeId(null);
            setHoveredLinkId(null);
          }}
          onEngineStop={handleEngineStop}
          enableNodeDrag={true}
          minZoom={0.45}
          maxZoom={4}
          linkHoverPrecision={10}
          cooldownTicks={200}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          showPointerCursor={((obj: ForceNode | ForceLink | undefined) => Boolean(obj)) as never}
        />

        <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-gray-950/70 px-3 py-1.5 text-gray-300 shadow-[0_12px_24px_rgba(0,0,0,0.28)] backdrop-blur">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-accent/85">
            Graph
          </span>
          <span className="text-[11px]">{graphData.nodes.length}n</span>
          <span className="text-[11px]">{graphData.edges.length}e</span>
        </div>

        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleZoomToFit}
            className="rounded-full border border-white/10 bg-gray-950/80 px-3 py-2 text-[11px] font-medium text-gray-200 transition-all hover:border-cyan-accent/40 hover:text-cyan-accent"
          >
            Orbit Fit
          </button>
          <button
            type="button"
            onClick={handleRemixLayout}
            className="rounded-full border border-cyan-accent/20 bg-cyan-accent/10 px-3 py-2 text-[11px] font-medium text-cyan-accent transition-all hover:border-cyan-accent/40 hover:bg-cyan-accent/15"
          >
            Remix Layout
          </button>
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
