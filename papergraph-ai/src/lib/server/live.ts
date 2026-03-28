import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from "@google/genai";
import { DEFAULT_LIVE_MODEL, type LiveTokenResponse } from "@/lib/live";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/types";

const LIVE_EXPIRE_MINUTES = 30;
const LIVE_NEW_SESSION_WINDOW_SECONDS = 60;
const MAX_LIVE_PROMPT_NODES = 48;
const MAX_LIVE_PROMPT_EDGES = 72;
const MAX_FIELD_CHARS = 180;

export class LiveRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LiveRouteError";
    this.status = status;
    Object.setPrototypeOf(this, LiveRouteError.prototype);
  }
}

export function isGraphData(value: unknown): value is GraphData {
  const graph = value as GraphData;
  return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges);
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new LiveRouteError(
      500,
      "GEMINI_API_KEY is not configured. Add it to your server environment before using Live."
    );
  }

  return apiKey;
}

function clipText(value: unknown, maxLength = MAX_FIELD_CHARS): string {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

function describeNode(node: GraphNode): string {
  const title = clipText(node.paperTitle || node.displayLabel || node.id);
  const type = clipText(node.type);
  const summary = clipText(node.summary, 120);
  const theme = clipText(node.themeLabel, 60);
  const details = [type && `type=${type}`, theme && `theme=${theme}`, summary && `summary=${summary}`]
    .filter(Boolean)
    .join(" | ");

  return details ? `- ${title}: ${details}` : `- ${title}`;
}

function describeEdge(edge: GraphEdge): string {
  const source = clipText(edge.source, 80);
  const target = clipText(edge.target, 80);
  const relation = clipText(edge.relation, 48);
  const explanation = clipText(edge.explanation, 120);
  const summary = [`${source} -> ${target}`, relation && `relation=${relation}`, explanation && `why=${explanation}`]
    .filter(Boolean)
    .join(" | ");

  return `- ${summary}`;
}

function buildLiveSystemInstruction(graphData: GraphData): string {
  const nodeLines = graphData.nodes.slice(0, MAX_LIVE_PROMPT_NODES).map(describeNode);
  const edgeLines = graphData.edges.slice(0, MAX_LIVE_PROMPT_EDGES).map(describeEdge);
  const truncatedNodes =
    graphData.nodes.length > MAX_LIVE_PROMPT_NODES
      ? `\n- ...${graphData.nodes.length - MAX_LIVE_PROMPT_NODES} more nodes omitted`
      : "";
  const truncatedEdges =
    graphData.edges.length > MAX_LIVE_PROMPT_EDGES
      ? `\n- ...${graphData.edges.length - MAX_LIVE_PROMPT_EDGES} more edges omitted`
      : "";

  return `
You are the secure Gemini Live copilot inside PaperGraph AI.

Your job:
- Help the user analyze how uploaded research papers and graph entities correlate.
- Stay grounded in the current graph snapshot below.
- Prefer the graph's actual nodes, edges, explanations, and evidence over speculation.
- If the graph does not currently support a claim, say that plainly.

Tool rules:
- Only call addNode, addEdge, or highlightNode when the user explicitly asks to modify the graph.
- Do not invent evidence for a new node or edge.
- Treat graph edits as workspace annotations, not as a rewrite of extracted paper evidence.
- When the user asks for analysis only, answer directly without calling tools.

Interaction style:
- Be concise, specific, and useful.
- Focus on correlation, contrast, overlap, and missing links across papers.
- Refer to nodes by their visible labels or paper titles when possible.

Current graph snapshot:
- Node count: ${graphData.nodes.length}
- Edge count: ${graphData.edges.length}

Nodes:
${nodeLines.length > 0 ? nodeLines.join("\n") : "- No nodes are loaded yet."}${truncatedNodes}

Edges:
${edgeLines.length > 0 ? edgeLines.join("\n") : "- No edges are loaded yet."}${truncatedEdges}
`.trim();
}

export async function createLiveSessionToken(
  graphData: GraphData
): Promise<LiveTokenResponse> {
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + LIVE_EXPIRE_MINUTES * 60 * 1000
  ).toISOString();
  const newSessionExpiresAt = new Date(
    issuedAt.getTime() + LIVE_NEW_SESSION_WINDOW_SECONDS * 1000
  ).toISOString();
  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;

  const client = new GoogleGenAI({
    apiKey: getApiKey(),
    httpOptions: {
      apiVersion: "v1alpha",
    },
  });

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: newSessionExpiresAt,
      lockAdditionalFields: [],
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: {
            slidingWindow: {},
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 220,
              silenceDurationMs: 900,
            },
          },
          systemInstruction: buildLiveSystemInstruction(graphData),
        },
      },
    },
  });

  if (!token.name) {
    throw new LiveRouteError(
      502,
      "Gemini did not return a usable ephemeral token for Live."
    );
  }

  return {
    token: token.name,
    model,
    issuedAt: issuedAt.toISOString(),
    expiresAt,
    newSessionExpiresAt,
  };
}
