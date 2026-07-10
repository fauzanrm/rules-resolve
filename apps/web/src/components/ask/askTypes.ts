export interface CitationWord {
  canonical_index: number;
  text: string;
  quad: [number, number, number, number];
  page: number;
}

export interface Citation {
  index: number;
  document_id: number;
  chunk_id: number;
  chunk_index: number;
  cited_text: string;
  page: number;
  highlight_mode: "word_span" | "chunk_span";
  words: CitationWord[];
  start_canonical_index: number | null;
  end_canonical_index: number | null;
}

export type Rating = "up" | "down";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  citations?: Citation[];
  turnId?: number;
  rating?: Rating | null;
}

export interface ChatQueryResponse {
  turn_id: number;
  answer: string;
  citations: Citation[];
}
