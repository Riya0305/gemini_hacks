export const NODE_TYPES = [
  "technology",
  "method",
  "author",
  "application",
  "concept",
] as const;

export type GraphNodeType = (typeof NODE_TYPES)[number];

// Represents a single node in the graph.
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  summary?: string;
  evidence?: string;
  paperLabel?: string;
  displayLabel?: string;
  paperTitle?: string;
  themeLabel?: string;
  themeDescription?: string;
  colorHex?: string;
}

// Represents a relationship between two nodes.
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  explanation: string;
  evidence: string;
}

// Groups all graph nodes and edges together.
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Contains the text answer from the ask API.
export interface AskResponse {
  answer: string;
}

// A single message in the live chat session.
export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export const EMPTY_GRAPH: GraphData = {
  nodes: [],
  edges: [],
};

// Maps each node type to its display color in the graph.
export const NODE_COLORS: Record<GraphNodeType, string> = {
  technology: "#22d3ee",
  method: "#a78bfa",
  author: "#fbbf24",
  application: "#34d399",
  concept: "#94a3b8",
};
