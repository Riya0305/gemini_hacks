"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AskResponse, GraphEdge, GraphNode, NODE_COLORS } from "@/lib/types";
import EmptyState from "./EmptyState";
import LiveAskBox from "./LiveAskBox";

interface EdgeDetailsPanelProps {
  selectedEdge: GraphEdge | null;
  selectedNode: GraphNode | null;
  nodes: GraphNode[];
  askAnswer: AskResponse | null;
  isAsking: boolean;
  onAsk: (question: string) => void;
}

function getNodeById(nodes: GraphNode[], id: string): GraphNode | null {
  return nodes.find((nodeItem) => nodeItem.id === id) ?? null;
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
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
        <div className="border-b border-gray-800/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-accent/90">
            5. Explain And Listen
          </p>
          <h2 className="mt-2 text-lg font-semibold text-gray-100">Paper Details</h2>
        </div>

        <div className="panel-scroll flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <span
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{
                  color: selectedNode.colorHex || NODE_COLORS[selectedNode.type],
                  borderColor: `${selectedNode.colorHex || NODE_COLORS[selectedNode.type]}44`,
                  backgroundColor: `${selectedNode.colorHex || NODE_COLORS[selectedNode.type]}1a`,
                }}
              >
                {selectedNode.paperLabel ?? selectedNode.type}
              </span>
              <span className="text-xs uppercase tracking-[0.2em] text-gray-500">
                Graph Label
              </span>
            </div>
            <h3 className="mt-4 text-2xl font-semibold leading-tight text-gray-100">
              {selectedNode.displayLabel || selectedNode.id}
            </h3>
            {selectedNode.paperTitle && selectedNode.paperTitle !== selectedNode.displayLabel ? (
              <p className="mt-3 text-sm leading-relaxed text-gray-400">
                {selectedNode.paperTitle}
              </p>
            ) : null}
          </div>

          {selectedNode.themeLabel ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
                Color Group
              </h3>
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 h-3.5 w-3.5 rounded-full border border-white/20"
                  style={{ backgroundColor: selectedNode.colorHex || NODE_COLORS[selectedNode.type] }}
                />
                <div>
                  <p className="text-sm font-medium text-gray-100">{selectedNode.themeLabel}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-400">
                    {selectedNode.themeDescription ||
                      `${selectedNode.themeLabel} papers share a common research focus.`}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
              What This Paper Says
            </h3>
            <p className="text-sm leading-relaxed text-gray-300">
              {selectedNode.summary ||
                "Gemini did not return a full summary for this paper yet. Re-run extraction if you need richer paper-level analysis."}
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
              Key Evidence
            </h3>
            <blockquote className="rounded-2xl border border-violet-accent/20 bg-violet-accent/8 p-4 font-mono text-sm italic leading-relaxed text-gray-300">
              {selectedNode.evidence || "No evidence excerpt was returned for this paper node."}
            </blockquote>
          </div>

          <SpeakerButton
            disabled={!speechSupported || !spokenText.trim()}
            isSpeaking={isSpeaking}
            onClick={handleToggleSpeech}
            label="Play Paper Summary"
          />

          <p className="text-xs text-gray-500">
            Audio uses the browser speech engine when available.
          </p>
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
          <div className="mt-4 flex items-center gap-2 text-lg font-semibold">
            <span style={{ color: sourceColor }}>
              {sourceNode?.displayLabel || selectedEdge.source}
            </span>
            <span className="text-amber-accent">{selectedEdge.relation}</span>
            <span style={{ color: targetColor }}>
              {targetNode?.displayLabel || selectedEdge.target}
            </span>
          </div>
          {(sourceNode?.paperTitle && sourceNode.paperTitle !== sourceNode.displayLabel) ||
          (targetNode?.paperTitle && targetNode.paperTitle !== targetNode.displayLabel) ? (
            <div className="mt-3 space-y-1 text-xs text-gray-500">
              {sourceNode?.paperTitle && sourceNode.paperTitle !== sourceNode.displayLabel ? (
                <p>{sourceNode.displayLabel}: {sourceNode.paperTitle}</p>
              ) : null}
              {targetNode?.paperTitle && targetNode.paperTitle !== targetNode.displayLabel ? (
                <p>{targetNode.displayLabel}: {targetNode.paperTitle}</p>
              ) : null}
            </div>
          ) : null}
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
