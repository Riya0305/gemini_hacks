import {
  AskResponse,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  NODE_TYPES,
} from "@/lib/types";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_FILE_COUNT = 5;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

type ThinkingLevel = "minimal" | "low" | "high";

const GRAPH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: [...NODE_TYPES] },
          summary: { type: "string" },
          evidence: { type: "string" },
          paperLabel: { type: "string" },
          displayLabel: { type: "string" },
          paperTitle: { type: "string" },
          themeLabel: { type: "string" },
          themeDescription: { type: "string" },
        },
        required: ["id", "type"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          relation: { type: "string" },
          explanation: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["source", "target", "relation", "explanation", "evidence"],
      },
    },
  },
  required: ["nodes", "edges"],
} as const;


const EXTRACT_OUTPUT_CONTRACT = `
{
  "nodes": [
    {
      "id": "Entity Name",
      "type": "technology|method|author|application|concept",
      "displayLabel": "short readable label",
      "paperTitle": "full canonical paper title when this node is a paper",
      "themeLabel": "shared topic group for paper nodes",
      "themeDescription": "what that paper color means in the legend",
      "summary": "short grounded summary",
      "evidence": "quote or grounded excerpt",
      "paperLabel": "Paper 1"
    }
  ],
  "edges": [
    {
      "source": "Entity Name",
      "target": "Other Entity Name",
      "relation": "short verb phrase",
      "explanation": "concise grounded explanation",
      "evidence": "direct quote or grounded excerpt"
    }
  ]
}
`.trim();


const EXTRACT_SYSTEM_PROMPT = `
You extract a clean knowledge graph from uploaded research papers.
The frontend expects this exact GraphData shape:
${EXTRACT_OUTPUT_CONTRACT}
Return only a single valid JSON object. No markdown, no code fences, no commentary.

## Node types
- **Paper nodes**: one per uploaded PDF, representing the document itself.
- **Topic nodes**: key concepts, methods, technologies, applications, or authors extracted FROM the papers. These are the most important part of the graph — they show what each paper is about and create meaningful connections between papers.

## Rules for paper nodes
- Include exactly one paper-title node per uploaded PDF.
- Set the node id to the extracted paper title from the PDF content (first-page title).
- Never use filenames, author-year citations, or placeholders as paper node ids.
- Forbidden examples: "TITLE", "Paper 1", "aging i6 206135", "Levine et al., 2018".
- REQUIRED fields: id (real title), displayLabel (2-4 words), paperTitle (same as id), themeLabel, themeDescription, summary, evidence, paperLabel ("Paper 1", "Paper 2", etc.).

## Rules for topic nodes (critical for graph quality)
- For each paper, extract 5-8 topic nodes representing its key subjects: methods used, technologies mentioned, core concepts, important applications, or notable authors.
- Topic nodes should be specific and meaningful (e.g. "Epigenetic Clocks", "GWAS", "Telomere Length") not vague (e.g. "Analysis", "Results", "Data").
- If two papers discuss the same topic, they MUST share the same topic node (same id). This is the primary mechanism for showing cross-paper connections — shared nodes act as bridges between paper mothers.
- Topic nodes do NOT have paperLabel set — only paper nodes do.
- Allowed types: technology, method, author, application, concept.

## Rules for edges (MAXIMIZE CONNECTIONS)
- Connect each paper node to ALL of its topic nodes. Every paper MUST have edges to every one of its topic nodes.
- Shared topic nodes MUST connect to every paper that discusses them — this is what bridges the papers visually.
- Also connect paper nodes directly to each other when they share methods, goals, domains, or findings.
- Connect topic nodes to each other when they are related (method → "enables" → application, concept → "builds on" → concept). These cross-topic edges make the graph rich.
- The graph should feel dense and interconnected. Aim for at least 3x more edges than nodes.
- relation must be a short verb phrase: "uses", "proposes", "studies", "applies", "extends", "introduces", "shares methods with", "supports", "contrasts with", "enables", "builds on", "implements", "complements", "validates".
- explanation must be concise and grounded in the paper content.
- evidence must be a direct quote when available, otherwise a close grounded excerpt.
- Edges must only connect existing node ids.
- Avoid duplicate nodes, duplicate edges, vague labels, and unsupported claims.
- Always include both top-level keys: "nodes" and "edges" (use [] when empty).
`.trim();


const GRAPH_REPAIR_SYSTEM_PROMPT = `
You repair malformed research-graph output into valid GraphData JSON for a frontend.
Return only a single valid JSON object that matches the provided schema.
Preserve grounded paper titles, node summaries, evidence, and valid edges when possible.
Do not add commentary or code fences.
`.trim();

const ASK_SYSTEM_PROMPT = `
You answer questions about a relationship extracted from research papers.
Stay grounded in the provided edge context.
If the context is insufficient, say so plainly instead of inventing details.
Keep answers concise and useful.
Return plain text only.
`.trim();

type GeminiPart =
  | { text: string }
  | {
      inline_data: {
        mime_type: string;
        data: string;
      };
    };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
  };
};

type PaperAnalysis = {
  paperLabel: string;
  title: string;
  titleEvidence: string;
  displayLabel: string;
  themeLabel: string;
  themeDescription: string;
  summary: string;
  evidence: string;
};

type PaperTitleAnchor = {
  paperLabel: string;
  title: string;
  titleEvidence: string;
};

const DISPLAY_LABEL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "toward",
  "towards",
  "using",
  "via",
  "with",
]);

const PAPER_CORRELATION_STOP_WORDS = new Set([
  ...DISPLAY_LABEL_STOP_WORDS,
  "analysis",
  "approach",
  "based",
  "common",
  "data",
  "dataset",
  "datasets",
  "framework",
  "focus",
  "general",
  "method",
  "methods",
  "model",
  "models",
  "paper",
  "papers",
  "research",
  "result",
  "results",
  "share",
  "shared",
  "study",
  "system",
  "systems",
  "topic",
]);

