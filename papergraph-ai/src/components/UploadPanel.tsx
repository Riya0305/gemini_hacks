"use client";

import { useState, useCallback, DragEvent, useRef } from "react";
import LoadingState from "./LoadingState";

// Props for the left upload sidebar that handles PDF intake.
interface UploadPanelProps {
  uploadedFiles: File[];
  currentGraphFiles: Array<{
    name: string;
    size: number;
  }>;
  isProcessing: boolean;
  errorMessage: string | null;
  onFilesAdded: (files: File[]) => void;
  onUpload: () => void;
}

// Formats raw byte counts into compact labels for the file list.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPanel({
  uploadedFiles,
  currentGraphFiles,
  isProcessing,
  errorMessage,
  onFilesAdded,
  onUpload,
}: UploadPanelProps) {
  // Tracks drag-hover styling for the drop zone.
  const [isDragOver, setIsDragOver] = useState(false);
  // References the hidden file input so the drop zone can trigger it.
  const inputRef = useRef<HTMLInputElement>(null);

  // Accepts dropped files but only forwards PDFs.
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type === "application/pdf"
      );
      if (files.length > 0) onFilesAdded(files);
    },
    [onFilesAdded]
  );

  // Drag handlers keep the drop zone highlight in sync.
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // Handles manual file selection and resets the input afterward.
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onFilesAdded(files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFilesAdded]
  );

  // While papers are processing, replace the panel body with LoadingState.
  if (isProcessing) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
        <div className="border-b border-gray-800/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-accent/85">
            1. Upload
          </p>
          <h2 className="mt-2 text-lg font-semibold text-gray-100">Source Papers</h2>
        </div>
        <LoadingState message="Analyzing papers with Gemini..." />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950/90 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
      <div className="border-b border-gray-800/80 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-accent/85">
          1. Upload
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-100">Source Papers</h2>
        <p className="mt-1 text-sm text-gray-500">
          Queue PDFs, then send them through Gemini to extract titles, concepts, and relationships.
        </p>
      </div>

      <div className="panel-scroll flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-2xl border border-cyan-accent/15 bg-cyan-accent/5 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-accent/90">
            Queue Status
          </p>
          <p className="mt-1 text-sm text-gray-300">
            {uploadedFiles.length === 0
              ? "No papers queued yet."
              : `${uploadedFiles.length} paper${uploadedFiles.length > 1 ? "s" : ""} ready for extraction.`}
          </p>
        </div>

        {currentGraphFiles.length > 0 && (
          <div className="rounded-2xl border border-emerald-accent/15 bg-emerald-accent/5 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-accent/90">
              Current Graph Sources
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {currentGraphFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/55 p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-emerald-accent/10">
                    <span className="text-[10px] font-bold text-emerald-accent">PDF</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-200">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main drop zone for drag-and-drop or click-to-browse PDF upload. */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed p-6
            cursor-pointer transition-all duration-200
            ${isDragOver
              ? "border-cyan-accent bg-cyan-accent/8"
              : "border-gray-700 hover:border-gray-600 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%),rgba(17,24,39,0.7)]"
            }
          `}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isDragOver ? "#22d3ee" : "#6b7280"}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm text-gray-400 text-center">
            Drop PDFs here or <span className="text-cyan-accent">browse</span>
          </p>
          <p className="text-xs text-gray-600">Upload 1-5 papers or lab documents</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleInputChange}
            className="hidden"
          />
        </div>

        {errorMessage && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-3">
            <p className="text-sm text-red-200 leading-relaxed">{errorMessage}</p>
          </div>
        )}

        {/* Uploaded PDF list with filenames and formatted sizes. */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {uploadedFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/60 p-3"
              >
                <div className="w-8 h-8 rounded bg-red-500/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-red-400">PDF</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Starts processing once at least one PDF has been added. */}
        {uploadedFiles.length > 0 && (
          <button
            onClick={onUpload}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-accent via-sky-400 to-violet-accent py-3 text-sm font-semibold text-gray-950 shadow-[0_12px_30px_rgba(34,211,238,0.22)]
              transition-all duration-200 hover:opacity-95 active:scale-[0.98]"
          >
            Extract With Gemini And Build Graph
          </button>
        )}
      </div>
    </div>
  );
}
