/** Browser and OS sometimes mislabel PDFs; accept common cases when the filename is .pdf. */
export function isLikelyPdfFile(file: Pick<File, "name" | "type">): boolean {
  const n = file.name.toLowerCase();
  const t = (file.type || "").toLowerCase();
  return (
    t === "application/pdf" ||
    t === "application/x-pdf" ||
    n.endsWith(".pdf") ||
    (t === "application/octet-stream" && n.endsWith(".pdf")) ||
    (t === "binary/octet-stream" && n.endsWith(".pdf")) ||
    (t === "" && n.endsWith(".pdf"))
  );
}
