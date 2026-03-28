import {
  AskResponse,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphNodeType,
  NODE_TYPES,
} from "@/lib/types";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_FILE_COUNT = 5;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

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
          displayLabel: { type: "string" },
          themeLabel: { type: "string" },
          themeDescription: { type: "string" },
          summary: { type: "string" },
          evidence: { type: "string" },
        },
        required: [
          "paperLabel",
          "title",
          "displayLabel",
          "themeLabel",
          "themeDescription",
          "summary",
          "evidence",
        ],
      },
    },
  },
  required: ["papers"],
} as const;

const PAPER_TITLE_RESPONSE_SCHEMA = {
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
        },
        required: ["paperLabel", "title", "titleEvidence"],
      },
    },
  },
  required: ["papers"],
} as const;

const PAPER_CONNECTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["edges"],
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

const PAPER_TITLE_SYSTEM_PROMPT = `
You read uploaded PDF research papers and extract only the canonical title for each file.
Return only valid JSON matching the provided schema.
Rules:
- Read each PDF directly from its contents, not from its filename.
- Return exactly one paper object per uploaded PDF in upload order.
- "paperLabel" must be "Paper 1", "Paper 2", etc. matching upload order.
- "title" must be the real paper title from the document itself, usually the prominent first-page title/header.
- "titleEvidence" must be a short direct excerpt of the title line or immediate title area from the PDF.
- Never use placeholders, filenames, author-year citations, OCR fragments, or generic labels as the title.
- Forbidden examples for title: "TITLE", "Paper 1", "Levine et al., 2018", "aging i6 206135".
- If OCR is imperfect, reconstruct the best plausible full title from the first page rather than returning noisy fragments.
`.trim();

const PAPER_ANALYSIS_SYSTEM_PROMPT = `
You read uploaded PDF research papers and extract one authoritative paper record per file.
Return only valid JSON matching the provided schema.
Rules:
- Read each PDF directly from its contents, not from its filename.
- Determine the paper title from the document itself, usually the prominent first-page title/header.
- Return exactly one paper object per uploaded PDF in upload order.
- "paperLabel" must be "Paper 1", "Paper 2", etc. matching upload order.
- If canonical paper titles are provided in the prompt, the "title" value must exactly match the canonical title for that paperLabel.
- "title" must be the real paper title text from the document.
- "displayLabel" must be a short 2-4 word canvas label for the paper, derived from the paper's topic or title.
- "displayLabel" must stay readable on a graph and must not be a filename, citation fragment, or OCR garbage.
- "themeLabel" must be a short shared topic group for legend coloring such as "DNA aging", "edge AI", or "glucose sensing".
- Papers that are closely related should reuse the same or nearly identical "themeLabel" so they can share a color group.
- "themeDescription" must be one concise sentence explaining what that color group represents.
- Never use placeholders, filenames, author-year citations, OCR fragments, or generic labels as the title.
- Forbidden examples for title: "TITLE", "Paper 1", "Levine et al., 2018", "aging i6 206135".
- If OCR is imperfect, reconstruct the best plausible full title from the first page rather than returning noisy fragments.
- "summary" must be a concise grounded explanation of the paper's main contribution.
- "evidence" must be a direct quote or grounded excerpt from the paper.
`.trim();

