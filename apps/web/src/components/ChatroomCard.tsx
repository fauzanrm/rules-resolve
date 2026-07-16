"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { del, postForm } from "@/lib/api";

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

export interface ThumbnailResult {
  cover_image_url: string | null;
  has_custom_thumbnail: boolean;
}

interface ChatroomCardProps {
  chatroomId: number;
  name: string;
  coverImageUrl?: string | null;
  hasCustomThumbnail?: boolean;
  readiness?: ChatroomReadiness | null;
  /** Read-only end-user mode: no configure/ask controls or status indicators; the whole card opens the chatroom directly. */
  viewOnly?: boolean;
  onThumbnailChange?: (result: ThumbnailResult) => void;
}

function CardThumbnailMenu({
  chatroomId,
  hasCustomThumbnail,
  onThumbnailChange,
}: {
  chatroomId: number;
  hasCustomThumbnail: boolean;
  onThumbnailChange?: (result: ThumbnailResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await postForm<{ cover_image_url: string | null; has_custom_thumbnail: boolean }>(
        `/chatrooms/${chatroomId}/thumbnail`,
        formData
      );
      onThumbnailChange?.(result);
    } catch {
      alert("Failed to upload thumbnail.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await del<{ cover_image_url: string | null; has_custom_thumbnail: boolean }>(
        `/chatrooms/${chatroomId}/thumbnail`
      );
      onThumbnailChange?.(result);
    } catch {
      alert("Failed to revert thumbnail.");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div className="card-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="card-menu-btn"
        aria-label="Thumbnail options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className="card-menu-popover" role="menu">
          <button
            type="button"
            className="card-menu-item"
            role="menuitem"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload thumbnail
          </button>
          <button
            type="button"
            className="card-menu-item"
            role="menuitem"
            disabled={busy || !hasCustomThumbnail}
            onClick={handleRevert}
          >
            Revert to cover
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default function ChatroomCard({
  name,
  coverImageUrl = null,
  hasCustomThumbnail = false,
  readiness = null,
  viewOnly = false,
  onThumbnailChange,
  chatroomId,
}: ChatroomCardProps) {
  const router = useRouter();
  const slug = slugify(name);
  const isAskReady = readiness?.is_ask_ready ?? false;

  const askTitle = isAskReady
    ? `Ask ${name}`
    : readiness?.published_at
      ? "This chatroom is unpublished — pipeline stages changed after last publish."
      : "Complete all processing steps and publish this chatroom first.";

  if (viewOnly) {
    return (
      <div
        className="chatroom-card chatroom-card--viewonly"
        role="button"
        tabIndex={0}
        onClick={() => router.push(`/admin/${slug}/ask`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(`/admin/${slug}/ask`);
          }
        }}
      >
        {coverImageUrl ? (
          <img className="card-image" src={coverImageUrl} alt={name} />
        ) : (
          <div className="card-fallback" aria-hidden="true" />
        )}
        <div className="card-info">
          <span className="card-name">{name}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chatroom-card">
      <div className="card-image-wrap">
        {coverImageUrl ? (
          <img className="card-image" src={coverImageUrl} alt={name} />
        ) : (
          <div className="card-fallback" aria-hidden="true" />
        )}
        <CardThumbnailMenu
          chatroomId={chatroomId}
          hasCustomThumbnail={hasCustomThumbnail}
          onThumbnailChange={onThumbnailChange}
        />
      </div>
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
