"use client";

import { useEffect, useRef } from "react";
import { ChatMessage, Citation, Rating } from "./askTypes";
import CitationChip from "./CitationChip";
import { HighlightTarget } from "./useHighlight";

interface Props {
  messages: ChatMessage[];
  activeHighlight: HighlightTarget | null;
  onCitationClick: (citation: Citation) => void;
  onRate: (messageId: string, rating: Rating) => void;
  isLoading: boolean;
}

function renderWithCitations(
  content: string,
  citations: Citation[],
  activeHighlight: HighlightTarget | null,
  onCitationClick: (citation: Citation) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{content.slice(last, match.index)}</span>);
    }
    const n = parseInt(match[1], 10);
    const citation = citations.find((c) => c.index === n);
    if (citation) {
      parts.push(
        <CitationChip
          key={key++}
          index={n}
          citation={citation}
          isActive={activeHighlight?.chunk_id === citation.chunk_id}
          onClick={onCitationClick}
        />
      );
    } else {
      parts.push(<span key={key++}>{match[0]}</span>);
    }
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    parts.push(<span key={key++}>{content.slice(last)}</span>);
  }

  return parts;
}

export default function MessageList({ messages, activeHighlight, onCitationClick, onRate, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  return (
    <div className="message-list" role="log" aria-live="polite">
      {messages.length === 0 && !isLoading && (
        <p className="message-list-empty">Ask a question to get started.</p>
      )}
      {messages.map((msg) => (
        <div key={msg.id} className={`message message--${msg.role}`}>
          <div className="message-content">
            {msg.role === "assistant" && msg.citations && msg.citations.length > 0
              ? renderWithCitations(msg.content, msg.citations, activeHighlight, onCitationClick)
              : msg.content}
          </div>
          {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
            <div className="message-citations">
              {msg.citations.map((c) => (
                <CitationChip
                  key={c.chunk_id}
                  index={c.index}
                  citation={c}
                  isActive={activeHighlight?.chunk_id === c.chunk_id}
                  onClick={onCitationClick}
                  variant="card"
                />
              ))}
            </div>
          )}
          {msg.role === "assistant" && msg.turnId !== undefined && (
            <div className="message-rating">
              <button
                className={`message-rating-btn${msg.rating === "up" ? " message-rating-btn--active" : ""}`}
                aria-label="Thumbs up"
                aria-pressed={msg.rating === "up"}
                onClick={() => onRate(msg.id, "up")}
              >
                👍
              </button>
              <button
                className={`message-rating-btn${msg.rating === "down" ? " message-rating-btn--active" : ""}`}
                aria-label="Thumbs down"
                aria-pressed={msg.rating === "down"}
                onClick={() => onRate(msg.id, "down")}
              >
                👎
              </button>
            </div>
          )}
        </div>
      ))}
      {isLoading && (
        <div className="message message--assistant message--loading">
          <div className="message-content message-loading-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