const EXTRACT_SYSTEM_PROMPT = `
You extract a clean knowledge graph from uploaded research papers.
The frontend expects this exact GraphData shape:
${EXTRACT_OUTPUT_CONTRACT}
Return only a single valid JSON object. No markdown, no code fences, no commentary.
Rules:
- Nodes must be unique entities with short display names.
- Allowed node types: technology, method, author, application, concept.
- Analyze every uploaded PDF in full before returning JSON.
- First, extract the title of each uploaded paper from the PDF content itself (usually the first-page title/header).
- Include exactly one dedicated paper-title node per uploaded paper.
- For each paper-title node, set node id equal to the extracted paper title text.
- Never use filename text, author-year citations, shorthand labels, placeholders, or generic text as paper node ids.
- Forbidden paper node ids include examples like: "TITLE", "Paper 1", "aging i6 206135", "Levine et al., 2018".
- For each paper-title node, include:
  - displayLabel: a readable 2-4 word label for the graph canvas
  - paperTitle: the same full canonical paper title used in node id
  - themeLabel: short shared topic group for paper color legend
  - themeDescription: one-sentence legend explanation for that paper color
  - summary: 1-3 sentences with the paper's key contribution
  - evidence: a direct quote or grounded excerpt from the paper
  - paperLabel: "Paper 1", "Paper 2", etc. matching upload order when possible
- When multiple papers are uploaded, include edges between the paper-title nodes whenever the papers are clearly related by method, domain, dataset, objective, or findings.
- Paper-to-paper edges must explain why the papers are correlated.
- Edges must connect existing node ids.
- relation must be a short verb phrase such as "improves", "uses", "proposes", or "studies".
- explanation must be concise and grounded in the papers.
- evidence must be a direct quote when available, otherwise a close grounded excerpt.
- Avoid duplicate nodes, duplicate edges, vague labels, and unsupported claims.
- Always include both top-level keys: "nodes" and "edges" (use [] when empty).
`.trim();

