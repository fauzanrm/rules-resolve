export interface RawWord {
  word_id: string;
  text: string;
  quad: [number, number, number, number];
  page: number;
  block_no: number;
  line_no: number;
  word_no: number;
}

export interface PageDim {
  page: number;
  width: number;
  height: number;
}

export interface RawWordsPayload {
  committed_at?: string | null;
  word_count: number;
  page_count: number;
  pages: PageDim[];
  words: RawWord[];
  status?: "committed" | string;
}