const PAPER_THEME_PALETTE = [
  "#22d3ee",
  "#34d399",
  "#f59e0b",
  "#f97316",
  "#a78bfa",
  "#60a5fa",
  "#f472b6",
  "#84cc16",
  "#2dd4bf",
  "#fb7185",
];

export class RouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RouteError";
    this.status = status;
    Object.setPrototypeOf(this, RouteError.prototype);
  }
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new RouteError(
      500,
      "GEMINI_API_KEY is not configured. Add it to your local environment before uploading papers."
    );
  }

  return apiKey;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripPdfExtension(value: string): string {
  return value.replace(/\.pdf$/i, "").trim();
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildFileAliasSet(files: File[]): Set<string> {
  const aliasSet = new Set<string>();

  files.forEach((file) => {
    const full = normalizeAlias(file.name);
    const base = normalizeAlias(stripPdfExtension(file.name));

    if (full) aliasSet.add(full);
    if (base) aliasSet.add(base);
  });

  return aliasSet;
}

function normalizePaperLabel(value: string): string | null {
  const match = value.match(/^paper\s+(\d+)\b/i);
  if (!match) return null;
  return `Paper ${match[1]}`;
}

function buildFilenameAliasMap(
  files: File[],
  paperAnalyses: PaperAnalysis[]
): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const paperTitleByLabel = new Map(
    paperAnalyses.map((paper) => [paper.paperLabel, paper.title])
  );

  files.forEach((file, index) => {
    const label = paperTitleByLabel.get(`Paper ${index + 1}`) ?? "";
    const full = normalizeAlias(file.name);
    const base = normalizeAlias(stripPdfExtension(file.name));

    if (full) aliasMap.set(full, label);
    if (base) aliasMap.set(base, label);
  });

  return aliasMap;
}

function buildPaperLabelTitleMap(paperAnalyses: PaperAnalysis[]): Map<string, string> {
  const labelMap = new Map<string, string>();

  for (const paper of paperAnalyses) {
    const normalizedLabel = normalizeAlias(paper.paperLabel);
    if (normalizedLabel && paper.title) {
      labelMap.set(normalizedLabel, paper.title);
    }
  }

  return labelMap;
}

function buildPaperAliasMap(paperAnalyses: PaperAnalysis[]): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const paper of paperAnalyses) {
    const aliases = [paper.paperLabel, paper.title, paper.displayLabel];
    for (const alias of aliases) {
      const normalized = normalizeAlias(alias);
      if (normalized && paper.title) {
        aliasMap.set(normalized, paper.title);
      }
    }
  }

  return aliasMap;
}

function buildUndirectedEdgeKey(left: string, right: string): string {
  return [cleanText(left), cleanText(right)].sort((a, b) => a.localeCompare(b)).join("::");
}