const PAPER_CONNECTION_SYSTEM_PROMPT = `
You compare uploaded research papers and create edges between the paper-title nodes.
Return only valid JSON matching the provided schema.
Rules:
- Use the exact paper titles provided to you for source and target.
- Create edges only between paper-title nodes, not between paper labels.
- Focus on why the papers are correlated: shared methods, goals, domains, datasets, findings, or complementary approaches.
- relation must be a short phrase such as "shares methods with", "supports", "extends", "aligns with", or "contrasts with".
- explanation must clearly state why the two papers are related.
- evidence must reference grounded excerpts or summaries from the provided paper metadata.
- Avoid duplicate edges and self-links.
- If there is a meaningful overlap, create an edge.
- If papers are genuinely unrelated, return an empty edges array.
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

function normalizePaperTitles(raw: unknown, files: File[]): PaperTitleAnchor[] {
  const fileAliasSet = buildFileAliasSet(files);
  const rawPapers = Array.isArray((raw as { papers?: unknown[] })?.papers)
    ? ((raw as { papers: unknown[] }).papers ?? [])
    : [];
  const normalizedPapers: PaperTitleAnchor[] = [];

  rawPapers.forEach((rawPaper, index) => {
    const fallbackLabel = `Paper ${index + 1}`;
    const paperLabel = cleanText((rawPaper as { paperLabel?: unknown })?.paperLabel) || fallbackLabel;
    const title = sanitizeExtractedPaperTitle(
      cleanText((rawPaper as { title?: unknown })?.title),
      fileAliasSet
    );
    const titleEvidence = cleanText((rawPaper as { titleEvidence?: unknown })?.titleEvidence);

    if (!title) return;

    normalizedPapers.push({
      paperLabel,
      title,
      titleEvidence,
    });
  });

  return files.flatMap((_, index) => {
    const label = `Paper ${index + 1}`;
    const existing =
      normalizedPapers.find((paper) => normalizeAlias(paper.paperLabel) === normalizeAlias(label)) ??
      normalizedPapers[index];

    if (!existing) return [];

    return [
      {
        paperLabel: label,
        title: existing.title,
        titleEvidence: existing.titleEvidence,
      },
    ];
  });
}

function normalizePaperAnalyses(
  raw: unknown,
  files: File[],
  paperTitles: PaperTitleAnchor[]
): PaperAnalysis[] {
  const fileAliasSet = buildFileAliasSet(files);
  const rawPapers = Array.isArray((raw as { papers?: unknown[] })?.papers)
    ? ((raw as { papers: unknown[] }).papers ?? [])
    : [];
  const titleByLabel = new Map(
    paperTitles.map((paper) => [normalizeAlias(paper.paperLabel), paper])
  );
  const normalizedPapers: PaperAnalysis[] = [];

  rawPapers.forEach((rawPaper, index) => {
    const fallbackLabel = `Paper ${index + 1}`;
    const paperLabel = cleanText((rawPaper as { paperLabel?: unknown })?.paperLabel) || fallbackLabel;
    const anchoredTitle = titleByLabel.get(normalizeAlias(paperLabel));
    const title =
      anchoredTitle?.title ||
      sanitizeExtractedPaperTitle(
        cleanText((rawPaper as { title?: unknown })?.title),
        fileAliasSet
      );
    const displayLabel = sanitizeDisplayLabel(
      cleanText((rawPaper as { displayLabel?: unknown })?.displayLabel),
      title,
      fileAliasSet
    );
    const themeLabel = sanitizeThemeLabel(
      cleanText((rawPaper as { themeLabel?: unknown })?.themeLabel),
      title
    );
    const themeDescription = sanitizeThemeDescription(
      cleanText((rawPaper as { themeDescription?: unknown })?.themeDescription),
      themeLabel
    );
    const summary = cleanText((rawPaper as { summary?: unknown })?.summary);
    const evidence = cleanText((rawPaper as { evidence?: unknown })?.evidence);

    if (!title) {
      return;
    }

    normalizedPapers.push({
      paperLabel,
      title,
      displayLabel,
      themeLabel,
      themeDescription,
      summary,
      evidence: evidence || anchoredTitle?.titleEvidence || "",
    });
  });

  return files.flatMap((_, index) => {
    const label = `Paper ${index + 1}`;
    const anchoredTitle = titleByLabel.get(normalizeAlias(label));
    const existing =
      normalizedPapers.find((paper) => normalizeAlias(paper.paperLabel) === normalizeAlias(label)) ??
      normalizedPapers[index];
    const title = anchoredTitle?.title || existing?.title || "";

    if (!title) return [];

    return [
      {
        paperLabel: label,
        title,
        displayLabel:
          existing?.displayLabel || buildFallbackDisplayLabel(title),
        themeLabel:
          existing?.themeLabel || buildFallbackDisplayLabel(title),
        themeDescription:
          existing?.themeDescription ||
          `${existing?.themeLabel || buildFallbackDisplayLabel(title)} papers share a common research focus.`,
        summary: existing?.summary || "",
        evidence: existing?.evidence || anchoredTitle?.titleEvidence || "",
      },
    ];
  });
}

function normalizePaperConnections(
  raw: unknown,
  paperAnalyses: PaperAnalysis[]
): GraphEdge[] {
  const paperLabelTitleMap = buildPaperLabelTitleMap(paperAnalyses);
  const paperAliasMap = buildPaperAliasMap(paperAnalyses);
  const validTitles = new Set(
    paperAnalyses.map((paper) => cleanText(paper.title)).filter((title) => title.length > 0)
  );
  const rawEdges = Array.isArray((raw as { edges?: unknown[] })?.edges)
    ? ((raw as { edges: unknown[] }).edges ?? [])
    : [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const rawEdge of rawEdges) {
    const rawSource = cleanText((rawEdge as { source?: unknown })?.source);
    const rawTarget = cleanText((rawEdge as { target?: unknown })?.target);
    const source =
      paperAliasMap.get(normalizeAlias(rawSource)) ||
      sanitizeNodeId(rawSource, new Map<string, string>(), paperLabelTitleMap);
    const target =
      paperAliasMap.get(normalizeAlias(rawTarget)) ||
      sanitizeNodeId(rawTarget, new Map<string, string>(), paperLabelTitleMap);
    const relation = cleanText((rawEdge as { relation?: unknown })?.relation);
    const explanation = cleanText(
      (rawEdge as { explanation?: unknown })?.explanation
    );
    const evidence = cleanText((rawEdge as { evidence?: unknown })?.evidence);

    if (!source || !target || source === target) continue;
    if (!validTitles.has(source) || !validTitles.has(target)) continue;
    if (!relation || !explanation || !evidence) continue;

    const edgeKey = `${source}::${target}::${relation.toLowerCase()}`;
    edgeMap.set(edgeKey, {
      source,
      target,
      relation,
      explanation,
      evidence,
    });
  }

  return Array.from(edgeMap.values());
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
      displayLabel: cleanText(paper.displayLabel) || buildFallbackDisplayLabel(title),
      paperTitle: title,
      themeLabel: cleanText(paper.themeLabel) || buildFallbackDisplayLabel(title),
      themeDescription:
        cleanText(paper.themeDescription) ||
        `${cleanText(paper.themeLabel) || buildFallbackDisplayLabel(title)} papers share a common research focus.`,
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

    if (!relation || !explanation || !evidence) continue;

    const edgeKey = `${source}::${target}::${relation.toLowerCase()}`;
    if (edgeMap.has(edgeKey)) continue;

    edgeMap.set(edgeKey, {
      source,
      target,
      relation,
      explanation,
      evidence,
    });
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
  const themeEntries = graph.nodes
    .filter((node) => node.paperLabel && cleanText(node.themeLabel))
    .map((node) => normalizeAlias(node.themeLabel || ""))
    .filter((theme, index, array) => theme.length > 0 && array.indexOf(theme) === index);
  const themeColorMap = new Map<string, string>();

  themeEntries.forEach((theme, index) => {
    themeColorMap.set(theme, PAPER_THEME_PALETTE[index % PAPER_THEME_PALETTE.length]);
  });

  return themeColorMap;
}

function applyPaperThemeColors(graph: GraphData): GraphData {
  const themeColorMap = buildThemeColorMap(graph);
  if (themeColorMap.size === 0) return graph;

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (!node.paperLabel || !node.themeLabel) return node;

      return {
        ...node,
        colorHex:
          themeColorMap.get(normalizeAlias(node.themeLabel)) ||
          node.colorHex ||
          PAPER_THEME_PALETTE[0],
      };
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

async function extractPaperTitles(files: File[]): Promise<PaperTitleAnchor[]> {
  const parts: GeminiPart[] = [
    {
      text: `
