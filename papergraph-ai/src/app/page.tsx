// Client component for the main interactive app page.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AskResponse, EMPTY_GRAPH, GraphData, GraphEdge, GraphNode } from "@/lib/types";
import Header from "@/components/Header";
import UploadPanel from "@/components/UploadPanel";
import GraphCanvas from "@/components/GraphCanvas";
import EdgeDetailsPanel from "@/components/EdgeDetailsPanel";
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

  const graphEmptyMessage =
    activeTab === "history"
      ? graphHistory.length === 0
        ? "No saved graphs yet. Build a graph in the Current tab first."
        : "Select a saved graph from history."
      : "Upload papers to generate a knowledge graph";

  const handleTabChange = useCallback(
    (tab: GraphViewTab) => {
      if (tab === "history" && graphHistory.length === 0) return;
      setActiveTab(tab);
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

  const handleArchiveCurrentGraph = useCallback(() => {
    if (graphData.nodes.length === 0 && graphData.edges.length === 0) return;

    const historyEntry = buildHistoryEntry(graphData, currentGraphFiles);
    setGraphHistory((prev) => [historyEntry, ...prev].slice(0, MAX_HISTORY_ITEMS));
    setSelectedHistoryId(historyEntry.id);
    setGraphData(EMPTY_GRAPH);
    setCurrentGraphFiles([]);
    setSelectedEdge(null);
    setSelectedNode(null);
    setAskAnswer(null);
    setUploadError(null);
    setActiveTab("current");
  }, [currentGraphFiles, graphData]);

  const handleSelectHistoryGraph = useCallback((id: string) => {
    setSelectedHistoryId(id);
    setSelectedEdge(null);
    setSelectedNode(null);
    setAskAnswer(null);
  }, []);

  const handleClearHistory = useCallback(() => {
    setGraphHistory([]);
    setSelectedHistoryId(null);
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

  return (
    <div className="flex h-full flex-col">
      <Header
        activeTab={activeTab}
        historyCount={graphHistory.length}
        canArchiveCurrent={hasCurrentGraph}
        onTabChange={handleTabChange}
        onArchiveCurrent={handleArchiveCurrentGraph}
      />

      {activeTab === "current" ? (
        <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <WorkflowOverview
            queuedCount={uploadedFiles.length}
            isProcessing={isProcessing}
            hasGraph={hasCurrentGraph}
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
        </main>
      )}
    </div>
  );
}
