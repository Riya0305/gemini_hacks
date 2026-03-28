import { describe, expect, it } from "vitest";
import {
  buildHeuristicPaperConnections,
  buildPaperConnectionCandidates,
  connectGraphComponents,
  mergePaperAnalysisTopics,
  mergeEquivalentTopicNodes,
  normalizeGraph,
  normalizePaperAnalyses,
} from "@/lib/server/gemini";

type PaperAnalyses = Parameters<typeof buildHeuristicPaperConnections>[0];

function buildPaper(
  overrides: Partial<PaperAnalyses[number]>
): PaperAnalyses[number] {
  return {
    paperLabel: "Paper 1",
    title: "Untitled Paper",
    titleEvidence: "Untitled Paper",
    displayLabel: "Untitled",
    themeLabel: "General topic",
    themeDescription: "",
    summary: "General research summary.",
    evidence: "",
    topics: [],
    ...overrides,
  };
}

describe("buildHeuristicPaperConnections", () => {
  it("creates a paper edge when two papers share a research theme", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Epigenetic Aging Clocks for Clinical Biomarkers",
        displayLabel: "Aging Clocks",
        themeLabel: "DNA aging",
        themeDescription: "DNA aging papers measure biological age from methylation signals.",
        summary: "This paper develops methylation-based predictors for biological aging.",
        evidence: "We derive methylation predictors for biological age.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Methylation Signatures of Accelerated Aging",
        displayLabel: "Aging Signatures",
        themeLabel: "DNA aging",
        themeDescription: "DNA aging papers measure biological age from methylation signals.",
        summary: "This paper studies methylation patterns linked to accelerated aging.",
        evidence: "Accelerated aging is associated with methylation signatures.",
      }),
    ];

    const edges = buildHeuristicPaperConnections(papers);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.relation).toBe("shares research focus with");
    expect(edges[0]?.source).toBe("Epigenetic Aging Clocks for Clinical Biomarkers");
    expect(edges[0]?.target).toBe("Methylation Signatures of Accelerated Aging");
  });

  it("backfills a paper edge from shared keywords when Gemini misses the pair", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Graph Neural Networks for Drug Discovery",
        displayLabel: "Drug Graphs",
        themeLabel: "molecular discovery",
        summary: "Graph neural networks predict molecular properties for drug discovery workflows.",
        evidence: "We use graph neural networks to predict molecular properties.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Molecular Property Prediction with Sparse Graph Models",
        displayLabel: "Sparse Molecules",
        themeLabel: "property modeling",
        summary: "Sparse graph models improve molecular property prediction in screening pipelines.",
        evidence: "Molecular property prediction improves with sparse graph models.",
      }),
    ];

    const edges = buildHeuristicPaperConnections(papers);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.relation).toBe("overlaps with");
    expect(edges[0]?.evidence).toContain("Shared terms");
  });

  it("does not duplicate a pair that already has a paper-to-paper edge", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Federated Learning for Hospital Imaging",
        displayLabel: "Hospital FL",
        themeLabel: "federated imaging",
        summary: "Federated learning improves hospital imaging collaboration.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Privacy-Preserving Imaging Models Across Clinics",
        displayLabel: "Clinic Privacy",
        themeLabel: "federated imaging",
        summary: "Privacy-preserving models support imaging across clinics.",
      }),
    ];

    const edges = buildHeuristicPaperConnections(papers, [
      {
        source: "Federated Learning for Hospital Imaging",
        target: "Privacy-Preserving Imaging Models Across Clinics",
        relation: "aligns with",
        explanation: "Existing Gemini edge.",
        evidence: "Existing evidence.",
      },
    ]);

    expect(edges).toEqual([]);
  });
});

describe("buildPaperConnectionCandidates", () => {
  it("shortlists overlapping paper pairs and skips already-connected pairs", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Graph Neural Networks for Drug Discovery",
        displayLabel: "Drug Graphs",
        themeLabel: "molecular discovery",
        summary: "Graph neural networks predict molecular properties for drug discovery workflows.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Molecular Property Prediction with Sparse Graph Models",
        displayLabel: "Sparse Molecules",
        themeLabel: "property modeling",
        summary: "Sparse graph models improve molecular property prediction in screening pipelines.",
      }),
      buildPaper({
        paperLabel: "Paper 3",
        title: "Orbit Determination for Deep-Space Navigation",
        displayLabel: "Deep Space",
        themeLabel: "space navigation",
        summary: "Probabilistic orbit determination improves deep-space navigation accuracy.",
      }),
    ];

    const candidates = buildPaperConnectionCandidates(papers, [
      {
        source: "Graph Neural Networks for Drug Discovery",
        target: "Molecular Property Prediction with Sparse Graph Models",
        relation: "aligns with",
        explanation: "Existing connection.",
        evidence: "Existing evidence.",
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("keeps the single pair for two-paper uploads so Gemini can still judge contrast", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Adaptive Robotics in Warehouses",
        themeLabel: "robotics",
        summary: "Warehouse robots adapt to changing layouts.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Protein Folding with Diffusion Models",
        themeLabel: "protein design",
        summary: "Diffusion models improve protein folding predictions.",
      }),
    ];

    const candidates = buildPaperConnectionCandidates(papers);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.leftTitle).toBe("Adaptive Robotics in Warehouses");
    expect(candidates[0]?.rightTitle).toBe("Protein Folding with Diffusion Models");
  });
});

