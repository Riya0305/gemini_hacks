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

const PAPER_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    papers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paperLabel: { type: "string" },
          title: { type: "string" },
          titleEvidence: { type: "string" },
          displayLabel: { type: "string" },
          themeLabel: { type: "string" },
          themeDescription: { type: "string" },
          summary: { type: "string" },
          evidence: { type: "string" },
          topics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string", enum: [...NODE_TYPES] },
                displayLabel: { type: "string" },
                relation: { type: "string" },
                summary: { type: "string" },
                evidence: { type: "string" },
              },
              required: ["id", "type", "displayLabel", "relation", "summary", "evidence"],
            },
          },
        },
        required: [
          "paperLabel",
          "title",
          "titleEvidence",
          "displayLabel",
          "themeLabel",
          "themeDescription",
          "summary",
          "evidence",
          "topics",
        ],
      },
    },
  },
  required: ["papers"],
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
- Include: displayLabel (2-4 words), paperTitle, themeLabel, themeDescription, summary, evidence, paperLabel ("Paper 1", etc.).
- The paper summary is metadata on the paper node. It does NOT replace the extra topic nodes.

## Rules for topic nodes (critical for graph quality)
- For each paper, extract 4-8 topic nodes representing its key subjects: methods used, technologies mentioned, core concepts, important applications, or notable authors.
- Topic nodes should be specific and meaningful (e.g. "Epigenetic Clocks", "GWAS", "Telomere Length") not vague (e.g. "Analysis", "Results", "Data").
- If two papers discuss the same topic, they MUST share the same topic node (same id). This is how cross-paper connections form naturally. Actively look for shared topics across papers.
- Topic nodes do NOT have paperLabel set — only paper nodes do.
- Allowed types: technology, method, author, application, concept.

## Rules for edges (MAXIMIZE CONNECTIONS)
- Connect each paper node to ALL of its topic nodes (e.g. paper → "uses" → method, paper → "studies" → concept). Every paper MUST have edges to every one of its topic nodes.
- Also connect paper nodes directly to each other when they share methods, goals, domains, or findings (e.g. paper → "extends" → paper, paper → "shares methods with" → paper).
- Connect topic nodes to each other when they are related (e.g. method → "enables" → application, concept → "builds on" → concept, technology → "implements" → method). These cross-topic edges create a rich, interconnected graph.
- The graph should feel dense and interconnected, not sparse. Aim for at least 2-3x more edges than nodes.
- relation must be a short verb phrase: "uses", "proposes", "studies", "applies", "extends", "introduces", "shares methods with", "supports", "contrasts with", "enables", "builds on", "implements", "complements".
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

