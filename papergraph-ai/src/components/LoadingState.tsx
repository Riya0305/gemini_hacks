// Reusable loading spinner used during PDF processing, with a cyan accent and default message support.
interface LoadingStateProps {
  message?: string;
}

// Simple CSS border spinner with an optional loading message.
export default function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 border-2 border-gray-700 border-t-cyan-accent rounded-full animate-spin" />
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