describe("normalizePaperAnalyses", () => {
  it("anchors paper metadata by paperLabel instead of raw array order", () => {
    const files = [
      new File(["a"], "paper-one.pdf", { type: "application/pdf" }),
      new File(["b"], "paper-two.pdf", { type: "application/pdf" }),
    ];

    const analyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 2",
            title: "Second Paper Title",
            titleEvidence: "Second Paper Title",
            displayLabel: "Second Title",
            themeLabel: "Theme Two",
            themeDescription: "Theme two description.",
            summary: "Summary for paper two.",
            evidence: "Evidence for paper two.",
          },
          {
            paperLabel: "Paper 1",
            title: "First Paper Title",
            titleEvidence: "First Paper Title",
            displayLabel: "First Title",
            themeLabel: "Theme One",
            themeDescription: "Theme one description.",
            summary: "Summary for paper one.",
            evidence: "Evidence for paper one.",
          },
        ],
      },
      files
    );

    expect(analyses).toHaveLength(2);
    expect(analyses[0]?.paperLabel).toBe("Paper 1");
    expect(analyses[0]?.title).toBe("First Paper Title");
    expect(analyses[0]?.summary).toBe("Summary for paper one.");
    expect(analyses[1]?.paperLabel).toBe("Paper 2");
    expect(analyses[1]?.title).toBe("Second Paper Title");
    expect(analyses[1]?.summary).toBe("Summary for paper two.");
  });

  it("rejects filename-like paper titles and falls back to a neutral anchored title", () => {
    const files = [
      new File(["a"], "aging-16-206135.pdf", { type: "application/pdf" }),
    ];

    const analyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 1",
            title: "aging-16-206135.pdf",
            titleEvidence: "",
            displayLabel: "aging-16-206135.pdf",
            themeLabel: "Longevity",
            themeDescription: "Longevity studies.",
            summary: "Summary text.",
            evidence: "Evidence text.",
          },
        ],
      },
      files
    );

    expect(analyses[0]?.title).toBe("Paper 1 (title unavailable)");
    expect(analyses[0]?.displayLabel).toBe("Paper 1 title unavailable");
  });

  it("keeps grounded extra topic nodes for each paper analysis", () => {
    const files = [
      new File(["a"], "paper-one.pdf", { type: "application/pdf" }),
    ];

    const analyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 1",
            title: "Epigenetic Biomarkers for Aging",
            titleEvidence: "Epigenetic Biomarkers for Aging",
            displayLabel: "Aging Biomarkers",
            themeLabel: "Epigenetic Aging",
            themeDescription: "Epigenetic aging papers study biomarkers of aging.",
            summary: "This paper studies epigenetic biomarkers for lifespan prediction.",
            evidence: "We evaluate epigenetic biomarkers for lifespan prediction.",
            topics: [
              {
                id: "DNA Methylation",
                type: "concept",
                displayLabel: "DNA Methylation",
                relation: "studies",
                summary: "DNA methylation is a core signal in the paper.",
                evidence: "DNA methylation patterns track aging.",
              },
              {
                id: "Epigenetic Clocks",
                type: "method",
                displayLabel: "Epi Clocks",
                relation: "uses",
                summary: "Epigenetic clocks are used to estimate biological age.",
                evidence: "Epigenetic clocks estimate biological age.",
              },
            ],
          },
        ],
      },
      files
    );

    expect(analyses[0]?.topics).toHaveLength(2);
    expect(analyses[0]?.topics[0]?.id).toBe("DNA Methylation");
    expect(analyses[0]?.topics[1]?.relation).toBe("uses");
  });
});