const PAPER_ANALYSIS_SYSTEM_PROMPT = `
You extract canonical paper metadata from uploaded research PDFs.
Return only one valid JSON object with this exact shape:
{
  "papers": [
    {
      "paperLabel": "Paper 1",
      "title": "full paper title from the PDF itself",
      "titleEvidence": "short excerpt or evidence for the detected title",
      "displayLabel": "2-4 word readable graph label",
      "themeLabel": "2-4 word shared topic label",
      "themeDescription": "what that paper's theme means",
      "summary": "1-2 sentence grounded paper summary",
      "evidence": "quote or grounded excerpt from the paper",
      "topics": [
        {
          "id": "shared topic or method name",
          "type": "technology|method|author|application|concept",
          "displayLabel": "short graph label",
          "relation": "uses|studies|applies|develops|authored by",
          "summary": "why this topic matters in the paper",
          "evidence": "grounded excerpt for this topic"
        }
      ]
    }
  ]
}

Rules:
- Return exactly one paper object per uploaded PDF, in upload order.
- Use paperLabel exactly as "Paper 1", "Paper 2", etc.
- Read the title from the PDF content itself, preferably the first-page title/header.
- Never use the filename, "TITLE", "Paper 1", author-year citations, or OCR junk as the title.
- displayLabel must be short and readable on a graph node.
- themeLabel should capture the paper's main research cluster.
- summary and evidence must describe that specific paper, not the paper set as a whole.
- Include 3-6 topic objects per paper.
- topics are the extra graph nodes for that paper: methods, concepts, technologies, applications, or authors.
- Reuse the same topic id across papers when the same concept appears in multiple uploads.
- topics must not repeat the paper title, paper label, filename, or generic placeholders.
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
  topics: PaperTopic[];
};

type PaperTopic = {
  id: string;
  type: GraphNodeType;
  displayLabel: string;
  relation: string;
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

const TOPIC_SIGNATURE_STOP_WORDS = new Set([
  ...DISPLAY_LABEL_STOP_WORDS,
  "analysis",
  "analyses",
  "approach",
  "approaches",
  "data",
  "finding",
  "findings",
  "implication",
  "implications",
  "insight",
  "insights",
  "method",
  "methods",
  "model",
  "models",
  "paper",
  "papers",
  "result",
  "results",
  "study",
  "studies",
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

function buildPaperTitleAnchors(paperAnalyses: PaperAnalysis[]): PaperTitleAnchor[] {
  return paperAnalyses.map((paper) => ({
    paperLabel: paper.paperLabel,
    title: paper.title,
    titleEvidence: paper.titleEvidence,
  }));
}

function buildPaperAnchorText(paperAnalyses: PaperAnalysis[]): string {
  const anchors = buildPaperTitleAnchors(paperAnalyses);
  if (anchors.length === 0) {
    return "No extracted paper titles available.";
  }

  return anchors
    .map(
      (paper) =>
        `${paper.paperLabel}: ${paper.title}${
          paper.titleEvidence ? ` | title evidence: ${paper.titleEvidence}` : ""
        }`
    )
    .join("\n");
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

function buildAllPaperPairInsights(
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
      candidates.push(insight);
    }
  }

  return candidates.sort(
    (left, right) =>
      right.overlapScore - left.overlapScore ||
      left.leftTitle.localeCompare(right.leftTitle) ||
      left.rightTitle.localeCompare(right.rightTitle)
  );
}

function buildPaperConnectionEdge(insight: PaperConnectionCandidate): GraphEdge {
  const leftTheme = cleanText(insight.left.themeLabel);
  const leftLabel = cleanText(insight.left.displayLabel) || insight.leftTitle;
  const rightLabel = cleanText(insight.right.displayLabel) || insight.rightTitle;
  const sharedKeywordLabel = insight.sharedKeywords.slice(0, 4).join(", ");
  const relation = insight.sameTheme
    ? "shares research focus with"
    : insight.sharedKeywords.length >= 2
    ? "overlaps with"
    : insight.sharedKeywords.length === 1
    ? "connects through"
    : "aligns with";
  const explanation = insight.sameTheme
    ? `${leftLabel} and ${rightLabel} both center on ${leftTheme}, making the papers directly comparable.`
    : insight.sharedKeywords.length > 0
    ? `${leftLabel} and ${rightLabel} both reference ${sharedKeywordLabel}, linking otherwise separate parts of the graph.`
    : `${leftLabel} and ${rightLabel} should be compared directly as part of the same uploaded research set.`;
  const leftEvidence = clipCorrelationEvidence(
    insight.left.evidence || insight.left.summary,
    insight.leftTitle
  );
  const rightEvidence = clipCorrelationEvidence(
    insight.right.evidence || insight.right.summary,
    insight.rightTitle
  );
  const evidence = insight.sameTheme
    ? `Shared theme: ${leftTheme}. ${insight.leftTitle}: ${leftEvidence} ${insight.rightTitle}: ${rightEvidence}`
    : insight.sharedKeywords.length > 0
    ? `Shared terms: ${sharedKeywordLabel}. ${insight.leftTitle}: ${leftEvidence} ${insight.rightTitle}: ${rightEvidence}`
    : `Uploaded together for comparison. ${insight.leftTitle}: ${leftEvidence} ${insight.rightTitle}: ${rightEvidence}`;

  return {
    source: insight.leftTitle,
    target: insight.rightTitle,
    relation,
    explanation,
    evidence,
  };
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

      heuristicEdges.push(buildPaperConnectionEdge(insight));
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

function sanitizePaperTopicId(
  value: string,
  paperTitle: string,
  fileAliasSet: Set<string>
): string {
  const cleaned = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const normalized = normalizeAlias(cleaned);
  const normalizedBase = normalizeAlias(stripPdfExtension(cleaned));
  if (fileAliasSet.has(normalized) || fileAliasSet.has(normalizedBase)) return "";
  if (normalizeAlias(cleaned) === normalizeAlias(paperTitle)) return "";
  if (/^paper\s+\d+\b/i.test(cleaned)) return "";
  if (/^title$/i.test(cleaned)) return "";
  if (/\.pdf$/i.test(cleaned)) return "";

  return cleaned;
}

function buildDefaultPaperTopicRelation(type: GraphNodeType): string {
  switch (type) {
    case "method":
    case "technology":
      return "uses";
    case "application":
      return "applies to";
    case "author":
      return "authored by";
    default:
      return "studies";
  }
}

function normalizePaperTopics(
  rawTopics: unknown,
  paperTitle: string,
  fileAliasSet: Set<string>,
  fallbackSummary: string,
  fallbackEvidence: string
): PaperTopic[] {
  if (!Array.isArray(rawTopics)) return [];

  const topicMap = new Map<string, PaperTopic>();
  rawTopics.forEach((rawTopic) => {
    if (!rawTopic || typeof rawTopic !== "object") return;

    const candidate = rawTopic as Record<string, unknown>;
    const rawId =
      cleanText(candidate.id) ||
      cleanText(candidate.topic) ||
      cleanText(candidate.name) ||
      cleanText(candidate.title);
    const id = sanitizePaperTopicId(rawId, paperTitle, fileAliasSet);
    if (!id) return;

    const type = normalizeNodeType(candidate.type);
    const displayLabel = sanitizeDisplayLabel(
      cleanText(candidate.displayLabel) || id,
      id,
      fileAliasSet
    );
    const relation = cleanText(candidate.relation) || buildDefaultPaperTopicRelation(type);
    const summary =
      cleanText(candidate.summary) ||
      `${id} is a key ${type} discussed in ${paperTitle}.`;
    const evidence = cleanText(candidate.evidence) || fallbackEvidence || fallbackSummary;
    const key = normalizeAlias(id);

    if (!topicMap.has(key)) {
      topicMap.set(key, {
        id,
        type,
        displayLabel,
        relation,
        summary,
        evidence,
      });
    }
  });

  return Array.from(topicMap.values()).slice(0, 6);
}

export function normalizePaperAnalyses(
  rawValue: unknown,
  files: File[]
): PaperAnalysis[] {
  const fileAliasSet = buildFileAliasSet(files);
  const rawPapers = Array.isArray((rawValue as { papers?: unknown[] })?.papers)
    ? ((rawValue as { papers: unknown[] }).papers ?? [])
    : Array.isArray(rawValue)
    ? (rawValue as unknown[])
    : [];

  const paperByLabel = new Map<string, Record<string, unknown>>();
  rawPapers.forEach((rawPaper, index) => {
    if (!rawPaper || typeof rawPaper !== "object") return;

    const candidate = rawPaper as Record<string, unknown>;
    const rawLabel = cleanText(candidate.paperLabel);
    const normalizedLabel = normalizePaperLabel(rawLabel) || `Paper ${index + 1}`;
    const key = normalizeAlias(normalizedLabel);

    if (!paperByLabel.has(key)) {
      paperByLabel.set(key, candidate);
    }
  });

  const seenTitles = new Map<string, number>();

  return files.map((file, index) => {
    const paperLabel = `Paper ${index + 1}`;
    const rawPaper =
      paperByLabel.get(normalizeAlias(paperLabel)) ??
      (rawPapers[index] && typeof rawPapers[index] === "object"
        ? (rawPapers[index] as Record<string, unknown>)
        : {});

    const extractedTitle = sanitizeExtractedPaperTitle(
      cleanText(rawPaper.title) ||
        cleanText(rawPaper.paperTitle) ||
        cleanText(rawPaper.id),
      fileAliasSet
    );

    let title = extractedTitle || `${paperLabel} (title unavailable)`;
    const titleKey = normalizeAlias(title);
    const duplicateCount = seenTitles.get(titleKey) ?? 0;
    seenTitles.set(titleKey, duplicateCount + 1);
    if (duplicateCount > 0) {
      title = `${title} [${paperLabel}]`;
    }

    const fallbackDisplayLabel = buildFallbackDisplayLabel(title);
    const titleEvidence = clipCorrelationEvidence(
      cleanText(rawPaper.titleEvidence) ||
        cleanText(rawPaper.evidence) ||
        cleanText(rawPaper.summary) ||
        title,
      title
    );
    const themeLabel = sanitizeThemeLabel(
      cleanText(rawPaper.themeLabel) || fallbackDisplayLabel,
      title
    );
    const fallbackSummary =
      cleanText(rawPaper.summary) ||
      `Gemini did not return a grounded summary for ${title}.`;
    const fallbackEvidence =
      cleanText(rawPaper.evidence) ||
      titleEvidence ||
      `Uploaded source: ${file.name}`;

    return {
      paperLabel,
      title,
      titleEvidence,
      displayLabel: sanitizeDisplayLabel(
        cleanText(rawPaper.displayLabel) || fallbackDisplayLabel,
        title,
        fileAliasSet
      ),
      themeLabel,
      themeDescription: sanitizeThemeDescription(
        cleanText(rawPaper.themeDescription),
        themeLabel
      ),
      summary: fallbackSummary,
      evidence: fallbackEvidence,
      topics: normalizePaperTopics(
        (rawPaper as { topics?: unknown }).topics,
        title,
        fileAliasSet,
        fallbackSummary,
        fallbackEvidence
      ),
    };
  });
}

function buildFallbackPaperAnalyses(files: File[]): PaperAnalysis[] {
  return files.map((file, index) => {
    const paperLabel = `Paper ${index + 1}`;
    const title = `${paperLabel} (title unavailable)`;

    return {
      paperLabel,
      title,
      titleEvidence: `Uploaded source: ${file.name}`,
      displayLabel: paperLabel,
      themeLabel: paperLabel,
      themeDescription:
        "This paper needs reprocessing before a reliable theme can be assigned.",
      summary:
        "Gemini did not return a reliable paper-level analysis for this upload.",
      evidence: `Uploaded source: ${file.name}`,
      topics: [],
    };
  });
}

function singularizeTopicToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function isAcronymLikeLabel(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9]+/g, "");
  return (
    compact.length >= 2 &&
    compact.length <= 12 &&
    compact === compact.toUpperCase() &&
    /[A-Z]/.test(compact)
  );
}

function buildTopicSignatures(node: GraphNode): string[] {
  const signatures = new Set<string>();
  const values = [cleanText(node.id), cleanText(node.displayLabel)].filter((value) => value.length > 0);

  values.forEach((value) => {
    const normalizedWords = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .replace(/-/g, " ")
      .split(/\s+/)
      .map((token) => singularizeTopicToken(token.trim()))
      .filter((token) => token.length >= 2);

    if (normalizedWords.length > 0) {
      signatures.add(`label:${normalizedWords.join(" ")}`);
    }

    const coreWords = normalizedWords.filter(
      (token) => !TOPIC_SIGNATURE_STOP_WORDS.has(token)
    );
    if (coreWords.length > 0) {
      signatures.add(`core:${coreWords.join(" ")}`);
      const acronymWords = normalizedWords.filter(
        (token) => !DISPLAY_LABEL_STOP_WORDS.has(token)
      );
      const acronym = acronymWords.map((token) => token[0]).join("").toUpperCase();
      if (acronym.length >= 2 && acronym.length <= 10) {
        signatures.add(`acro:${acronym}`);
      }
    }

    if (isAcronymLikeLabel(value)) {
      signatures.add(`acro:${value.replace(/[^A-Za-z0-9]+/g, "").toUpperCase()}`);
    }
  });

  return Array.from(signatures);
}

function chooseCanonicalTopicId(nodes: GraphNode[]): string {
  const labels = Array.from(
    new Set(
      nodes.flatMap((node) =>
        [cleanText(node.id), cleanText(node.displayLabel)].filter((value) => value.length > 0)
      )
    )
  );

  const scoreLabel = (label: string): number => {
    let score = 0;
    if (!isAcronymLikeLabel(label)) score += 20;
    const wordCount = label.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 2) score += 10;
    if (label.length >= 8 && label.length <= 48) score += 8;
    return score;
  };

  return labels.sort((left, right) => scoreLabel(right) - scoreLabel(left))[0] || nodes[0]?.id || "Concept";
}

function chooseTopicDisplayLabel(nodes: GraphNode[], canonicalId: string): string | undefined {
  const labels = Array.from(
    new Set(
      nodes.flatMap((node) =>
        [cleanText(node.displayLabel), cleanText(node.id)].filter((value) => value.length > 0)
      )
    )
  );

  const scoreLabel = (label: string): number => {
    let score = 0;
    if (isAcronymLikeLabel(label)) score += 18;
    const wordCount = label.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 4) score += 12;
    if (label.length <= 24) score += 6;
    return score;
  };

  const best = labels.sort((left, right) => scoreLabel(right) - scoreLabel(left))[0];
  if (!best || best === canonicalId) return undefined;
  return best;
}

export function mergeEquivalentTopicNodes(graph: GraphData): GraphData {
  const paperNodes = graph.nodes.filter((node) => node.paperLabel);
  const topicNodes = graph.nodes.filter((node) => !node.paperLabel);

  if (topicNodes.length < 2) return graph;

  const parents = new Map<string, string>(
    topicNodes.map((node) => [node.id, node.id])
  );

  const find = (id: string): string => {
    const parent = parents.get(id);
    if (!parent || parent === id) return id;
    const root = find(parent);
    parents.set(id, root);
    return root;
  };

  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents.set(rightRoot, leftRoot);
    }
  };

  const signatureOwner = new Map<string, string>();
  topicNodes.forEach((node) => {
    buildTopicSignatures(node).forEach((signature) => {
      const owner = signatureOwner.get(signature);
      if (owner) {
        union(owner, node.id);
      } else {
        signatureOwner.set(signature, node.id);
      }
    });
  });

  const groupedTopics = new Map<string, GraphNode[]>();
  topicNodes.forEach((node) => {
    const root = find(node.id);
    const existing = groupedTopics.get(root) ?? [];
    existing.push(node);
    groupedTopics.set(root, existing);
  });

  const aliasToCanonical = new Map<string, string>();
  const mergedTopics: GraphNode[] = [];

  groupedTopics.forEach((nodes) => {
    if (nodes.length === 1) {
      mergedTopics.push(nodes[0]);
      return;
    }

    const canonicalId = chooseCanonicalTopicId(nodes);
    const displayLabel = chooseTopicDisplayLabel(nodes, canonicalId);
    const summary = nodes.map((node) => cleanText(node.summary)).find(Boolean) || undefined;
    const evidence = nodes.map((node) => cleanText(node.evidence)).find(Boolean) || undefined;
    const type =
      nodes.find((node) => node.type !== "concept")?.type ||
      nodes[0]?.type ||
      "concept";

    mergedTopics.push({
      id: canonicalId,
      type,
      displayLabel,
      summary,
      evidence,
    });

    nodes.forEach((node) => {
      aliasToCanonical.set(node.id, canonicalId);
      if (node.displayLabel) {
        aliasToCanonical.set(node.displayLabel, canonicalId);
      }
    });
  });

  const edgeMap = new Map<string, GraphEdge>();
  graph.edges.forEach((edge) => {
    const source = aliasToCanonical.get(edge.source) ?? edge.source;
    const target = aliasToCanonical.get(edge.target) ?? edge.target;
    if (!source || !target || source === target) return;

    const key = `${source}::${target}::${edge.relation.toLowerCase()}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...edge, source, target });
    }
  });

  return {
    nodes: [...paperNodes, ...mergedTopics],
    edges: Array.from(edgeMap.values()),
  };
}

