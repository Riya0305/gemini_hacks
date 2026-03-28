// Client component for the main interactive app page.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AskResponse, EMPTY_GRAPH, GraphData, GraphEdge, GraphNode } from "@/lib/types";
import Header from "@/components/Header";
import UploadPanel from "@/components/UploadPanel";
import GraphCanvas from "@/components/GraphCanvas";
import EdgeDetailsPanel from "@/components/EdgeDetailsPanel";
import LiveChat from "@/components/LiveChat";
import HistoryPanel from "@/components/HistoryPanel";
import WorkflowOverview from "@/components/WorkflowOverview";

type GraphViewTab = "current" | "history";

interface GraphSourceFile {
  name: string;
  size: number;
}

interface GraphHistoryEntry {
  id: string;
  createdAt: string;
  label: string;
  sourceFiles: string[];
  nodeCount: number;
  edgeCount: number;
  graph: GraphData;
}

const HISTORY_STORAGE_KEY = "papergraph.graph-history.v1";
const WORKFLOW_COLLAPSED_STORAGE_KEY = "papergraph.workflow-collapsed.v1";
const MAX_HISTORY_ITEMS = 25;

interface LiveToolResult {
  ok: boolean;
  message: string;
  payload?: Record<string, unknown>;
}

function buildGraphSaveSignature(
  graph: GraphData,
  sourceFiles: GraphSourceFile[]
): string {
  return JSON.stringify({
    graph,
    sourceFiles: sourceFiles.map((file) => ({
      name: file.name,
      size: file.size,
    })),
  });
}

function isGraphData(value: unknown): value is GraphData {
  const graph = value as GraphData;
  return (
    Array.isArray(graph?.nodes) &&
    Array.isArray(graph?.edges)
  );
}

function isGraphHistoryEntry(value: unknown): value is GraphHistoryEntry {
  const entry = value as GraphHistoryEntry;
  return (
    typeof entry?.id === "string" &&
    typeof entry?.createdAt === "string" &&
    typeof entry?.label === "string" &&
    Array.isArray(entry?.sourceFiles) &&
    typeof entry?.nodeCount === "number" &&
    typeof entry?.edgeCount === "number" &&
    isGraphData(entry?.graph)
  );
}

function readGraphHistoryFromStorage(): GraphHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isGraphHistoryEntry).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function buildHistoryEntry(
  graph: GraphData,
  sourceFiles: GraphSourceFile[]
): GraphHistoryEntry {
  const sourceNames = sourceFiles.map((file) => file.name);
  const label =
    sourceNames.length > 1
      ? `${sourceNames[0]} +${sourceNames.length - 1}`
      : sourceNames[0] || `Graph ${new Date().toLocaleString()}`;

  return {
    id: `graph-${Date.now()}`,
    createdAt: new Date().toISOString(),
    label,
    sourceFiles: sourceNames,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    graph,
  };
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

function findNodeByAnyLabel(nodes: GraphNode[], value: string): GraphNode | null {
  const normalized = normalizeLookup(value);
  if (!normalized) return null;

  return (
    nodes.find((node) => {
      return [
        node.id,
        node.displayLabel,
        node.paperTitle,
      ]
        .filter((candidate): candidate is string => Boolean(candidate))
        .some((candidate) => normalizeLookup(candidate) === normalized);
    }) ?? null
  );
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value.trim());
}

