"use client";

import { useRouter } from "next/navigation";

export interface StageStatus {
  complete: boolean;
  stale: boolean;
  committed_at: string | null;
}

export interface ChatroomReadiness {
  chatroom_id: number;
  published_at: string | null;
  is_ask_ready: boolean;
  stages: {
    pdf: StageStatus;
    raw_words: StageStatus;
    canonical_words: StageStatus;
    nodes: StageStatus;
    chunks: StageStatus;
    embeddings: StageStatus;
  };
}

const STAGE_META: { key: keyof ChatroomReadiness["stages"]; label: string }[] = [
  { key: "pdf", label: "PDF Upload" },
  { key: "raw_words", label: "Raw Words Detection" },
  { key: "canonical_words", label: "Canonical Words Selection" },
  { key: "nodes", label: "Outline Generation" },
  { key: "chunks", label: "Chunk Assignment" },
  { key: "embeddings", label: "Embeddings Generation" },
];

function dotClass(s: StageStatus): string {
  if (s.complete) return "stage-dot stage-dot--green";
  if (s.stale) return "stage-dot stage-dot--yellow";
  return "stage-dot stage-dot--gray";
}

function dotLabel(label: string, s: StageStatus): string {
  const status = s.complete ? "Complete" : s.stale ? "Stale" : "Not started";
  const ts = s.committed_at ? ` · ${new Date(s.committed_at).toLocaleString()}` : "";
  return `${label}: ${status}${ts}`;
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

interface ChatroomCardProps {
  chatroomId: number;
  name: string;
  coverImageUrl?: string | null;
  readiness?: ChatroomReadiness | null;
}

export default function ChatroomCard({
  name,
  coverImageUrl = null,
  readiness = null,
}: ChatroomCardProps) {
  const router = useRouter();
  const slug = slugify(name);
  const isAskReady = readiness?.is_ask_ready ?? false;

  const askTitle = isAskReady
    ? `Ask ${name}`
    : readiness?.published_at
      ? "This chatroom is unpublished — pipeline stages changed after last publish."
      : "Complete all processing steps and publish this chatroom first.";

  return (
    <div className="chatroom-card">
      {coverImageUrl ? (
        <img className="card-image" src={coverImageUrl} alt={name} />
      ) : (
        <div className="card-fallback" aria-hidden="true" />
      )}
      <div className="card-info">
        <span className="card-name">{name}</span>
        {isAskReady && <span className="published-badge">Published</span>}
      </div>
      {readiness && (
        <div className="stage-indicator" aria-label="Pipeline stage status">
          {STAGE_META.map(({ key, label }) => {
            const s = readiness.stages[key];
            return (
              <span
                key={key}
                className={dotClass(s)}
                title={dotLabel(label, s)}
                aria-label={dotLabel(label, s)}
              />
            );
          })}
        </div>
      )}
      <div className="card-actions">
        <button
          className="card-action-btn card-action-btn--primary"
          onClick={() => router.push(`/admin/${slug}`)}
        >
          Configure
        </button>
        <button
          className="card-action-btn card-action-btn--secondary"
          disabled={!isAskReady}
          title={askTitle}
          onClick={() => { if (isAskReady) router.push(`/admin/${slug}/ask`); }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}
