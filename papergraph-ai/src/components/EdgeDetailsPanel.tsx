"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AskResponse, GraphEdge, GraphNode, NODE_COLORS } from "@/lib/types";
import EmptyState from "./EmptyState";
import LiveAskBox from "./LiveAskBox";

interface EdgeDetailsPanelProps {
  selectedEdge: GraphEdge | null;
  selectedNode: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  askAnswer: AskResponse | null;
  isAsking: boolean;
  onAsk: (question: string) => void;
}

function getNodeById(nodes: GraphNode[], id: string): GraphNode | null {
  return nodes.find((nodeItem) => nodeItem.id === id) ?? null;
}

/** Returns all paper nodes directly connected to a topic node via edges */
function getSourcePapers(nodes: GraphNode[], edges: GraphEdge[], nodeId: string): GraphNode[] {
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source === nodeId) connectedIds.add(edge.target);
    if (edge.target === nodeId) connectedIds.add(edge.source);
  }
  return nodes.filter((n) => connectedIds.has(n.id) && Boolean(n.paperLabel));
}

function SpeakerButton({
  disabled,
  isSpeaking,
  onClick,
  label,
}: {
  disabled: boolean;
  isSpeaking: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-accent/30 bg-gradient-to-r from-cyan-accent/20 via-sky-400/15 to-violet-accent/20 px-4 py-3 text-sm font-medium text-cyan-accent transition-colors duration-150 hover:border-cyan-accent/50 hover:bg-cyan-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
      <span>{isSpeaking ? "Stop Audio" : label}</span>
    </button>
  );
}