function clipCorrelationEvidence(value: string, fallback: string): string {
  const cleaned = cleanText(value) || cleanText(fallback);
  if (!cleaned) return "";
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177).trimEnd()}...`;
}

function buildExistingPaperPairSet(
  paperAnalyses: PaperAnalysis[],
  existingEdges: GraphEdge[] = []
): Set<string> {
  const validTitles = new Set(
    paperAnalyses.map((paper) => cleanText(paper.title)).filter((title) => title.length > 0)
  );
  const connectedPairs = new Set<string>();

  existingEdges.forEach((edge) => {
    const source = cleanText(edge.source);
    const target = cleanText(edge.target);
    if (!source || !target || source === target) return;
    if (!validTitles.has(source) || !validTitles.has(target)) return;
    connectedPairs.add(buildUndirectedEdgeKey(source, target));
  });

  return connectedPairs;
}

function extractCorrelationKeywords(...values: string[]): string[] {
  const seen = new Set<string>();

  values.forEach((value) => {
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .replace(/-/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .filter((token) => !/^\d+$/.test(token))
      .filter((token) => !PAPER_CORRELATION_STOP_WORDS.has(token))
      .forEach((token) => seen.add(token));
  });

  return Array.from(seen);
}

type PaperPairInsight = {
  left: PaperAnalysis;
  right: PaperAnalysis;
  leftTitle: string;
  rightTitle: string;
  pairKey: string;
  sameTheme: boolean;
  sharedKeywords: string[];
  overlapScore: number;
  qualifies: boolean;
};

function buildPaperPairInsight(
  left: PaperAnalysis,
  right: PaperAnalysis,
  minimumSharedKeywords: number
): PaperPairInsight | null {
  const leftTitle = cleanText(left.title);
  const rightTitle = cleanText(right.title);
  if (!leftTitle || !rightTitle || leftTitle === rightTitle) return null;

  const leftTheme = cleanText(left.themeLabel);
  const rightTheme = cleanText(right.themeLabel);
  const normalizedLeftTheme = normalizeAlias(leftTheme);
  const normalizedRightTheme = normalizeAlias(rightTheme);
  const sameTheme =
    normalizedLeftTheme.length > 0 &&
    normalizedLeftTheme === normalizedRightTheme;

  const leftKeywords = extractCorrelationKeywords(
    left.title,
    left.displayLabel,
    left.themeLabel,
    left.themeDescription,
    left.summary
  );
  const rightKeywordSet = new Set(
    extractCorrelationKeywords(
      right.title,
      right.displayLabel,
      right.themeLabel,
      right.themeDescription,
      right.summary
    )
  );
  const sharedKeywords = leftKeywords.filter((keyword) => rightKeywordSet.has(keyword));
  const overlapScore = (sameTheme ? 3 : 0) + Math.min(sharedKeywords.length, 4);

  return {
    left,
    right,
    leftTitle,
    rightTitle,
    pairKey: buildUndirectedEdgeKey(leftTitle, rightTitle),
    sameTheme,
    sharedKeywords,
    overlapScore,
    qualifies: sameTheme || sharedKeywords.length >= minimumSharedKeywords,
  };
}

type PaperConnectionCandidate = PaperPairInsight;

export function buildPaperConnectionCandidates(
  paperAnalyses: PaperAnalysis[],
  existingEdges: GraphEdge[] = []
): PaperConnectionCandidate[] {
  if (paperAnalyses.length < 2) return [];

  const minimumSharedKeywords = paperAnalyses.length <= 3 ? 1 : 2;
  const connectedPairs = buildExistingPaperPairSet(paperAnalyses, existingEdges);
  const candidates: PaperConnectionCandidate[] = [];

  for (let leftIndex = 0; leftIndex < paperAnalyses.length; leftIndex += 1) {
    const left = paperAnalyses[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < paperAnalyses.length; rightIndex += 1) {
      const right = paperAnalyses[rightIndex];
      const insight = buildPaperPairInsight(left, right, minimumSharedKeywords);
      if (!insight) continue;
      if (connectedPairs.has(insight.pairKey)) continue;
      if (!insight.qualifies) continue;
      candidates.push(insight);
    }
  }

  if (candidates.length === 0 && paperAnalyses.length === 2) {
    const fallbackCandidate = buildPaperPairInsight(
      paperAnalyses[0],
      paperAnalyses[1],
      minimumSharedKeywords
    );
    if (
      fallbackCandidate &&
      !connectedPairs.has(fallbackCandidate.pairKey)
    ) {
      candidates.push(fallbackCandidate);
    }
  }

  return candidates.sort(
    (left, right) =>
      right.overlapScore - left.overlapScore ||
      left.leftTitle.localeCompare(right.leftTitle) ||
      left.rightTitle.localeCompare(right.rightTitle)
  );
}

export function buildHeuristicPaperConnections(
  paperAnalyses: PaperAnalysis[],
  existingEdges: GraphEdge[] = []
): GraphEdge[] {
  if (paperAnalyses.length < 2) return [];

  const connectedPairs = buildExistingPaperPairSet(paperAnalyses, existingEdges);
  const heuristicEdges: GraphEdge[] = [];
  const minimumSharedKeywords = paperAnalyses.length <= 3 ? 1 : 2;

  for (let leftIndex = 0; leftIndex < paperAnalyses.length; leftIndex += 1) {
    const left = paperAnalyses[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < paperAnalyses.length; rightIndex += 1) {
      const right = paperAnalyses[rightIndex];
      const insight = buildPaperPairInsight(left, right, minimumSharedKeywords);
      if (!insight) continue;
      if (connectedPairs.has(insight.pairKey) || !insight.qualifies) continue;

      const leftTheme = cleanText(left.themeLabel);
      const relation = insight.sameTheme
        ? "shares research focus with"
        : insight.sharedKeywords.length >= 2
        ? "overlaps with"
        : "aligns with";
      const leftLabel = cleanText(left.displayLabel) || insight.leftTitle;
      const rightLabel = cleanText(right.displayLabel) || insight.rightTitle;
      const sharedKeywordLabel = insight.sharedKeywords.slice(0, 4).join(", ");
      const explanation = insight.sameTheme
        ? `${leftLabel} and ${rightLabel} both center on ${leftTheme}, making the papers directly comparable.`
        : `${leftLabel} and ${rightLabel} overlap around ${sharedKeywordLabel}, linking their research contributions.`;
      const leftEvidence = clipCorrelationEvidence(left.evidence || left.summary, insight.leftTitle);
      const rightEvidence = clipCorrelationEvidence(right.evidence || right.summary, insight.rightTitle);
      const evidence = insight.sameTheme
        ? `Shared theme: ${leftTheme}. ${insight.leftTitle}: ${leftEvidence} ${insight.rightTitle}: ${rightEvidence}`
        : `Shared terms: ${sharedKeywordLabel}. ${insight.leftTitle}: ${leftEvidence} ${insight.rightTitle}: ${rightEvidence}`;

      heuristicEdges.push({
        source: insight.leftTitle,
        target: insight.rightTitle,
        relation,
        explanation,
        evidence,
      });
      connectedPairs.add(insight.pairKey);
    }
  }

  return heuristicEdges;
}

function buildFallbackDisplayLabel(title: string): string {
  const cleaned = title.replace(/[^\p{L}\p{N}\s-]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Paper";

  const words = cleaned.split(" ");
  const preferredWords = words.filter((word) => {
    const normalized = word.toLowerCase();
    return /[\p{L}\p{N}]/u.test(word) && !DISPLAY_LABEL_STOP_WORDS.has(normalized);
  });
  const sourceWords = preferredWords.length >= 2 ? preferredWords : words;
  const selectedWords = sourceWords.slice(0, Math.min(4, sourceWords.length));
  const label = selectedWords.join(" ").trim();

  return label || words.slice(0, Math.min(3, words.length)).join(" ") || "Paper";
}

function sanitizeDisplayLabel(
  value: string,
  title: string,
  fileAliasSet: Set<string>
): string {
  const cleaned = value.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
  const normalized = normalizeAlias(cleaned);
  const normalizedBase = normalizeAlias(stripPdfExtension(cleaned));

  if (
    !cleaned ||
    fileAliasSet.has(normalized) ||
    fileAliasSet.has(normalizedBase) ||
    /^paper\s+\d+\b/i.test(cleaned) ||
    /^title$/i.test(cleaned) ||
    /et al\.?/i.test(cleaned)
  ) {
    return buildFallbackDisplayLabel(title);
  }

  const compact = cleaned.split(" ").slice(0, 4).join(" ");
  return compact || buildFallbackDisplayLabel(title);
}

function sanitizeThemeLabel(value: string, fallbackTitle: string): string {
  const cleaned = value.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || /^paper\s+\d+\b/i.test(cleaned) || /^title$/i.test(cleaned)) {
    return buildFallbackDisplayLabel(fallbackTitle);
  }
  return cleaned.split(" ").slice(0, 4).join(" ");
}

function sanitizeThemeDescription(value: string, themeLabel: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return `${themeLabel} papers share a common research focus.`;
  }
  return cleaned;
}

function sanitizeExtractedPaperTitle(title: string, fileAliasSet: Set<string>): string {
  const cleaned = title
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const normalized = normalizeAlias(cleaned);
  const normalizedBase = normalizeAlias(stripPdfExtension(cleaned));
  const alphabeticCharacters = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const alphabeticWordCount = cleaned
    .split(/\s+/)
    .filter((token) => /[A-Za-z]{2,}/.test(token)).length;

  if (fileAliasSet.has(normalized) || fileAliasSet.has(normalizedBase)) return "";
  if (/\.pdf$/i.test(cleaned)) return "";
  if (/^title$/i.test(cleaned)) return "";
  if (/^paper\s+\d+\b/i.test(cleaned)) return "";
  if (/et al\.?/i.test(cleaned) && /\b(19|20)\d{2}\b/.test(cleaned)) return "";
  if (/\b\d{5,}\b/.test(cleaned) && cleaned.split(/\s+/).length <= 6) return "";
  if (alphabeticCharacters < 6 || alphabeticWordCount < 2) return "";

  return cleaned;
}

function sanitizeNodeId(
  id: string,
  filenameAliasMap: Map<string, string>,
  paperLabelTitleMap: Map<string, string>
): string {
  const cleaned = id
    .replace(/^paper filename:\s*/i, "")
    .replace(/^file(name)?\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return "";

  const normalized = normalizeAlias(cleaned);
  const normalizedPaperLabel = normalizePaperLabel(cleaned);
  if (normalizedPaperLabel) {
    const mappedTitle = paperLabelTitleMap.get(normalizeAlias(normalizedPaperLabel));
    if (mappedTitle) return mappedTitle;
  }

  const directPaperLabelTitle = paperLabelTitleMap.get(normalized);
  if (directPaperLabelTitle) return directPaperLabelTitle;

  const byAlias =
    filenameAliasMap.get(normalized) ??
    filenameAliasMap.get(normalizeAlias(stripPdfExtension(cleaned)));

  // Drop filename-like labels so they cannot appear as rendered node names.
  if (byAlias) return byAlias;
  if (/\.pdf$/i.test(cleaned)) return "";
  if (/et al\.?/i.test(cleaned) && /\b(19|20)\d{2}\b/.test(cleaned)) return "";
  if (/^[A-Za-z0-9_\-\s]+$/.test(cleaned) && cleaned.length < 6) return "";
  if (/\b\d{5,}\b/.test(cleaned) && cleaned.split(/\s+/).length <= 5) return "";
  if (/^title$/i.test(cleaned)) return "";

  return cleaned;
}


function buildPaperAnalysesFromGraph(
  graph: GraphData,
  fallbackAnalyses: PaperAnalysis[]
): PaperAnalysis[] {
  const graphNodesByPaperLabel = new Map(
    graph.nodes
      .filter((node) => cleanText(node.paperLabel))
      .map((node) => [normalizeAlias(node.paperLabel || ""), node] as const)
  );

  if (fallbackAnalyses.length === 0) {
    return graph.nodes.flatMap((node) => {
      const paperLabel = cleanText(node.paperLabel);
      const title = cleanText(node.paperTitle) || cleanText(node.id);

      if (!paperLabel || !title) return [];

      const displayLabel = cleanText(node.displayLabel) || buildFallbackDisplayLabel(title);
      const themeLabel = cleanText(node.themeLabel) || buildFallbackDisplayLabel(title);

      return [
        {
          paperLabel,
          title,
          titleEvidence: clipCorrelationEvidence(
            cleanText(node.evidence) || cleanText(node.summary),
            title
          ),
          displayLabel,
          themeLabel,
          themeDescription:
            cleanText(node.themeDescription) ||
            `${themeLabel} papers share a common research focus.`,
          summary: cleanText(node.summary),
          evidence: cleanText(node.evidence),
        },
      ];
    });
  }

  return fallbackAnalyses.flatMap((fallbackAnalysis) => {
    const graphNode = graphNodesByPaperLabel.get(normalizeAlias(fallbackAnalysis.paperLabel));
    const title =
      cleanText(graphNode?.paperTitle) ||
      cleanText(graphNode?.id) ||
      fallbackAnalysis.title;

    if (!title) return [];

    const displayLabel = cleanText(graphNode?.displayLabel) || fallbackAnalysis.displayLabel;
    const themeLabel = cleanText(graphNode?.themeLabel) || fallbackAnalysis.themeLabel;

    return [
      {
        paperLabel: fallbackAnalysis.paperLabel,
        title,
        titleEvidence:
          fallbackAnalysis.titleEvidence ||
          clipCorrelationEvidence(
            cleanText(graphNode?.evidence) || cleanText(graphNode?.summary),
            title
          ),
        displayLabel: displayLabel || buildFallbackDisplayLabel(title),
        themeLabel: themeLabel || buildFallbackDisplayLabel(title),
        themeDescription:
          cleanText(graphNode?.themeDescription) ||
          fallbackAnalysis.themeDescription ||
          `${themeLabel || buildFallbackDisplayLabel(title)} papers share a common research focus.`,
        summary: cleanText(graphNode?.summary) || fallbackAnalysis.summary,
        evidence:
          cleanText(graphNode?.evidence) ||
          fallbackAnalysis.evidence ||
          fallbackAnalysis.titleEvidence,
      },
    ];
  });
}


function normalizeNodeType(value: unknown): GraphNodeType {
  return NODE_TYPES.includes(value as GraphNodeType)
    ? (value as GraphNodeType)
    : "concept";
}

function extractText(response: GeminiResponse): string {
  const text = response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (text) return text;

  if (response.promptFeedback?.blockReason) {
    throw new RouteError(
      502,
      `Gemini blocked the request: ${response.promptFeedback.blockReason}.`
    );
  }

  throw new RouteError(502, "Gemini returned an empty response.");
}

function parseGraphJson(rawText: string): unknown {
  const candidates = new Set<string>();
  const trimmed = rawText.trim();
  if (trimmed) candidates.add(trimmed);

  const fencedMatches = rawText.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const block of fencedMatches) {
    const inner = block.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    if (inner) candidates.add(inner);
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const objectSlice = rawText.slice(firstBrace, lastBrace + 1).trim();
    if (objectSlice) candidates.add(objectSlice);
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof SyntaxError) {
    throw lastError;
  }

  throw new SyntaxError("Gemini response did not contain valid graph JSON.");
}

function normalizeGraph(
  rawGraph: unknown,
  files: File[],
  paperAnalyses: PaperAnalysis[]
): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const canonicalByLowercase = new Map<string, string>();
  const fileAliasSet = buildFileAliasSet(files);
  const paperLabelTitleMap = buildPaperLabelTitleMap(paperAnalyses);
  const paperAliasMap = buildPaperAliasMap(paperAnalyses);
  const filenameAliasMap = buildFilenameAliasMap(files, paperAnalyses);

  for (const paper of paperAnalyses) {
    const title = cleanText(paper.title);
    if (!title) continue;

    nodeMap.set(title, {
      id: title,
      type: "concept",
      displayLabel: cleanText(paper.displayLabel) || undefined,
      paperTitle: title,
      themeLabel: cleanText(paper.themeLabel) || undefined,
      themeDescription: cleanText(paper.themeDescription) || undefined,
      summary: cleanText(paper.summary) || undefined,
      evidence: cleanText(paper.evidence) || undefined,
      paperLabel: paper.paperLabel,
    });
    canonicalByLowercase.set(title.toLowerCase(), title);
    canonicalByLowercase.set(paper.paperLabel.toLowerCase(), title);
    if (paper.displayLabel) {
      canonicalByLowercase.set(paper.displayLabel.toLowerCase(), title);
    }
  }

  const rawNodes = Array.isArray((rawGraph as { nodes?: unknown[] })?.nodes)
    ? ((rawGraph as { nodes: unknown[] }).nodes ?? [])
    : [];

  // when no pre-extracted analyses exist, build label→title map from raw nodes
  if (paperAnalyses.length === 0) {
    for (const rawNode of rawNodes) {
      const label = cleanText((rawNode as { paperLabel?: unknown })?.paperLabel);
      const rawId = cleanText((rawNode as { id?: unknown })?.id);
      const rawPaperTitle = cleanText((rawNode as { paperTitle?: unknown })?.paperTitle);
      const rawDisplayLabel = cleanText((rawNode as { displayLabel?: unknown })?.displayLabel);
      if (!label) continue;
      const title = rawPaperTitle || rawId;
      if (!title) continue;
      const normalizedLabel = normalizeAlias(normalizePaperLabel(label) ?? label);
      if (!paperLabelTitleMap.has(normalizedLabel)) {
        paperLabelTitleMap.set(normalizedLabel, title);
      }
      // also register in alias map
      for (const alias of [label, title, rawDisplayLabel].filter(Boolean)) {
        const norm = normalizeAlias(alias);
        if (norm && !paperAliasMap.has(norm)) {
          paperAliasMap.set(norm, title);
        }
      }
    }
  }

  for (const rawNode of rawNodes) {
    const rawId = cleanText((rawNode as { id?: unknown })?.id);
    const rawPaperLabel =
      cleanText((rawNode as { paperLabel?: unknown })?.paperLabel) || undefined;
    const anchoredTitle = rawPaperLabel
      ? paperLabelTitleMap.get(
          normalizeAlias(normalizePaperLabel(rawPaperLabel) ?? rawPaperLabel)
        ) || ""
      : "";
    const id = anchoredTitle || sanitizeNodeId(rawId, filenameAliasMap, paperLabelTitleMap);
    if (!id) continue;

    const canonicalKey = id.toLowerCase();
    const existingId = canonicalByLowercase.get(canonicalKey);
    const existingNode = existingId ? nodeMap.get(existingId) : undefined;
    const rawSummary = cleanText((rawNode as { summary?: unknown })?.summary) || undefined;
    const rawEvidence = cleanText((rawNode as { evidence?: unknown })?.evidence) || undefined;
    const rawDisplayLabel =
      cleanText((rawNode as { displayLabel?: unknown })?.displayLabel) || undefined;
    const rawPaperTitle =
      cleanText((rawNode as { paperTitle?: unknown })?.paperTitle) || undefined;
    const rawThemeLabel =
      cleanText((rawNode as { themeLabel?: unknown })?.themeLabel) || undefined;
    const rawThemeDescription =
      cleanText((rawNode as { themeDescription?: unknown })?.themeDescription) || undefined;

    if (rawId && id) {
      canonicalByLowercase.set(rawId.toLowerCase(), id);
    }

    if (existingNode) {
      existingNode.type = existingNode.paperLabel ? "concept" : normalizeNodeType((rawNode as { type?: unknown })?.type);
      existingNode.displayLabel =
        existingNode.displayLabel ??
        (rawDisplayLabel
          ? sanitizeDisplayLabel(rawDisplayLabel, existingNode.id, fileAliasSet)
          : undefined);
      existingNode.paperTitle = existingNode.paperTitle ?? rawPaperTitle ?? existingNode.id;
      existingNode.themeLabel =
        existingNode.themeLabel ??
        (rawThemeLabel ? sanitizeThemeLabel(rawThemeLabel, existingNode.id) : undefined);
      existingNode.themeDescription =
        existingNode.themeDescription ??
        (rawThemeDescription
          ? sanitizeThemeDescription(
              rawThemeDescription,
              existingNode.themeLabel || buildFallbackDisplayLabel(existingNode.id)
            )
          : undefined);
      existingNode.summary = existingNode.summary ?? rawSummary;
      existingNode.evidence = existingNode.evidence ?? rawEvidence;
      existingNode.paperLabel = existingNode.paperLabel ?? rawPaperLabel;
      if (existingNode.displayLabel) {
        canonicalByLowercase.set(existingNode.displayLabel.toLowerCase(), existingNode.id);
      }
      if (rawId) {
        canonicalByLowercase.set(rawId.toLowerCase(), existingNode.id);
      }
      continue;
    }

    const node: GraphNode = {
      id,
      type: normalizeNodeType((rawNode as { type?: unknown })?.type),
      displayLabel: rawDisplayLabel
        ? sanitizeDisplayLabel(rawDisplayLabel, id, fileAliasSet)
        : undefined,
      paperTitle: rawPaperTitle || (rawPaperLabel ? id : undefined),
      themeLabel: rawThemeLabel ? sanitizeThemeLabel(rawThemeLabel, id) : undefined,
      themeDescription: rawThemeDescription
        ? sanitizeThemeDescription(
            rawThemeDescription,
            rawThemeLabel ? sanitizeThemeLabel(rawThemeLabel, id) : buildFallbackDisplayLabel(id)
          )
        : undefined,
      summary: rawSummary,
      evidence: rawEvidence,
      paperLabel: rawPaperLabel,
    };

    canonicalByLowercase.set(canonicalKey, id);
    if (node.displayLabel) {
      canonicalByLowercase.set(node.displayLabel.toLowerCase(), id);
    }
    if (rawId) {
      canonicalByLowercase.set(rawId.toLowerCase(), id);
    }
    nodeMap.set(id, node);
  }

  const resolveNodeId = (value: unknown): string | null => {
    const cleaned = cleanText(value);
    if (!cleaned) return null;
    const byPaperAlias = paperAliasMap.get(cleaned.toLowerCase());
    if (byPaperAlias && nodeMap.has(byPaperAlias)) return byPaperAlias;
    const sanitized = sanitizeNodeId(cleaned, filenameAliasMap, paperLabelTitleMap);
    if (sanitized && nodeMap.has(sanitized)) return sanitized;
    if (nodeMap.has(cleaned)) return cleaned;
    return (
      canonicalByLowercase.get(cleaned.toLowerCase()) ??
      canonicalByLowercase.get(sanitized.toLowerCase()) ??
      null
    );
  };

  const rawEdges = Array.isArray((rawGraph as { edges?: unknown[] })?.edges)
    ? ((rawGraph as { edges: unknown[] }).edges ?? [])
    : Array.isArray((rawGraph as { links?: unknown[] })?.links)
    ? ((rawGraph as { links: unknown[] }).links ?? [])
    : [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const rawEdge of rawEdges) {
    const source = resolveNodeId((rawEdge as { source?: unknown })?.source);
    const target = resolveNodeId((rawEdge as { target?: unknown })?.target);
    if (!source || !target || source === target) continue;

    const relation = cleanText((rawEdge as { relation?: unknown })?.relation);
    const explanation = cleanText(
      (rawEdge as { explanation?: unknown })?.explanation
    );
    const evidence = cleanText((rawEdge as { evidence?: unknown })?.evidence);

    if (!relation) {
      console.warn(`[normalizeGraph] Dropped edge (no relation): ${cleanText((rawEdge as { source?: unknown })?.source)} -> ${cleanText((rawEdge as { target?: unknown })?.target)}`);
      continue;
    }

    // fill in missing explanation/evidence with defaults so we don't drop valid edges
    const resolvedExplanation = explanation || `${source} ${relation} ${target}.`;
    const resolvedEvidence = evidence || "Extracted from paper content.";

    const edgeKey = `${source}::${target}::${relation.toLowerCase()}`;
    if (edgeMap.has(edgeKey)) continue;

    edgeMap.set(edgeKey, {
      source,
      target,
      relation,
      explanation: resolvedExplanation,
      evidence: resolvedEvidence,
    });
  }

  // log edges that Gemini returned but we couldn't resolve
  for (const rawEdge of rawEdges) {
    const rawSource = cleanText((rawEdge as { source?: unknown })?.source);
    const rawTarget = cleanText((rawEdge as { target?: unknown })?.target);
    const resolvedSource = resolveNodeId(rawSource);
    const resolvedTarget = resolveNodeId(rawTarget);
    if (!resolvedSource || !resolvedTarget) {
      console.warn(`[normalizeGraph] Unresolved edge: "${rawSource}" (${resolvedSource ? "ok" : "FAIL"}) -> "${rawTarget}" (${resolvedTarget ? "ok" : "FAIL"})`);
    }
  }

  const graph: GraphData = {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };

  const existingPaperLabels = new Set(
    graph.nodes
      .map((node) => cleanText(node.paperLabel))
      .filter((label) => label.length > 0)
  );

  files.forEach((file, index) => {
    const paperLabel = `Paper ${index + 1}`;
    if (existingPaperLabels.has(paperLabel)) return;

    const analysis = paperAnalyses.find(
      (paper) => normalizeAlias(paper.paperLabel) === normalizeAlias(paperLabel)
    );

    graph.nodes.push({
      id: analysis?.title || `Paper ${index + 1} (title unavailable)`,
      type: "concept",
      displayLabel:
        analysis?.displayLabel || `Paper ${index + 1}`,
      paperTitle: analysis?.title || `Paper ${index + 1} (title unavailable)`,
      themeLabel: analysis?.themeLabel || `Paper ${index + 1}`,
      themeDescription:
        analysis?.themeDescription ||
        `${analysis?.themeLabel || `Paper ${index + 1}`} papers share a common research focus.`,
      summary:
        analysis?.summary ||
        "Gemini did not return a reliable paper-title node for this upload.",
      evidence: analysis?.evidence || `Uploaded source: ${file.name}`,
      paperLabel,
    });
    existingPaperLabels.add(paperLabel);
  });

  if (graph.nodes.length === 0) {
    throw new RouteError(
      422,
      "Gemini did not extract any graph entities from those PDFs. Try clearer research papers or fewer files."
    );
  }

  return graph;
}

function buildThemeColorMap(graph: GraphData): Map<string, string> {
  const themeColorMap = new Map<string, string>();
  let colorIndex = 0;

  // first pass: assign colors by themeLabel for papers that have one
  for (const node of graph.nodes) {
    if (!node.paperLabel) continue;
    const theme = normalizeAlias(node.themeLabel || "");
    if (theme && !themeColorMap.has(theme)) {
      themeColorMap.set(theme, PAPER_THEME_PALETTE[colorIndex % PAPER_THEME_PALETTE.length]);
      colorIndex++;
    }
  }

  // second pass: papers without themeLabel get a color keyed by paperLabel
  for (const node of graph.nodes) {
    if (!node.paperLabel) continue;
    const theme = normalizeAlias(node.themeLabel || "");
    if (theme && themeColorMap.has(theme)) continue;
    // use paperLabel as fallback key
    const fallbackKey = `__paper__${normalizeAlias(node.paperLabel)}`;
    if (!themeColorMap.has(fallbackKey)) {
      themeColorMap.set(fallbackKey, PAPER_THEME_PALETTE[colorIndex % PAPER_THEME_PALETTE.length]);
      colorIndex++;
    }
  }

  return themeColorMap;
}

function resolvePaperColor(node: GraphNode, themeColorMap: Map<string, string>): string {
  const themeKey = normalizeAlias(node.themeLabel || "");
  if (themeKey && themeColorMap.has(themeKey)) return themeColorMap.get(themeKey)!;
  const fallbackKey = `__paper__${normalizeAlias(node.paperLabel || "")}`;
  if (themeColorMap.has(fallbackKey)) return themeColorMap.get(fallbackKey)!;
  return PAPER_THEME_PALETTE[0];
}

function applyPaperThemeColors(graph: GraphData): GraphData {
  const themeColorMap = buildThemeColorMap(graph);

  // build a map: paper node id -> assigned color
  const paperNodeColors = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!node.paperLabel) continue;
    paperNodeColors.set(node.id, resolvePaperColor(node, themeColorMap));
  }

  if (paperNodeColors.size === 0) return graph;

  // for each edge from a paper node to a topic node, record ALL paper colors per topic
  const topicPaperColors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sourceColor = paperNodeColors.get(edge.source);
    const targetColor = paperNodeColors.get(edge.target);
    // paper -> topic
    if (sourceColor && !paperNodeColors.has(edge.target)) {
      if (!topicPaperColors.has(edge.target)) topicPaperColors.set(edge.target, []);
      const colors = topicPaperColors.get(edge.target)!;
      if (!colors.includes(sourceColor)) colors.push(sourceColor);
    }
    // topic -> paper (reverse direction edges)
    if (targetColor && !paperNodeColors.has(edge.source)) {
      if (!topicPaperColors.has(edge.source)) topicPaperColors.set(edge.source, []);
      const colors = topicPaperColors.get(edge.source)!;
      if (!colors.includes(targetColor)) colors.push(targetColor);
    }
  }

  // For shared topics (connected to multiple papers), use the first paper's color
  // but at reduced opacity to signal it's shared — we encode this as the first color
  const topicColorMap = new Map<string, string>();
  for (const [topicId, colors] of topicPaperColors) {
    topicColorMap.set(topicId, colors[0]);
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      // paper nodes always get their theme color
      if (node.paperLabel) {
        return { ...node, colorHex: paperNodeColors.get(node.id) || PAPER_THEME_PALETTE[0] };
      }
      // topic nodes inherit color from their parent paper
      const inherited = topicColorMap.get(node.id);
      if (inherited) {
        return { ...node, colorHex: inherited };
      }
      return node;
    }),
  };
}

function mergeGraphEdges(graph: GraphData, additionalEdges: GraphEdge[]): GraphData {
  if (additionalEdges.length === 0) return graph;

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeMap = new Map<string, GraphEdge>();

  for (const edge of graph.edges) {
    const source = cleanText(edge.source);
    const target = cleanText(edge.target);
    const relation = cleanText(edge.relation);
    const explanation = cleanText(edge.explanation);
    const evidence = cleanText(edge.evidence);

    if (!source || !target || source === target) continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    if (!relation || !explanation || !evidence) continue;

    edgeMap.set(`${source}::${target}::${relation.toLowerCase()}`, {
      source,
      target,
      relation,
      explanation,
      evidence,
    });
  }

  for (const edge of additionalEdges) {
    const source = cleanText(edge.source);
    const target = cleanText(edge.target);
    const relation = cleanText(edge.relation);
    const explanation = cleanText(edge.explanation);
    const evidence = cleanText(edge.evidence);

    if (!source || !target || source === target) continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    if (!relation || !explanation || !evidence) continue;

    // Let the dedicated paper-comparison pass replace weaker duplicates.
    edgeMap.set(`${source}::${target}::${relation.toLowerCase()}`, {
      source,
      target,
      relation,
      explanation,
      evidence,
    });
  }

  return {
    ...graph,
    edges: Array.from(edgeMap.values()),
  };
}

async function callGemini(requestBody: object): Promise<GeminiResponse> {
  const apiKey = getApiKey();
  const response = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    throw new RouteError(
      response.status,
      payload?.error?.message || "Gemini request failed."
    );
  }

  if (!payload) {
    throw new RouteError(502, "Gemini returned an unreadable response.");
  }

  return payload;
}

function validatePdfFiles(files: File[]): void {
  if (files.length === 0) {
    throw new RouteError(400, "Upload at least one PDF.");
  }

  if (files.length > MAX_FILE_COUNT) {
    throw new RouteError(400, `Upload no more than ${MAX_FILE_COUNT} PDFs at a time.`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new RouteError(
      413,
      "The uploaded PDFs are too large for the current Gemini request path. Keep the total upload under 18 MB."
    );
  }

  for (const file of files) {
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw new RouteError(400, `${file.name} is not a PDF.`);
    }
  }
}

async function fileToInlinePart(file: File): Promise<GeminiPart> {
  const buffer = await file.arrayBuffer();
  return {
    inline_data: {
      mime_type: "application/pdf",
      data: Buffer.from(buffer).toString("base64"),
    },
  };
}

async function buildFileParts(files: File[]): Promise<GeminiPart[]> {
  const fileParts = await Promise.all(
    files.map(async (file, index) => {
      const inlinePart = await fileToInlinePart(file);
      return [
        {
          text: `Attached paper ${index + 1}. Internal filename (reference only, never use as node label): ${file.name}`,
        } as GeminiPart,
        inlinePart,
      ];
    })
  );

  return fileParts.flat();
}


function withThinkingConfig<T extends Record<string, unknown>>(
  config: T,
  _thinkingLevel: ThinkingLevel
): T {
  return config;
}


async function repairGraphJson(
  rawText: string,
  paperAnalyses: PaperAnalysis[]
): Promise<unknown> {
  const titleAnchors =
    paperAnalyses.length > 0
      ? paperAnalyses
          .map((paper) => `${paper.paperLabel}: ${paper.title}`)
          .join("\n")
      : "No extracted paper titles available.";

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: GRAPH_REPAIR_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Repair the malformed graph output below into valid GraphData JSON.
Use these paper titles exactly when they refer to the uploaded papers:
${titleAnchors}

Malformed output:
${rawText}
`.trim(),
          },
        ],
      },
    ],
    generationConfig: withThinkingConfig({
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: GRAPH_RESPONSE_SCHEMA,
    }, "minimal"),
  });

  return parseGraphJson(extractText(response));
}

