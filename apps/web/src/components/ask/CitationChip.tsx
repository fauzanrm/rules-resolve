"use client";

import { Citation } from "./askTypes";

interface Props {
  index: number;
  citation: Citation;
  isActive: boolean;
  onClick: (citation: Citation) => void;
  variant?: "inline" | "card";
}

const SNIPPET_MAX = 72;

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SNIPPET_MAX ? trimmed.slice(0, SNIPPET_MAX).trimEnd() + "…" : trimmed;
}

export default function CitationChip({ index, citation, isActive, onClick, variant = "inline" }: Props) {
  if (variant === "card") {
    return (
      <button
        className={`citation-card${isActive ? " citation-card--active" : ""}`}
        onClick={() => onClick(citation)}
        aria-label={`Citation ${index}`}
      >
        <span className="citation-card-index">[{index}]</span>
        <span className="citation-card-snippet">{snippet(citation.cited_text)}</span>
      </button>
    );
  }

  return (
    <button
      className={`citation-chip${isActive ? " citation-chip--active" : ""}`}
      onClick={() => onClick(citation)}
      title={citation.cited_text}
      aria-label={`Citation ${index}`}
    >
      [{index}]
    </button>
  );
}
