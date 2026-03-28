// App top bar with branding and graph-view tabs.
"use client";

type HeaderTab = "current" | "history";

interface HeaderProps {
  activeTab: HeaderTab;
  historyCount: number;
  canSaveCurrent: boolean;
  isCurrentSaved: boolean;
  onTabChange: (tab: HeaderTab) => void;
  onSaveCurrent: () => void;
}

export default function Header({
  activeTab,
  historyCount,
  canSaveCurrent,
  isCurrentSaved,
  onTabChange,
  onSaveCurrent,
}: HeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-800/80 bg-[linear-gradient(90deg,rgba(4,10,24,0.96),rgba(7,16,36,0.92),rgba(5,12,28,0.96))] px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        {/* Gradient logo icon rendered as an inline SVG. */}
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-accent/25 bg-gradient-to-br from-cyan-accent via-sky-400 to-emerald-accent shadow-[0_10px_28px_rgba(34,211,238,0.24)]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="4" cy="6" r="2" />
            <circle cx="20" cy="6" r="2" />
            <circle cx="4" cy="18" r="2" />
            <circle cx="20" cy="18" r="2" />
            <line x1="6" y1="6" x2="9.5" y2="10.5" />
            <line x1="18" y1="6" x2="14.5" y2="10.5" />
            <line x1="6" y1="18" x2="9.5" y2="13.5" />
            <line x1="18" y1="18" x2="14.5" y2="13.5" />
          </svg>
        </div>
        {/* Product title with gradient-highlighted brand text. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-accent/75">
            Research Workspace
          </p>
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="bg-gradient-to-r from-cyan-accent via-sky-300 to-emerald-accent bg-clip-text text-transparent">
              PaperGraph
            </span>{" "}
            <span className="font-normal text-gray-400">AI</span>
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onTabChange("current")}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors duration-200 ${
            activeTab === "current"
              ? "border-cyan-accent/40 bg-cyan-accent/10 text-cyan-accent"
              : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-gray-100"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Workspace</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("history")}
          disabled={historyCount === 0}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors duration-200 ${
            activeTab === "history"
              ? "border-cyan-accent/40 bg-cyan-accent/10 text-cyan-accent"
              : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-gray-100"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 10 9 10" />
            <line x1="12" y1="7" x2="12" y2="12" />
            <line x1="12" y1="12" x2="15" y2="14" />
          </svg>
          <span>Saved</span>
          <span className="rounded-full bg-gray-800 px-1.5 text-xs text-gray-400">
            {historyCount}
          </span>
        </button>

        <button
          type="button"
          onClick={onSaveCurrent}
          disabled={!canSaveCurrent}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ${
            canSaveCurrent
              ? "border-emerald-accent/35 bg-gradient-to-r from-emerald-accent/18 via-cyan-accent/14 to-sky-400/14 text-emerald-accent shadow-[0_10px_28px_rgba(52,211,153,0.14)] hover:border-emerald-accent/55 hover:from-emerald-accent/24 hover:to-sky-400/20"
              : isCurrentSaved
              ? "border-emerald-accent/20 bg-emerald-accent/10 text-emerald-accent/75"
              : "border-gray-700 bg-gray-900 text-gray-500"
          } disabled:cursor-not-allowed`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8" />
            <path d="M7 3v5h8" />
          </svg>
          <span>{isCurrentSaved ? "Saved" : "Save Snapshot"}</span>
        </button>
      </div>
    </header>
  );
}
