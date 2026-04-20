export interface CanonicalWord {
  canonical_index: number;
  raw_word_index: number;
  text: string;
  page: number;
  block_no: number;
  line_no: number;
  word_no: number;
  quad: [number, number, number, number];
}

export interface CanonicalWordsState {
  chatroom_id: number;
  document_id: number | null;
  has_raw_words: boolean;
  committed_words: CanonicalWord[] | null;
  committed_at: string | null;
}
