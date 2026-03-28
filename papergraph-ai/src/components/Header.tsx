// App top bar with branding and graph-view tabs.
"use client";

type HeaderTab = "current" | "history";

interface HeaderProps {
  activeTab: HeaderTab;
  historyCount: number;
  canArchiveCurrent: boolean;
  onTabChange: (tab: HeaderTab) => void;
  onArchiveCurrent: () => void;
}

export default function Header({
  activeTab,
  historyCount,
  canArchiveCurrent,
  onTabChange,
  onArchiveCurrent,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 h-14 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        {/* Gradient logo icon rendered as an inline SVG. */}
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-accent to-violet-accent flex items-center justify-center">
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
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="bg-gradient-to-r from-cyan-accent to-violet-accent bg-clip-text text-transparent">
            PaperGraph
          </span>{" "}
          <span className="text-gray-400 font-normal">AI</span>
        </h1>
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
          <span>Current</span>
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
          <span>History</span>
          <span className="rounded-full bg-gray-800 px-1.5 text-xs text-gray-400">
            {historyCount}
          </span>
        </button>

        <button
          type="button"
          onClick={onArchiveCurrent}
          disabled={!canArchiveCurrent}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-accent/30 bg-amber-accent/10 px-3 py-1.5 text-sm text-amber-accent transition-colors duration-200 hover:border-amber-accent/45 hover:bg-amber-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
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
            <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" />
            <path d="M1 3h22v5H1z" />
            <path d="M10 12h4" />
          </svg>
          <span>Archive Current</span>
        </button>
      </div>
    </header>
  );
}
