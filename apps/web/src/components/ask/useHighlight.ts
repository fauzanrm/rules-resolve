"use client";

import { useState, useCallback } from "react";
import { Citation, CitationWord } from "./askTypes";

export interface HighlightTarget {
  page: number;
  mode: "word_span" | "chunk_span";
  words: CitationWord[];
  chunk_id: number;
}

export function useHighlight() {
  const [active, setActive] = useState<HighlightTarget | null>(null);

  const highlight = useCallback((citation: Citation) => {
    setActive({
      page: citation.page,
      mode: citation.highlight_mode,
      words: citation.words,
      chunk_id: citation.chunk_id,
    });
  }, []);

  const clear = useCallback(() => setActive(null), []);

  return { active, highlight, clear };
}