Read every attached PDF and extract the canonical title for each paper.
Determine the title from the document contents, especially the first page and title header.
Return records in upload order.
`.trim(),
    },
    ...(await buildFileParts(files)),
  ];

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: PAPER_TITLE_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: PAPER_TITLE_RESPONSE_SCHEMA,
    },
  });

  const rawText = extractText(response);
  const rawPaperTitles = parseGraphJson(rawText);
  return normalizePaperTitles(rawPaperTitles, files);
}

async function extractPaperAnalyses(
  files: File[],
  paperTitles: PaperTitleAnchor[]
): Promise<PaperAnalysis[]> {
  const titleMemory =
    paperTitles.length > 0
      ? paperTitles
          .map(
            (paper) => `
${paper.paperLabel}
Canonical title: ${paper.title}
Title evidence: ${paper.titleEvidence || "No title evidence extracted."}
`.trim()
          )
          .join("\n\n")
      : "No canonical title memory is available. Read the PDFs and infer the titles directly.";

  const parts: GeminiPart[] = [
    {
      text: `
Read every attached PDF and extract one authoritative paper record per file.
Use the canonical paper-title memory below to keep titles stable across the pipeline.
For each paper, return the same paperLabel and exact canonical title when available.

Canonical paper-title memory:
${titleMemory}
`.trim(),
    },
    ...(await buildFileParts(files)),
  ];

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: PAPER_ANALYSIS_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: PAPER_ANALYSIS_RESPONSE_SCHEMA,
    },
  });

  const rawText = extractText(response);
  const rawPaperAnalysis = parseGraphJson(rawText);
  return normalizePaperAnalyses(rawPaperAnalysis, files, paperTitles);
}

async function extractPaperConnections(
  paperAnalyses: PaperAnalysis[]
): Promise<GraphEdge[]> {
  if (paperAnalyses.length < 2) return [];

  const parts: GeminiPart[] = [
    {
      text: `
Compare every pair of papers below and create explicit edges between paper-title nodes when the papers are meaningfully related.
Use the exact paper titles provided in the metadata as the edge source and target.
Focus on why the papers are correlated: shared methods, domains, goals, datasets, findings, or complementary approaches.
`.trim(),
    },
    {
      text: paperAnalyses
        .map(
          (paper) => `