describe("normalizeGraph", () => {
  it("backfills a missing concept node when a valid edge endpoint was omitted from nodes", () => {
    const files = [
      new File(["a"], "paper-one.pdf", { type: "application/pdf" }),
    ];
    const paperAnalyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 1",
            title: "Human height: a model common complex trait",
            titleEvidence: "Human height: a model common complex trait",
            displayLabel: "Height Trait",
            themeLabel: "Height genetics",
            themeDescription: "Height genetics papers study inherited height variation.",
            summary: "This paper uses GWAS to study common height variation.",
            evidence: "We study the genetic basis of human height.",
          },
        ],
      },
      files
    );

    const graph = normalizeGraph(
      {
        nodes: [
          {
            id: "Human height: a model common complex trait",
            type: "concept",
            paperLabel: "Paper 1",
            paperTitle: "Human height: a model common complex trait",
            displayLabel: "Height Trait",
          },
          {
            id: "GWAS",
            type: "method",
          },
        ],
        edges: [
          {
            source: "Human height: a model common complex trait",
            target: "GWAS",
            relation: "uses",
            explanation: "The paper uses GWAS to study height variation.",
            evidence: "We use genome-wide association studies to analyze height.",
          },
          {
            source: "Human height: a model common complex trait",
            target: "HMGA2",
            relation: "supports",
            explanation: "The paper identifies HMGA2 as a relevant locus.",
            evidence: "HMGA2 is one of the key loci associated with height.",
          },
        ],
      },
      files,
      paperAnalyses
    );

    expect(graph.nodes.some((node) => node.id === "HMGA2")).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "Human height: a model common complex trait" &&
          edge.target === "HMGA2" &&
          edge.relation === "supports"
      )
    ).toBe(true);
  });

  it("does not backfill filename-like edge endpoints into graph nodes", () => {
    const files = [
      new File(["a"], "aging-16-206135.pdf", { type: "application/pdf" }),
    ];
    const paperAnalyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 1",
            title: "Longevity biotechnology: bridging AI and biomarkers",
            titleEvidence: "Longevity biotechnology: bridging AI and biomarkers",
            displayLabel: "Longevity Biotech",
            themeLabel: "Longevity biotech",
            themeDescription: "Papers linking biomarkers and AI for longevity research.",
            summary: "This paper studies AI-guided longevity biomarkers.",
            evidence: "We bridge AI and biomarkers for longevity applications.",
          },
        ],
      },
      files
    );

    const graph = normalizeGraph(
      {
        nodes: [
          {
            id: "Longevity biotechnology: bridging AI and biomarkers",
            type: "concept",
            paperLabel: "Paper 1",
            paperTitle: "Longevity biotechnology: bridging AI and biomarkers",
            displayLabel: "Longevity Biotech",
          },
        ],
        edges: [
          {
            source: "Longevity biotechnology: bridging AI and biomarkers",
            target: "aging-16-206135.pdf",
            relation: "references",
            explanation: "Bad filename edge that should be dropped.",
            evidence: "Bad filename edge.",
          },
        ],
      },
      files,
      paperAnalyses
    );

    expect(graph.nodes.some((node) => node.id === "aging-16-206135.pdf")).toBe(false);
    expect(graph.edges).toEqual([]);
  });
});

describe("mergeEquivalentTopicNodes", () => {
  it("merges acronym and expanded topic variants into one shared hub", () => {
    const graph = mergeEquivalentTopicNodes({
      nodes: [
        {
          id: "Paper A",
          type: "concept",
          paperLabel: "Paper 1",
          paperTitle: "Paper A",
          displayLabel: "Paper A",
        },
        {
          id: "Paper B",
          type: "concept",
          paperLabel: "Paper 2",
          paperTitle: "Paper B",
          displayLabel: "Paper B",
        },
        {
          id: "GWAS",
          type: "method",
          displayLabel: "GWAS",
        },
        {
          id: "Genome-wide association studies",
          type: "concept",
          displayLabel: "Genome-wide association studies",
        },
      ],
      edges: [
        {
          source: "Paper A",
          target: "GWAS",
          relation: "uses",
          explanation: "Paper A uses GWAS.",
          evidence: "Paper A uses GWAS.",
        },
        {
          source: "Paper B",
          target: "Genome-wide association studies",
          relation: "uses",
          explanation: "Paper B uses genome-wide association studies.",
          evidence: "Paper B uses genome-wide association studies.",
        },
      ],
    });

    const gwasLikeNodes = graph.nodes.filter(
      (node) =>
        node.id === "GWAS" || node.id === "Genome-wide association studies"
    );

    expect(gwasLikeNodes).toHaveLength(1);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "Paper A" &&
          edge.target === "Genome-wide association studies"
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "Paper B" &&
          edge.target === "Genome-wide association studies"
      )
    ).toBe(true);
  });
});