export function connectGraphComponents(
  graph: GraphData,
  paperAnalyses: PaperAnalysis[]
): GraphData {
  if (graph.nodes.length < 2 || paperAnalyses.length < 2) {
    return graph;
  }

  const adjacency = new Map<string, Set<string>>();
  graph.nodes.forEach((node) => {
    adjacency.set(node.id, new Set<string>());
  });

  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const componentByNodeId = new Map<string, number>();
  let componentCount = 0;

  graph.nodes.forEach((node) => {
    if (componentByNodeId.has(node.id)) return;

    const stack = [node.id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || componentByNodeId.has(current)) continue;
      componentByNodeId.set(current, componentCount);
      (adjacency.get(current) ?? new Set<string>()).forEach((neighbor) => {
        if (!componentByNodeId.has(neighbor)) {
          stack.push(neighbor);
        }
      });
    }

    componentCount += 1;
  });

  if (componentCount <= 1) {
    return graph;
  }

  const paperIds = new Set(
    paperAnalyses.map((paper) => cleanText(paper.title)).filter((title) => title.length > 0)
  );
  const parent = Array.from({ length: componentCount }, (_, index) => index);
  const find = (value: number): number => {
    if (parent[value] === value) return value;
    parent[value] = find(parent[value]);
    return parent[value];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  const seenPairs = new Set<string>();
  const candidates = [
    ...buildPaperConnectionCandidates(paperAnalyses, graph.edges),
    ...buildAllPaperPairInsights(paperAnalyses, graph.edges).filter(
      (candidate) => candidate.overlapScore > 0
    ),
  ].filter((candidate) => {
    if (seenPairs.has(candidate.pairKey)) return false;
    seenPairs.add(candidate.pairKey);
    return true;
  });

  const bridgeEdges: GraphEdge[] = [];
  for (const candidate of candidates) {
    if (!paperIds.has(candidate.leftTitle) || !paperIds.has(candidate.rightTitle)) continue;

    const leftComponent = componentByNodeId.get(candidate.leftTitle);
    const rightComponent = componentByNodeId.get(candidate.rightTitle);
    if (leftComponent === undefined || rightComponent === undefined) continue;
    if (find(leftComponent) === find(rightComponent)) continue;

    bridgeEdges.push(buildPaperConnectionEdge(candidate));
    union(leftComponent, rightComponent);
  }

  return mergeGraphEdges(graph, bridgeEdges);
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
  if (/^[A-Z][A-Z0-9-]{1,11}$/.test(cleaned)) return cleaned;
  if (/^[A-Za-z]{2,}\d+[A-Za-z0-9-]*$/.test(cleaned)) return cleaned;
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
          topics: [],
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
        topics: fallbackAnalysis.topics,
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

export function normalizeGraph(
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

  const resolveOrBackfillNodeId = (
    value: unknown,
    rawEdge?: unknown
  ): string | null => {
    const resolved = resolveNodeId(value);
    if (resolved) return resolved;

    const cleaned = cleanText(value);
    if (!cleaned) return null;

    const sanitized = sanitizeNodeId(cleaned, filenameAliasMap, paperLabelTitleMap);
    if (!sanitized) return null;

    const canonical =
      canonicalByLowercase.get(cleaned.toLowerCase()) ??
      canonicalByLowercase.get(sanitized.toLowerCase());
    if (canonical) return canonical;

    if (nodeMap.has(sanitized)) return sanitized;

    const displayLabel = sanitizeDisplayLabel(sanitized, sanitized, fileAliasSet);
    const evidence = cleanText((rawEdge as { evidence?: unknown } | undefined)?.evidence);

    nodeMap.set(sanitized, {
      id: sanitized,
      type: "concept",
      displayLabel: displayLabel || undefined,
      summary: `${sanitized} was referenced by a valid graph edge and preserved during normalization.`,
      evidence: evidence || undefined,
    });
    canonicalByLowercase.set(sanitized.toLowerCase(), sanitized);
    if (displayLabel) {
      canonicalByLowercase.set(displayLabel.toLowerCase(), sanitized);
    }
    if (cleaned !== sanitized) {
      canonicalByLowercase.set(cleaned.toLowerCase(), sanitized);
    }

    console.warn(`[normalizeGraph] Backfilled missing node from edge endpoint: "${cleaned}" -> "${sanitized}"`);
    return sanitized;
  };

  const rawEdges = Array.isArray((rawGraph as { edges?: unknown[] })?.edges)
    ? ((rawGraph as { edges: unknown[] }).edges ?? [])
    : Array.isArray((rawGraph as { links?: unknown[] })?.links)
    ? ((rawGraph as { links: unknown[] }).links ?? [])
    : [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const rawEdge of rawEdges) {
    const source = resolveOrBackfillNodeId((rawEdge as { source?: unknown })?.source, rawEdge);
    const target = resolveOrBackfillNodeId((rawEdge as { target?: unknown })?.target, rawEdge);
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

export function mergePaperAnalysisTopics(
  graph: GraphData,
  files: File[],
  paperAnalyses: PaperAnalysis[]
): GraphData {
  if (paperAnalyses.length === 0) return graph;

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, { ...node }] as const));
  const aliasToNodeId = new Map<string, string>();
  const fileAliasSet = buildFileAliasSet(files);
  const filenameAliasMap = buildFilenameAliasMap(files, paperAnalyses);
  const paperLabelTitleMap = buildPaperLabelTitleMap(paperAnalyses);

  const registerNodeAliases = (node: GraphNode) => {
    aliasToNodeId.set(normalizeAlias(node.id), node.id);
    if (node.displayLabel) {
      aliasToNodeId.set(normalizeAlias(node.displayLabel), node.id);
    }
    if (node.paperTitle) {
      aliasToNodeId.set(normalizeAlias(node.paperTitle), node.id);
    }
    if (node.paperLabel) {
      aliasToNodeId.set(normalizeAlias(node.paperLabel), node.id);
    }
  };

  Array.from(nodeMap.values()).forEach(registerNodeAliases);

  const additionalEdges: GraphEdge[] = [];

  paperAnalyses.forEach((paper) => {
    const paperNode = nodeMap.get(paper.title);
    if (!paperNode) return;

    paper.topics.forEach((topic) => {
      const sanitizedId = sanitizeNodeId(
        cleanText(topic.id),
        filenameAliasMap,
        paperLabelTitleMap
      );
      if (!sanitizedId) return;
      if (normalizeAlias(sanitizedId) === normalizeAlias(paper.title)) return;

      const resolvedId =
        aliasToNodeId.get(normalizeAlias(sanitizedId)) ??
        aliasToNodeId.get(normalizeAlias(topic.displayLabel)) ??
        sanitizedId;
      const existingNode = nodeMap.get(resolvedId);

      if (existingNode) {
        if (!existingNode.paperLabel) {
          const mergedNode: GraphNode = {
            ...existingNode,
            type: existingNode.type === "concept" ? topic.type : existingNode.type,
            displayLabel:
              existingNode.displayLabel ??
              sanitizeDisplayLabel(topic.displayLabel || resolvedId, resolvedId, fileAliasSet),
            summary: existingNode.summary ?? (cleanText(topic.summary) || undefined),
            evidence: existingNode.evidence ?? (cleanText(topic.evidence) || undefined),
          };
          nodeMap.set(resolvedId, mergedNode);
          registerNodeAliases(mergedNode);
        }
      } else {
        const newNode: GraphNode = {
          id: resolvedId,
          type: topic.type,
          displayLabel: sanitizeDisplayLabel(
            topic.displayLabel || resolvedId,
            resolvedId,
            fileAliasSet
          ),
          summary: cleanText(topic.summary) || undefined,
          evidence: cleanText(topic.evidence) || undefined,
        };
        nodeMap.set(resolvedId, newNode);
        registerNodeAliases(newNode);
      }

      additionalEdges.push({
        source: paper.title,
        target: resolvedId,
        relation: cleanText(topic.relation) || buildDefaultPaperTopicRelation(topic.type),
        explanation:
          cleanText(topic.summary) ||
          `${paper.displayLabel || paper.title} connects directly to ${resolvedId}.`,
        evidence:
          cleanText(topic.evidence) ||
          paper.evidence ||
          `Extracted from ${paper.title}.`,
      });
    });
  });

  return mergeGraphEdges(
    {
      ...graph,
      nodes: Array.from(nodeMap.values()),
    },
    additionalEdges
  );
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

  // for each edge from a paper node to a topic node, record the color
  const topicColorMap = new Map<string, string>();
  for (const edge of graph.edges) {
    const sourceColor = paperNodeColors.get(edge.source);
    const targetColor = paperNodeColors.get(edge.target);
    // paper -> topic
    if (sourceColor && !paperNodeColors.has(edge.target)) {
      if (!topicColorMap.has(edge.target)) topicColorMap.set(edge.target, sourceColor);
    }
    // topic -> paper (reverse direction edges)
    if (targetColor && !paperNodeColors.has(edge.source)) {
      if (!topicColorMap.has(edge.source)) topicColorMap.set(edge.source, targetColor);
    }
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

async function extractPaperAnalyses(
  files: File[],
  fileParts: GeminiPart[]
): Promise<PaperAnalysis[]> {
  try {
    const response = await callGemini({
      systemInstruction: {
        parts: [{ text: PAPER_ANALYSIS_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Extract canonical paper metadata for exactly ${files.length} uploaded PDFs. Keep upload order aligned to Paper 1..Paper ${files.length}.`,
            },
            ...fileParts,
          ],
        },
      ],
      generationConfig: withThinkingConfig(
        {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: PAPER_ANALYSIS_RESPONSE_SCHEMA,
        },
        "minimal"
      ),
    });

    return normalizePaperAnalyses(parseGraphJson(extractText(response)), files);
  } catch (error) {
    console.warn(
      "Paper metadata extraction failed; using fallback paper anchors.",
      error
    );
    return buildFallbackPaperAnalyses(files);
  }
}


function withThinkingConfig<T extends Record<string, unknown>>(
  config: T,
  thinkingLevel: ThinkingLevel
): T & { thinkingConfig: { thinkingLevel: ThinkingLevel } } {
  return {
    ...config,
    thinkingConfig: {
      thinkingLevel,
    },
  };
}


async function repairGraphJson(
  rawText: string,
  paperAnalyses: PaperAnalysis[]
): Promise<unknown> {
  const titleAnchors = buildPaperAnchorText(paperAnalyses);

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
  const paperAnalyses = await extractPaperAnalyses(files, fileParts);
  const titleAnchors = buildPaperAnchorText(paperAnalyses);

  const parts: GeminiPart[] = [
    {
      text: `
Analyze the uploaded research papers and build a RICHLY CONNECTED knowledge graph with two layers:
1. **Paper nodes** - one per uploaded PDF. Use the exact anchored paper titles below as the node ids.
2. **Topic nodes** - key concepts, methods, technologies, applications, and authors extracted from each paper (4-8 per paper).

Use these exact paper anchors when referring to uploaded papers:
${titleAnchors}

CRITICAL: The graph must be DENSE with connections. Follow these rules:
- For each paper, extract 4-8 specific topic nodes and connect the paper to EVERY one of them.
- If two papers discuss the same topic (e.g. both use "GWAS" or both study "Telomere Length"), use the SAME topic node id so the papers are connected through it. Actively look for shared topics.
- Create direct paper-to-paper edges when papers share methods, goals, domains, or findings.
- Connect topic nodes to each other when related (e.g. a method enables an application, a concept builds on another concept). These inter-topic edges are what make the graph rich and useful.
- Aim for at least 2-3x more edges than nodes. A graph with 10 nodes should have 20-30 edges.
- Topic nodes must be specific and grounded in the paper content, not generic terms like "Analysis" or "Results".
- Each anchored paper node must include: displayLabel, paperTitle, themeLabel, themeDescription, summary, evidence, and paperLabel ("Paper 1", "Paper 2", etc.).
- Keep each paperLabel attached to its exact anchored title. Do not swap titles, summaries, evidence, or themes between papers.
- Topic nodes must NOT have paperLabel set.
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
      temperature: 0.2,
      maxOutputTokens: 16384,
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
    rawGraph = await repairGraphJson(rawText, paperAnalyses);
  }

  const graph = mergeEquivalentTopicNodes(
    mergePaperAnalysisTopics(
      normalizeGraph(rawGraph, files, paperAnalyses),
      files,
      paperAnalyses
    )
  );

  const enrichedPaperAnalyses = buildPaperAnalysesFromGraph(graph, paperAnalyses);
  let enrichedGraph = graph;
  if (enrichedPaperAnalyses.length >= 2) {
    const heuristicEdges = buildHeuristicPaperConnections(
      enrichedPaperAnalyses,
      graph.edges
    );
    enrichedGraph = mergeGraphEdges(graph, heuristicEdges);
  }

  const connectedGraph = connectGraphComponents(
    enrichedGraph,
    enrichedPaperAnalyses
  );

  return applyPaperThemeColors(connectedGraph);
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

