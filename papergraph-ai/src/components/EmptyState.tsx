// Reusable empty-state UI with a centered message and optional icon.
import { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
}

// Renders a compact empty state for lists, panels, and other blank content areas.
export default function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
      {icon && <div className="text-gray-600">{icon}</div>}
      <p className="text-sm text-center max-w-[200px]">{message}</p>
    </div>
  );
}