export async function extractGraphFromPdfs(files: File[]): Promise<GraphData> {
  validatePdfFiles(files);
  const fileParts = await buildFileParts(files);

  // single Gemini call — titles, topics, and all edges in one shot
  const parts: GeminiPart[] = [
    {
      text: `
Extract a knowledge graph from the uploaded research papers.

REQUIRED OUTPUT:
- One paper node per PDF (use the real title from the first page as the node id, never "Paper 1" or filenames)
- 5 to 8 topic nodes per paper (specific concepts, methods, technologies from that paper)
- Edges connecting every paper to all its topic nodes
- Shared topic nodes (same id) when both papers discuss the same concept

Each paper node MUST have: id (real title), type, displayLabel, paperTitle, themeLabel, themeDescription, summary, evidence, paperLabel ("Paper 1" etc.)
Each topic node MUST have: id, type, displayLabel, summary, evidence. Do NOT set paperLabel on topic nodes.
Each edge MUST have: source, target, relation, explanation, evidence.
`.trim(),
    },
    ...fileParts,
  ];

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: EXTRACT_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: withThinkingConfig({
      temperature: 0,
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
      responseSchema: GRAPH_RESPONSE_SCHEMA,
    }, "minimal"),
  });

  const rawText = extractText(response);
  let rawGraph: unknown;

  try {
    rawGraph = parseGraphJson(rawText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    rawGraph = await repairGraphJson(rawText, []);
  }

  const graph = normalizeGraph(rawGraph, files, []);

  // add heuristic paper-to-paper edges for any pairs Gemini missed (no extra API call)
  const paperAnalyses = buildPaperAnalysesFromGraph(graph, []);
  let enrichedGraph = graph;
  if (paperAnalyses.length >= 2) {
    const heuristicEdges = buildHeuristicPaperConnections(paperAnalyses, graph.edges);
    enrichedGraph = mergeGraphEdges(graph, heuristicEdges);
  }

  // guarantee every shared topic node is connected to all paper mothers
  enrichedGraph = enforcePaperToTopicEdges(enrichedGraph);

  return applyPaperThemeColors(enrichedGraph);
}

