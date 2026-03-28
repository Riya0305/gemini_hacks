import type { GraphData, GraphNode } from "@/lib/types";
import { NODE_COLORS } from "@/lib/types";

/** Stable palette: Paper 1, Paper 2, … (cycles if more than length). */
export const PAPER_LEGEND_PALETTE = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#06b6d4",
] as const;

export function parsePaperNumber(paperLabel?: string): number | null {
  if (!paperLabel) return null;
  const m = /^Paper\s+(\d+)$/i.exec(paperLabel.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function paperColorFromNumber(num: number): string {
  const i = Math.max(1, num) - 1;
  return PAPER_LEGEND_PALETTE[i % PAPER_LEGEND_PALETTE.length];
}

export type PaperLegendEntry = {
  /** 1-based for display: "Color 1", "Color 2", … */
  colorSlot: number;
  /** N in "Paper N" from extraction. */
  paperNumber: number;
  colorHex: string;
  /** Short title for expanded legend (display label or title). */
  detail: string;
};

function paperIdToNumber(graph: GraphData): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of graph.nodes) {
    const num = parsePaperNumber(n.paperLabel);
    if (num !== null) map.set(n.id, num);
  }
  return map;
}

function connectedPaperNumbers(nodeId: string, graph: GraphData): number[] {
  const idToNum = paperIdToNumber(graph);
  const nums: number[] = [];
  for (const e of graph.edges) {
    let other: string | null = null;
    if (e.source === nodeId) other = e.target;
    else if (e.target === nodeId) other = e.source;
    if (!other) continue;
    const pn = idToNum.get(other);
    if (pn !== undefined) nums.push(pn);
  }
  return nums;
}

/** Display color for a node from Paper N assignment (topics: nearest paper via edges, ties → lower N). */
export function getNodePaperColor(node: GraphNode, graph: GraphData): string {
  const hasPaper = graph.nodes.some((n) => parsePaperNumber(n.paperLabel) != null);
  if (!hasPaper) {
    return node.colorHex || NODE_COLORS[node.type] || "#94a3b8";
  }

  const selfNum = parsePaperNumber(node.paperLabel);
  if (selfNum !== null) return paperColorFromNumber(selfNum);

  const nums = connectedPaperNumbers(node.id, graph);
  if (nums.length === 0) {
    return node.colorHex || NODE_COLORS[node.type] || "#94a3b8";
  }
  return paperColorFromNumber(Math.min(...nums));
}

export function buildPaperLegendEntries(nodes: GraphNode[]): PaperLegendEntry[] {
  const byNum = new Map<number, string>();
  for (const n of nodes) {
    const num = parsePaperNumber(n.paperLabel);
    if (num === null) continue;
    const detail = (n.displayLabel || n.paperTitle || n.id).trim() || `Paper ${num}`;
    if (!byNum.has(num)) byNum.set(num, detail);
  }
  return [...byNum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([paperNumber, detail], index) => ({
      colorSlot: index + 1,
      paperNumber,
      colorHex: paperColorFromNumber(paperNumber),
      detail,
    }));
}

export function applyPaperPaletteColors(graph: GraphData): GraphData {
  if (!graph.nodes.some((n) => parsePaperNumber(n.paperLabel) != null)) {
    return graph;
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      colorHex: getNodePaperColor(node, graph),
    })),
  };
}
