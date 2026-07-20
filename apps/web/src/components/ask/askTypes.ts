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

export type FeedbackCategory =
  | "totally_incorrect"
  | "incomplete_answer"
  | "did_not_know_answer"
  | "citation_problems"
  | "ui_glitch"
  | "pdf_viewer_issue"
  | "other";

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "totally_incorrect", label: "Totally incorrect answer" },
  { value: "incomplete_answer", label: "Incomplete answer" },
  { value: "did_not_know_answer", label: "Did not know the answer" },
  { value: "citation_problems", label: "Citations were wrong/had problems" },
  { value: "ui_glitch", label: "UI glitched or did not work as expected" },
  { value: "pdf_viewer_issue", label: "Something was wrong with the PDF viewer" },
  { value: "other", label: "Other" },
];

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