/**
 * Guarantees every topic node is connected to at least one paper node.
 * Orphaned topics get wired to all papers. Topics already connected to
 * some papers get wired to the remaining ones (bridge enforcement).
 */
function enforcePaperToTopicEdges(graph: GraphData): GraphData {
  const paperNodes = graph.nodes.filter((n) => Boolean(n.paperLabel));
  const topicNodes = graph.nodes.filter((n) => !n.paperLabel);

  if (paperNodes.length === 0 || topicNodes.length === 0) return graph;

  const existingEdgeKeys = new Set(
    graph.edges.flatMap((e) => [`${e.source}::${e.target}`, `${e.target}::${e.source}`])
  );

  // Track which papers each topic is already connected to
  const topicToPapers = new Map<string, Set<string>>();
  for (const topic of topicNodes) {
    topicToPapers.set(topic.id, new Set());
  }
  for (const edge of graph.edges) {
    if (topicToPapers.has(edge.target) && paperNodes.some((p) => p.id === edge.source)) {
      topicToPapers.get(edge.target)!.add(edge.source);
    }
    if (topicToPapers.has(edge.source) && paperNodes.some((p) => p.id === edge.target)) {
      topicToPapers.get(edge.source)!.add(edge.target);
    }
  }

  const newEdges: GraphEdge[] = [];

  for (const topic of topicNodes) {
    const connectedPapers = topicToPapers.get(topic.id) ?? new Set();

    for (const paper of paperNodes) {
      if (connectedPapers.has(paper.id)) continue;
      const key = `${paper.id}::${topic.id}`;
      if (existingEdgeKeys.has(key)) continue;

      newEdges.push({
        source: paper.id,
        target: topic.id,
        relation: "discusses",
        explanation: `${paper.displayLabel || paper.id} addresses ${topic.displayLabel || topic.id} as a key concept.`,
        evidence: topic.evidence || paper.evidence || "Extracted from paper content.",
      });
      existingEdgeKeys.add(key);
    }
  }

  if (newEdges.length === 0) return graph;
  return { ...graph, edges: [...graph.edges, ...newEdges] };
}

export async function askGeminiAboutEdge(
  question: string,
  context: GraphEdge
): Promise<AskResponse> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    throw new RouteError(400, "Question cannot be empty.");
  }

  const source = cleanText(context.source);
  const target = cleanText(context.target);
  const relation = cleanText(context.relation);
  const explanation = cleanText(context.explanation);
  const evidence = cleanText(context.evidence);

  if (!source || !target || !relation || !explanation || !evidence) {
    throw new RouteError(400, "Edge context is incomplete.");
  }

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: ASK_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Question: ${trimmedQuestion}

Edge context:
- Source: ${source}
- Target: ${target}
- Relation: ${relation}
- Explanation: ${explanation}
- Evidence: ${evidence}
`.trim(),
          },
        ],
      },
    ],
    generationConfig: withThinkingConfig({
      temperature: 0.3,
      maxOutputTokens: 512,
    }, "minimal"),
  });

  return {
    answer: extractText(response),
  };
}