describe("mergePaperAnalysisTopics", () => {
  it("restores per-paper topic nodes when the main graph is too sparse", () => {
    const files = [
      new File(["a"], "paper-one.pdf", { type: "application/pdf" }),
    ];
    const paperAnalyses = normalizePaperAnalyses(
      {
        papers: [
          {
            paperLabel: "Paper 1",
            title: "Epigenetic Biomarkers for Aging",
            titleEvidence: "Epigenetic Biomarkers for Aging",
            displayLabel: "Aging Biomarkers",
            themeLabel: "Epigenetic Aging",
            themeDescription: "Epigenetic aging papers study biomarkers of aging.",
            summary: "This paper studies epigenetic biomarkers for lifespan prediction.",
            evidence: "We evaluate epigenetic biomarkers for lifespan prediction.",
            topics: [
              {
                id: "DNA Methylation",
                type: "concept",
                displayLabel: "DNA Methylation",
                relation: "studies",
                summary: "DNA methylation is a core signal in the paper.",
                evidence: "DNA methylation patterns track aging.",
              },
              {
                id: "Epigenetic Clocks",
                type: "method",
                displayLabel: "Epi Clocks",
                relation: "uses",
                summary: "Epigenetic clocks are used to estimate biological age.",
                evidence: "Epigenetic clocks estimate biological age.",
              },
            ],
          },
        ],
      },
      files
    );

    const graph = mergePaperAnalysisTopics(
      {
        nodes: [
          {
            id: "Epigenetic Biomarkers for Aging",
            type: "concept",
            paperLabel: "Paper 1",
            paperTitle: "Epigenetic Biomarkers for Aging",
            displayLabel: "Aging Biomarkers",
            summary: "This paper studies epigenetic biomarkers for lifespan prediction.",
          },
        ],
        edges: [],
      },
      files,
      paperAnalyses
    );

    expect(graph.nodes.some((node) => node.id === "DNA Methylation")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "Epigenetic Clocks")).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "Epigenetic Biomarkers for Aging" &&
          edge.target === "DNA Methylation" &&
          edge.relation === "studies"
      )
    ).toBe(true);
  });
});

describe("connectGraphComponents", () => {
  it("bridges disconnected components with the strongest paper-level connection", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Epigenetic Aging Clocks for Clinical Biomarkers",
        displayLabel: "Aging Clocks",
        themeLabel: "DNA aging",
        themeDescription: "DNA aging papers measure biological age from methylation signals.",
        summary: "This paper develops methylation-based predictors for biological aging.",
        evidence: "We derive methylation predictors for biological age.",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Methylation Signatures of Accelerated Aging",
        displayLabel: "Aging Signatures",
        themeLabel: "DNA aging",
        themeDescription: "DNA aging papers measure biological age from methylation signals.",
        summary: "This paper studies methylation patterns linked to accelerated aging.",
        evidence: "Accelerated aging is associated with methylation signatures.",
      }),
    ];

    const graph = connectGraphComponents(
      {
        nodes: [
          {
            id: papers[0].title,
            type: "concept",
            paperLabel: papers[0].paperLabel,
            paperTitle: papers[0].title,
            displayLabel: papers[0].displayLabel,
          },
          {
            id: papers[1].title,
            type: "concept",
            paperLabel: papers[1].paperLabel,
            paperTitle: papers[1].title,
            displayLabel: papers[1].displayLabel,
          },
          { id: "Epigenetic Clocks", type: "concept" },
          { id: "Methylation Signatures", type: "concept" },
        ],
        edges: [
          {
            source: papers[0].title,
            target: "Epigenetic Clocks",
            relation: "studies",
            explanation: "Paper 1 studies epigenetic clocks.",
            evidence: "Paper 1 studies epigenetic clocks.",
          },
          {
            source: papers[1].title,
            target: "Methylation Signatures",
            relation: "studies",
            explanation: "Paper 2 studies methylation signatures.",
            evidence: "Paper 2 studies methylation signatures.",
          },
        ],
      },
      papers
    );

    expect(
      graph.edges.some(
        (edge) =>
          edge.source === papers[0].title &&
          edge.target === papers[1].title &&
          edge.relation === "shares research focus with"
      )
    ).toBe(true);
  });

  it("does not add extra bridge edges when the graph is already connected", () => {
    const papers: PaperAnalyses = [
      buildPaper({
        paperLabel: "Paper 1",
        title: "Paper A",
        displayLabel: "Paper A",
        themeLabel: "Shared theme",
        summary: "Summary A",
      }),
      buildPaper({
        paperLabel: "Paper 2",
        title: "Paper B",
        displayLabel: "Paper B",
        themeLabel: "Shared theme",
        summary: "Summary B",
      }),
    ];

    const graph = connectGraphComponents(
      {
        nodes: [
          {
            id: "Paper A",
            type: "concept",
            paperLabel: "Paper 1",
            paperTitle: "Paper A",
          },
          {
            id: "Paper B",
            type: "concept",
            paperLabel: "Paper 2",
            paperTitle: "Paper B",
          },
        ],
        edges: [
          {
            source: "Paper A",
            target: "Paper B",
            relation: "aligns with",
            explanation: "Already connected.",
            evidence: "Already connected.",
          },
        ],
      },
      papers
    );

    expect(graph.edges).toHaveLength(1);
  });
});
