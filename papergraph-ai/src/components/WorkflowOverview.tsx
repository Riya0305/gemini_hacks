"use client";

interface WorkflowOverviewProps {
  queuedCount: number;
  isProcessing: boolean;
  hasGraph: boolean;
  isCurrentGraphSaved: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const STEPS = [
  {
    number: "1",
    title: "Upload",
    description: "Add research papers or lab documents to the queue.",
    accent: "from-cyan-accent/30 to-cyan-accent/5",
    border: "border-cyan-accent/25",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    number: "2",
    title: "Extract With Gemini",
    description: "Gemini reads each PDF and pulls titles, concepts, and relationships.",
    accent: "from-emerald-accent/30 to-emerald-accent/5",
    border: "border-emerald-accent/25",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
        <path d="M5 19l.9 2 .9-2 2-.9-2-.9-.9-2-.9 2-2 .9 2 .9z" />
        <path d="M18 18l.7 1.5L20.2 20l-1.5.7L18 22.2l-.7-1.5-1.5-.7 1.5-.5L18 18z" />
      </svg>
    ),
  },
  {
    number: "3",
    title: "Build Graph",
    description: "The app turns extracted ideas into nodes, links, and evidence.",
    accent: "from-violet-accent/30 to-violet-accent/5",
    border: "border-violet-accent/25",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2.2" />
        <circle cx="19" cy="6" r="2.2" />
        <circle cx="19" cy="18" r="2.2" />
        <line x1="7.1" y1="11.3" x2="16.7" y2="6.8" />
        <line x1="7.1" y1="12.7" x2="16.7" y2="17.2" />
      </svg>
    ),
  },
  {
    number: "4",
    title: "Explore",
    description: "Click any node or connection to inspect why it matters.",
    accent: "from-amber-accent/30 to-amber-accent/5",
    border: "border-amber-accent/25",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l7 16 2.4-6.6L20 11 4 4z" />
      </svg>
    ),
  },
  {
    number: "5",
    title: "Explain And Listen",
    description: "Open the right-side voice panel to talk through graph links, tensions, and missing explanations.",
    accent: "from-sky-400/30 to-sky-400/5",
    border: "border-sky-400/25",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function WorkflowOverview({
  queuedCount,
  isProcessing,
  hasGraph,
  isCurrentGraphSaved,
  isCollapsed,
  onToggleCollapse,
}: WorkflowOverviewProps) {
  const statusLabel = isProcessing
    ? "Gemini is analyzing the queue"
    : queuedCount > 0
    ? `${queuedCount} paper${queuedCount > 1 ? "s" : ""} queued for extraction`
    : hasGraph && isCurrentGraphSaved
    ? "Current graph saved to your library"
    : hasGraph
    ? "Graph ready to save and explore"
    : "Upload papers to start the pipeline";

  return (
    <section className="shrink-0 overflow-hidden rounded-[30px] border border-gray-800/80 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_34%),linear-gradient(180deg,rgba(10,16,34,0.98),rgba(4,10,24,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="border-b border-gray-800/70 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/90">
              How It Works
            </p>
            <h2
              className={`mt-2 max-w-3xl font-semibold tracking-tight text-gray-100 ${
                isCollapsed ? "text-xl" : "text-3xl"
              }`}
            >
              Turn lab papers into an interactive research knowledge graph
            </h2>
            {!isCollapsed && (
              <p className="mt-2 max-w-3xl text-sm text-cyan-accent/80">
                Shape the graph in your workspace, save clean snapshots, and use secure Live without exposing the API key to the browser.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-cyan-accent/20 bg-cyan-accent/10 px-4 py-2 text-sm text-cyan-accent">
              {statusLabel}
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/70 px-4 py-2 text-sm text-gray-200 transition-colors duration-150 hover:border-gray-600 hover:bg-gray-900"
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
                className={isCollapsed ? "" : "rotate-180"}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{isCollapsed ? "Expand" : "Minimize"}</span>
            </button>
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div className="panel-scroll overflow-x-auto px-5 py-5">
          <div className="flex min-w-max items-stretch gap-3">
            {STEPS.map((step, index) => (
              <div key={step.number} className="flex items-center gap-3">
                <article
                  className={`w-[220px] rounded-[24px] border ${step.border} bg-gradient-to-br ${step.accent} px-4 py-4 text-gray-100 shadow-[0_16px_40px_rgba(0,0,0,0.28)]`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-300/90">
                      {step.number}. {step.title}
                    </span>
                    <span className="text-gray-200/90">{step.icon}</span>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-gray-300">
                    {step.description}
                  </p>
                </article>

                {index < STEPS.length - 1 && (
                  <div className="hidden text-cyan-accent/70 lg:block">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <polyline points="13 5 20 12 13 19" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
