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
  | "incorrect_answer"
  | "missing_information"
  | "wrong_citation"
  | "unclear_response"
  | "misunderstood_question";

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "incorrect_answer", label: "Incorrect rules answer" },
  { value: "missing_information", label: "Missing or incomplete information" },
  { value: "wrong_citation", label: "Cited wrong rule/section" },
  { value: "unclear_response", label: "Confusing or unclear response" },
  { value: "misunderstood_question", label: "Off-topic / misunderstood question" },
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