export default function EdgeDetailsPanel({
  selectedEdge,
  selectedNode,
  nodes,
  edges,
  askAnswer,
  isAsking,
  onAsk,
}: EdgeDetailsPanelProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return undefined;
    }

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const spokenText = selectedEdge
    ? `${selectedEdge.source} ${selectedEdge.relation} ${selectedEdge.target}. ${selectedEdge.explanation}. Evidence: ${selectedEdge.evidence}`
    : selectedNode
    ? `${selectedNode.paperTitle || selectedNode.id}. ${selectedNode.summary ?? ""}. Evidence: ${selectedNode.evidence ?? ""}`
    : "";

  const handleToggleSpeech = useCallback(() => {
    if (!speechSupported || !spokenText.trim()) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => {
      utteranceRef.current = null;
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setIsSpeaking(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }, [isSpeaking, speechSupported, spokenText]);

  if (!selectedEdge && !selectedNode) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
        <div className="border-b border-gray-800/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-accent/90">
            5. Explain And Listen
          </p>
          <h2 className="mt-2 text-lg font-semibold text-gray-100">
            Connection Details
          </h2>
        </div>
        <EmptyState
          message="Select a node or connection to see the explanation, evidence, and optional audio readout."
          icon={
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          }
        />
      </div>
    );
  }

  if (selectedNode && !selectedEdge) {
    const isPaperNode = Boolean(selectedNode.paperLabel);
    const sourcePapers = isPaperNode ? [] : getSourcePapers(nodes, edges, selectedNode.id);
    const nodeColor = selectedNode.colorHex || NODE_COLORS[selectedNode.type];

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
        <div className="panel-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          {/* Entity Details Card */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
              {isPaperNode ? "Paper Details" : "Entity Details"}
            </p>
            <h2 className="mt-2 text-3xl font-bold leading-tight text-cyan-400">
              {isPaperNode
                ? (selectedNode.paperTitle || selectedNode.displayLabel || selectedNode.id)
                : (selectedNode.displayLabel || selectedNode.id)}
            </h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              {isPaperNode ? "Research Paper" : "Research Entity"}
            </p>

            {/* Source papers for topic nodes */}
            {!isPaperNode && sourcePapers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {sourcePapers.map((paper) => (
                  <span
                    key={paper.id}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                    style={{
                      color: paper.colorHex || nodeColor,
                      borderColor: `${paper.colorHex || nodeColor}44`,
                      backgroundColor: `${paper.colorHex || nodeColor}18`,
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    {paper.paperTitle || paper.displayLabel || paper.id}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">
                Overview
              </h3>
              <p className="text-sm leading-relaxed text-gray-300">
                {selectedNode.summary || "No summary available for this entity yet."}
              </p>
            </div>

            <div className="mt-4">
              <SpeakerButton
                disabled={!speechSupported || !spokenText.trim()}
                isSpeaking={isSpeaking}
                onClick={handleToggleSpeech}
                label="Play Explanation"
              />
            </div>
          </div>

          {/* Evidence */}
          {selectedNode.evidence ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
                Key Evidence
              </h3>
              <blockquote className="rounded-2xl border border-violet-accent/20 bg-violet-accent/8 p-4 font-mono text-sm italic leading-relaxed text-gray-300">
                {selectedNode.evidence}
              </blockquote>
            </div>
          ) : null}

          {/* Live Ask */}
          <div className="border-t border-gray-800/80 pt-4">
            <LiveAskBox
              selectedEdge={null}
              answer={askAnswer}
              isAsking={isAsking}
              onAsk={onAsk}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!selectedEdge) return null;

  const sourceNode = getNodeById(nodes, selectedEdge.source);
  const targetNode = getNodeById(nodes, selectedEdge.target);
  const sourceColor = sourceNode?.colorHex || (sourceNode ? NODE_COLORS[sourceNode.type] : "#94a3b8");
  const targetColor = targetNode?.colorHex || (targetNode ? NODE_COLORS[targetNode.type] : "#94a3b8");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
      <div className="border-b border-gray-800/80 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-accent/90">
          5. Explain And Listen
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-100">
          Connection Details
        </h2>
      </div>

      <div className="panel-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
            Connection
          </p>
          <div className="mt-4 flex items-center gap-2 text-lg font-semibold flex-wrap">
            <span style={{ color: sourceColor }}>
              {sourceNode?.displayLabel || selectedEdge.source}
            </span>
            <span className="text-amber-accent">{selectedEdge.relation}</span>
            <span style={{ color: targetColor }}>
              {targetNode?.displayLabel || selectedEdge.target}
            </span>
          </div>

          {/* Show actual paper titles for paper nodes, or source paper tags for topic nodes */}
          <div className="mt-3 space-y-2">
            {[sourceNode, targetNode].map((node) => {
              if (!node) return null;
              if (node.paperLabel) {
                // It's a paper node — show full title
                const title = node.paperTitle || node.displayLabel || node.id;
                const color = node.colorHex || NODE_COLORS[node.type];
                return (
                  <div key={node.id} className="flex items-start gap-2">
                    <span
                      className="mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium shrink-0"
                      style={{ color, borderColor: `${color}44`, backgroundColor: `${color}18` }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      {node.displayLabel}
                    </span>
                    <span className="text-xs text-gray-400 leading-relaxed">{title}</span>
                  </div>
                );
              }
              // Topic node — find connected papers
              const papers = getSourcePapers(nodes, edges, node.id);
              if (papers.length === 0) return null;
              return (
                <div key={node.id} className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 shrink-0 mt-0.5">{node.displayLabel || node.id} from:</span>
                  {papers.map((paper) => {
                    const color = paper.colorHex || NODE_COLORS[paper.type];
                    return (
                      <span
                        key={paper.id}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ color, borderColor: `${color}44`, backgroundColor: `${color}18` }}
                      >
                        {paper.paperTitle || paper.displayLabel || paper.id}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
            Why This Connection
          </h3>
          <p className="text-sm leading-relaxed text-gray-300">
            {selectedEdge.explanation}
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
            Key Evidence
          </h3>
          <blockquote className="rounded-2xl border border-violet-accent/20 bg-violet-accent/8 p-4 font-mono text-sm italic leading-relaxed text-gray-300">
            {selectedEdge.evidence}
          </blockquote>
        </div>

        <SpeakerButton
          disabled={!speechSupported || !spokenText.trim()}
          isSpeaking={isSpeaking}
          onClick={handleToggleSpeech}
          label="Play Explanation"
        />

        <p className="text-xs text-gray-500">
          Audio uses the browser speech engine when available.
        </p>

        <div className="border-t border-gray-800/80 pt-4">
          <LiveAskBox
            selectedEdge={selectedEdge}
            answer={askAnswer}
            isAsking={isAsking}
            onAsk={onAsk}
          />
        </div>
      </div>
    </div>
  );
}