${paper.paperLabel}
Title: ${paper.title}
Display label: ${paper.displayLabel}
Theme label: ${paper.themeLabel}
Theme description: ${paper.themeDescription}
Summary: ${paper.summary || "No summary extracted."}
Evidence: ${paper.evidence || "No evidence extracted."}
`.trim()
        )
        .join("\n\n"),
    },
  ];

  const response = await callGemini({
    systemInstruction: {
      parts: [{ text: PAPER_CONNECTION_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: PAPER_CONNECTION_RESPONSE_SCHEMA,
    },
  });

  const rawText = extractText(response);
  const rawConnections = parseGraphJson(rawText);
  return normalizePaperConnections(rawConnections, paperAnalyses);
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
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: GRAPH_RESPONSE_SCHEMA,
    },
  });

  return parseGraphJson(extractText(response));
}

export async function extractGraphFromPdfs(files: File[]): Promise<GraphData> {
  validatePdfFiles(files);
  let paperTitles: PaperTitleAnchor[] = [];
  let paperAnalyses: PaperAnalysis[] = [];

  try {
    paperTitles = await extractPaperTitles(files);
    paperAnalyses = paperTitles.map((paper) => ({
      paperLabel: paper.paperLabel,
      title: paper.title,
      displayLabel: buildFallbackDisplayLabel(paper.title),
      themeLabel: buildFallbackDisplayLabel(paper.title),
      themeDescription: `${buildFallbackDisplayLabel(paper.title)} papers share a common research focus.`,
      summary: "",
      evidence: paper.titleEvidence,
    }));
  } catch (error) {
    console.warn("Paper title extraction failed; continuing with broader analysis.", error);
  }

  try {
    const extractedAnalyses = await extractPaperAnalyses(files, paperTitles);
    if (extractedAnalyses.length > 0) {
      paperAnalyses = extractedAnalyses;
    }
  } catch (error) {
    console.warn("Paper metadata extraction failed; continuing with graph extraction.", error);
  }

  const fileParts = await buildFileParts(files);
  const titleAnchors =
    paperAnalyses.length > 0
      ? paperAnalyses
          .map((paper) => `${paper.paperLabel}: ${paper.title}`)
          .join("\n")
      : "No extracted paper titles available. Read the PDFs and determine the titles directly.";

  const parts: GeminiPart[] = [
    {
      text: `
Analyze the uploaded research papers and build a single merged knowledge graph.
Focus on the important entities, methods, technologies, authors, concepts, and applications that appear across the documents.
Prefer quality over quantity.
Use exact node ids consistently in every edge source/target field.
Read each PDF carefully and extract the real paper title from inside the document for the paper node id.
If a title is not obvious, use the best full title candidate from the first page, not a placeholder token.
Do not use filename strings, citation shorthand, OCR noise, or placeholder text as paper node ids.
Use paperLabel to remember which uploaded paper a node belongs to, but always use the paper title as the node id.
Use these extracted paper titles exactly for the dedicated paper nodes:
${titleAnchors}
When you create a paper node, include displayLabel, paperTitle, themeLabel, themeDescription, summary, evidence, and paperLabel fields.
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
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: GRAPH_RESPONSE_SCHEMA,
    },
  });

  const rawText = extractText(response);
  let rawGraph: unknown;

  try {
    rawGraph = parseGraphJson(rawText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    rawGraph = await repairGraphJson(rawText, paperAnalyses);
  }

  let graph = normalizeGraph(rawGraph, files, paperAnalyses);

  if (paperAnalyses.length > 1) {
    try {
      const paperConnections = await extractPaperConnections(paperAnalyses);
      graph = mergeGraphEdges(graph, paperConnections);
    } catch (error) {
      console.warn(
        "Paper connection extraction failed; returning graph without dedicated inter-paper edges.",
        error
      );
    }
  }

  return applyPaperThemeColors(graph);
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
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 512,
    },
  });

  return {
    answer: extractText(response),
  };
}
