"use client";

import { RawWord } from "./rawWordsTypes";

interface Props {
  word: RawWord | null;
  index: number | null;
  mousePos: { x: number; y: number } | null;
}

const OFFSET = 14;

export default function RawWordsHoverCard({ word, index, mousePos }: Props) {
  if (!word || !mousePos) return null;

  return (
    <div
      className="raw-word-hover-card"
      role="status"
      style={{
        position: "fixed",
        left: mousePos.x + OFFSET,
        top: mousePos.y + OFFSET,
        pointerEvents: "none",
        zIndex: 200,
      }}
    >
      <div className="raw-word-hover-row">
        <span className="raw-word-hover-label">Word #</span>
        <span className="raw-word-hover-value">{index}</span>
      </div>
      <div className="raw-word-hover-row">
        <span className="raw-word-hover-label">Text</span>
        <span className="raw-word-hover-value">{word.text}</span>
      </div>
      <div className="raw-word-hover-row">
        <span className="raw-word-hover-label">Page</span>
        <span className="raw-word-hover-value">{word.page}</span>
      </div>
      <div className="raw-word-hover-row">
        <span className="raw-word-hover-label">Block / Line / Word</span>
        <span className="raw-word-hover-value">
          {word.block_no} / {word.line_no} / {word.word_no}
        </span>
      </div>
    </div>
  );
}
