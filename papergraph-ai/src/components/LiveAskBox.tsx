"use client";

import { useState, useCallback } from "react";
import { GraphEdge, AskResponse } from "@/lib/types";

// Props for the Q&A box rendered inside EdgeDetailsPanel.
interface LiveAskBoxProps {
  selectedEdge: GraphEdge | null;
  answer: AskResponse | null;
  isAsking: boolean;
  onAsk: (question: string) => void;
}

// Pre-made question chips users can tap instead of typing.
const HINTS = [
  "Explain this simply",
  "Why does this matter?",
  "How is this used in practice?",
];

export default function LiveAskBox({
  selectedEdge,
  answer,
  isAsking,
  onAsk,
}: LiveAskBoxProps) {
  // Local input value for the current question being composed.
  const [question, setQuestion] = useState("");
  // Block interactions when no edge is selected or a request is already running.
  const disabled = !selectedEdge || isAsking;

  // Trim and submit the current question, then clear the input on success.
  const handleSubmit = useCallback(() => {
    const q = question.trim();
    if (!q || disabled) return;
    onAsk(q);
    setQuestion("");
  }, [question, disabled, onAsk]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-accent/85">
        Ask Gemini About This Connection
      </h3>

      {/* Input row with the question field and submit button. */}
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={disabled ? "Select a connection first" : "Ask a question..."}
          disabled={!selectedEdge}
          className="flex-1 rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200
            placeholder:text-gray-600 focus:outline-none focus:border-cyan-accent/50 focus:ring-1 focus:ring-cyan-accent/20
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !question.trim()}
          className="rounded-2xl border border-cyan-accent/20 bg-cyan-accent/10 px-3 py-2 text-cyan-accent
            hover:bg-cyan-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Hint chips appear only when an edge is selected, no answer is shown, and nothing is loading. */}
      {selectedEdge && !answer && !isAsking && (
        <div className="flex flex-wrap gap-1.5">
          {HINTS.map((hint) => (
            <button
              key={hint}
              onClick={() => onAsk(hint)}
              className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400
                hover:bg-gray-700 hover:text-gray-300 transition-colors duration-200"
            >
              {hint}
            </button>
          ))}
        </div>
      )}

      {/* Loading dots use the dot-pulse treatment while the answer request is in flight. */}
      {isAsking && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-3">
          <div className="dot-pulse flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent" />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent" />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent" />
          </div>
        </div>
      )}

      {/* Answer display renders the returned response once loading has finished. */}
      {answer && !isAsking && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-sm text-gray-300 leading-relaxed">{answer.answer}</p>
        </div>
      )}
    </div>
  );
}
