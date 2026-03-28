"use client";

interface GraphHistoryItem {
  id: string;
  createdAt: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
}

interface HistoryPanelProps {
  items: GraphHistoryItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearHistory: () => void;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HistoryPanel({
  items,
  selectedId,
  onSelect,
  onClearHistory,
}: HistoryPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
      <div className="border-b border-gray-800/80 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_42%)] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-accent/85">
          Saved Workspace
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-100">Saved Graphs</h2>
        <p className="mt-1 text-sm text-gray-500">
          Snapshots stay available here without removing the live graph from your workspace.
        </p>
      </div>

      <div className="panel-scroll flex-1 space-y-2 overflow-y-auto p-3">
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`w-full rounded-2xl border p-3 text-left transition-colors duration-150 ${
                active
                  ? "border-emerald-accent/35 bg-gradient-to-r from-emerald-accent/12 to-cyan-accent/8"
                  : "border-gray-800 bg-gray-900/50 hover:border-gray-700"
              }`}
            >
              <p className="truncate text-sm font-medium text-gray-200">
                {item.label}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {`${item.nodeCount} nodes | ${item.edgeCount} edges`}
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {formatTimestamp(item.createdAt)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="border-t border-gray-800/80 p-3">
        <button
          type="button"
          onClick={onClearHistory}
          disabled={items.length === 0}
          className="w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm font-medium text-red-200 transition-colors duration-150 hover:border-red-500/50 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear Saved Graphs
        </button>
      </div>
    </div>
  );
}