export default function Home() {
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [currentGraphFiles, setCurrentGraphFiles] = useState<GraphSourceFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [askAnswer, setAskAnswer] = useState<AskResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [activeTab, setActiveTab] = useState<GraphViewTab>("current");
  const [graphHistory, setGraphHistory] = useState<GraphHistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [isWorkflowCollapsed, setIsWorkflowCollapsed] = useState(false);
  const [liveChatOpen, setLiveChatOpen] = useState(false);
  const [currentGraphSaveSignature, setCurrentGraphSaveSignature] = useState<string | null>(null);

  useEffect(() => {
    setGraphHistory(readGraphHistoryFromStorage());
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(WORKFLOW_COLLAPSED_STORAGE_KEY);
    setIsWorkflowCollapsed(raw === "true");
  }, []);

  useEffect(() => {
    if (graphHistory.length === 0) {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      return;
    }

    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(graphHistory));
  }, [graphHistory]);

  useEffect(() => {
    localStorage.setItem(
      WORKFLOW_COLLAPSED_STORAGE_KEY,
      isWorkflowCollapsed ? "true" : "false"
    );
  }, [isWorkflowCollapsed]);

  useEffect(() => {
    if (
      activeTab === "history" &&
      !selectedHistoryId &&
      graphHistory.length > 0
    ) {
      setSelectedHistoryId(graphHistory[0].id);
    }
  }, [activeTab, graphHistory, selectedHistoryId]);

  const selectedHistoryGraph = useMemo(
    () => graphHistory.find((item) => item.id === selectedHistoryId),
    [graphHistory, selectedHistoryId]
  );

  const displayedGraphData =
    activeTab === "history"
      ? selectedHistoryGraph?.graph ?? EMPTY_GRAPH
      : graphData;
  const hasCurrentGraph =
    graphData.nodes.length > 0 || graphData.edges.length > 0;
  const currentGraphSignature = hasCurrentGraph
    ? buildGraphSaveSignature(graphData, currentGraphFiles)
    : null;
  const isCurrentGraphSaved =
    currentGraphSignature !== null &&
    currentGraphSaveSignature === currentGraphSignature;

  const graphEmptyMessage =
    activeTab === "history"
      ? graphHistory.length === 0
        ? "No saved graphs yet. Save a snapshot from Workspace first."
        : "Select a saved snapshot to reopen it."
      : "Upload papers to generate a knowledge graph";

  const updateDisplayedGraph = useCallback(
    (updater: (graph: GraphData) => GraphData) => {
      if (activeTab === "history" && selectedHistoryId) {
        setGraphHistory((prev) =>
          prev.map((item) => {
            if (item.id !== selectedHistoryId) return item;
            const nextGraph = updater(item.graph);
            return {
              ...item,
              graph: nextGraph,
              nodeCount: nextGraph.nodes.length,
              edgeCount: nextGraph.edges.length,
            };
          })
        );
        return;
      }

      setGraphData((prev) => updater(prev));
    },
    [activeTab, selectedHistoryId]
  );

  const handleTabChange = useCallback(
    (tab: GraphViewTab) => {
      if (tab === "history" && graphHistory.length === 0) return;
      setActiveTab(tab);
      setLiveChatOpen(false);
      setSelectedEdge(null);
      setSelectedNode(null);
      setAskAnswer(null);
    },
    [graphHistory.length]
  );

  const handleFilesAdded = useCallback((files: File[]) => {
    setUploadError(null);
    setUploadedFiles((prev) => [...prev, ...files].slice(0, 5));
  }, []);

  const handleUpload = useCallback(async () => {
    if (uploadedFiles.length === 0) return;

    setIsProcessing(true);
    setUploadError(null);
    setLiveChatOpen(false);
    setSelectedEdge(null);
    setSelectedNode(null);
    setAskAnswer(null);

    try {
      const formData = new FormData();
      uploadedFiles.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Extract failed.");
      }

      const data: GraphData = await response.json();
      const sourceFiles = uploadedFiles.map((file) => ({
        name: file.name,
        size: file.size,
      }));

      setGraphData(data);
      setCurrentGraphFiles(sourceFiles);
      setCurrentGraphSaveSignature(null);
      setUploadedFiles([]);
      setActiveTab("current");
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Paper analysis failed. Check your Gemini API key and try again."
      );
    } finally {
      setIsProcessing(false);
    }
  }, [uploadedFiles]);

  const handleSaveCurrentGraph = useCallback(() => {
    if (!currentGraphSignature || isCurrentGraphSaved) return;

    const historyEntry = buildHistoryEntry(graphData, currentGraphFiles);
    setGraphHistory((prev) => [historyEntry, ...prev].slice(0, MAX_HISTORY_ITEMS));
    setSelectedHistoryId(historyEntry.id);
    setCurrentGraphSaveSignature(currentGraphSignature);
  }, [currentGraphFiles, currentGraphSignature, graphData, isCurrentGraphSaved]);

  const handleSelectHistoryGraph = useCallback((id: string) => {
    setSelectedHistoryId(id);
    setSelectedEdge(null);
    setSelectedNode(null);
    setAskAnswer(null);
  }, []);

  const handleClearHistory = useCallback(() => {
    setGraphHistory([]);
    setSelectedHistoryId(null);
    setCurrentGraphSaveSignature(null);
    setLiveChatOpen(false);
    setSelectedEdge(null);
    setSelectedNode(null);
    setAskAnswer(null);
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    setActiveTab("current");
  }, []);

  const handleToggleWorkflow = useCallback(() => {
    setIsWorkflowCollapsed((prev) => !prev);
  }, []);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setAskAnswer(null);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setAskAnswer(null);
  }, []);

  const handleAsk = useCallback(
    async (question: string) => {
      if (!selectedEdge) return;

      setIsAsking(true);

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, context: selectedEdge }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Ask failed.");
        }

        const data: AskResponse = await response.json();
        setAskAnswer(data);
      } catch {
        setAskAnswer({
          answer:
            "The AI backend could not answer that question right now. Try again after the extract step succeeds.",
        });
      } finally {
        setIsAsking(false);
      }
    },
    [selectedEdge]
  );

  const handleLiveAddNode = useCallback(
    (label: string, description?: string): LiveToolResult => {
      const cleanedLabel = label.trim();
      const cleanedDescription = description?.trim();
      if (!cleanedLabel) {
        return {
          ok: false,
          message: "A node label is required.",
        };
      }

      let result: LiveToolResult = {
        ok: false,
        message: "Unable to add the requested node.",
      };

      updateDisplayedGraph((graph) => {
        const existingNode = findNodeByAnyLabel(graph.nodes, cleanedLabel);
        if (existingNode) {
          result = {
            ok: true,
            message: `Node "${existingNode.displayLabel || existingNode.id}" already exists.`,
            payload: { nodeId: existingNode.id },
          };
          return graph;
        }

        const nextNode: GraphNode = {
          id: cleanedLabel,
          type: "concept",
          displayLabel: cleanedLabel,
          summary: cleanedDescription || "Added during Gemini Live chat.",
        };

        result = {
          ok: true,
          message: `Added node "${cleanedLabel}".`,
          payload: { nodeId: nextNode.id },
        };

        return {
          ...graph,
          nodes: [...graph.nodes, nextNode],
        };
      });

      return result;
    },
    [updateDisplayedGraph]
  );

  const handleLiveAddEdge = useCallback(
    (source: string, target: string, relation?: string): LiveToolResult => {
      const cleanedSource = source.trim();
      const cleanedTarget = target.trim();
      const cleanedRelation = relation?.trim() || "related to";

      if (!cleanedSource || !cleanedTarget) {
        return {
          ok: false,
          message: "Both source and target are required to add an edge.",
        };
      }

      let result: LiveToolResult = {
        ok: false,
        message: "Unable to add the requested connection.",
      };

      updateDisplayedGraph((graph) => {
        const sourceNode = findNodeByAnyLabel(graph.nodes, cleanedSource);
        if (!sourceNode) {
          result = {
            ok: false,
            message: `Source node "${cleanedSource}" was not found.`,
          };
          return graph;
        }

        const targetNode = findNodeByAnyLabel(graph.nodes, cleanedTarget);
        if (!targetNode) {
          result = {
            ok: false,
            message: `Target node "${cleanedTarget}" was not found.`,
          };
          return graph;
        }

        const existingEdge = graph.edges.find((edge) => {
          return (
            normalizeLookup(edge.source) === normalizeLookup(sourceNode.id) &&
            normalizeLookup(edge.target) === normalizeLookup(targetNode.id) &&
            normalizeLookup(edge.relation) === normalizeLookup(cleanedRelation)
          );
        });

        if (existingEdge) {
          result = {
            ok: true,
            message: `Connection "${sourceNode.displayLabel || sourceNode.id} ${existingEdge.relation} ${targetNode.displayLabel || targetNode.id}" already exists.`,
            payload: {
              source: existingEdge.source,
              target: existingEdge.target,
              relation: existingEdge.relation,
            },
          };
          return graph;
        }

        const nextEdge: GraphEdge = {
          source: sourceNode.id,
          target: targetNode.id,
          relation: cleanedRelation,
          explanation: `Added during Gemini Live chat: ${sourceNode.displayLabel || sourceNode.id} ${cleanedRelation} ${targetNode.displayLabel || targetNode.id}.`,
          evidence: "Added during Gemini Live chat.",
        };

        result = {
          ok: true,
          message: `Connected "${sourceNode.displayLabel || sourceNode.id}" to "${targetNode.displayLabel || targetNode.id}" with "${cleanedRelation}".`,
          payload: {
            source: nextEdge.source,
            target: nextEdge.target,
            relation: nextEdge.relation,
          },
        };

        return {
          ...graph,
          edges: [...graph.edges, nextEdge],
        };
      });

      return result;
    },
    [updateDisplayedGraph]
  );

  const handleLiveHighlightNode = useCallback(
    (nodeId: string, color: string): LiveToolResult => {
      const cleanedNodeId = nodeId.trim();
      const cleanedColor = color.trim();

      if (!cleanedNodeId) {
        return {
          ok: false,
          message: "A node id is required to highlight a node.",
        };
      }

      if (!isHexColor(cleanedColor)) {
        return {
          ok: false,
          message: `"${color}" is not a valid hex color.`,
        };
      }

      let highlightedNodeId: string | null = null;
      let result: LiveToolResult = {
        ok: false,
        message: "Unable to highlight the requested node.",
      };

      updateDisplayedGraph((graph) => {
        const targetNode = findNodeByAnyLabel(graph.nodes, cleanedNodeId);
        if (!targetNode) {
          result = {
            ok: false,
            message: `Node "${cleanedNodeId}" was not found.`,
          };
          return graph;
        }

        highlightedNodeId = targetNode.id;
        result = {
          ok: true,
          message: `Highlighted "${targetNode.displayLabel || targetNode.id}" with ${cleanedColor}.`,
          payload: {
            nodeId: targetNode.id,
            colorHex: cleanedColor,
          },
        };

        return {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === targetNode.id
              ? { ...node, colorHex: cleanedColor }
              : node
          ),
        };
      });

      if (highlightedNodeId) {
        setSelectedNode((prev) =>
          prev?.id === highlightedNodeId
            ? { ...prev, colorHex: cleanedColor }
            : prev
        );
      }

      return result;
    },
    [updateDisplayedGraph]
  );

  return (
    <div className="flex h-full flex-col">
      <Header
        activeTab={activeTab}
        historyCount={graphHistory.length}
        canSaveCurrent={hasCurrentGraph && !isCurrentGraphSaved}
        isCurrentSaved={isCurrentGraphSaved}
        onTabChange={handleTabChange}
        onSaveCurrent={handleSaveCurrentGraph}
      />

      {activeTab === "current" ? (
        <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <WorkflowOverview
            queuedCount={uploadedFiles.length}
            isProcessing={isProcessing}
            hasGraph={hasCurrentGraph}
            isCurrentGraphSaved={isCurrentGraphSaved}
            isCollapsed={isWorkflowCollapsed}
            onToggleCollapse={handleToggleWorkflow}
          />

          <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_400px] gap-4">
            <UploadPanel
              uploadedFiles={uploadedFiles}
              currentGraphFiles={currentGraphFiles}
              isProcessing={isProcessing}
              errorMessage={uploadError}
              onFilesAdded={handleFilesAdded}
              onUpload={handleUpload}
            />

            <GraphCanvas
              graphData={displayedGraphData}
              selectedEdge={selectedEdge}
              selectedNode={selectedNode}
              onEdgeClick={handleEdgeClick}
              onNodeClick={handleNodeClick}
              emptyMessage={graphEmptyMessage}
            />

            {liveChatOpen ? (
              <LiveChat
                graphData={displayedGraphData}
                onAddNode={handleLiveAddNode}
                onAddEdge={handleLiveAddEdge}
                onHighlightNode={handleLiveHighlightNode}
                onClose={() => setLiveChatOpen(false)}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <EdgeDetailsPanel
                  key={
                    selectedEdge
                      ? `edge:${selectedEdge.source}:${selectedEdge.target}:${selectedEdge.relation}`
                      : selectedNode
                      ? `node:${selectedNode.id}`
                      : `tab:${activeTab}:empty`
                  }
                  selectedEdge={selectedEdge}
                  selectedNode={selectedNode}
                  nodes={displayedGraphData.nodes}
                  askAnswer={askAnswer}
                  isAsking={isAsking}
                  onAsk={handleAsk}
                />
                {hasCurrentGraph && (
                  <button
                    type="button"
                    onClick={() => setLiveChatOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-amber-accent/25 bg-gradient-to-r from-amber-accent/12 via-cyan-accent/8 to-slate-accent/10 px-4 py-3 text-sm font-medium text-amber-accent transition-all hover:border-amber-accent/45 hover:from-amber-accent/18 hover:to-slate-accent/16"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Explain And Listen
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_400px] gap-4 p-4">
          <HistoryPanel
            items={graphHistory}
            selectedId={selectedHistoryId}
            onSelect={handleSelectHistoryGraph}
            onClearHistory={handleClearHistory}
          />

          <GraphCanvas
            graphData={displayedGraphData}
            selectedEdge={selectedEdge}
            selectedNode={selectedNode}
            onEdgeClick={handleEdgeClick}
            onNodeClick={handleNodeClick}
            emptyMessage={graphEmptyMessage}
          />

          {liveChatOpen ? (
            <LiveChat
              graphData={displayedGraphData}
              onAddNode={handleLiveAddNode}
              onAddEdge={handleLiveAddEdge}
              onHighlightNode={handleLiveHighlightNode}
              onClose={() => setLiveChatOpen(false)}
            />
          ) : (
            <EdgeDetailsPanel
              key={
                selectedEdge
                  ? `edge:${selectedEdge.source}:${selectedEdge.target}:${selectedEdge.relation}`
                  : selectedNode
                  ? `node:${selectedNode.id}`
                  : `tab:${activeTab}:empty`
              }
              selectedEdge={selectedEdge}
              selectedNode={selectedNode}
              nodes={displayedGraphData.nodes}
              askAnswer={askAnswer}
              isAsking={isAsking}
              onAsk={handleAsk}
            />
          )}
        </main>
      )}
    </div>
  );
}
