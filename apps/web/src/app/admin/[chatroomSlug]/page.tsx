"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get, postForm, patch, ApiError } from "@/lib/api";
import Navbar from "@/components/Navbar";

const MAX_NAME_LENGTH = 50;

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

interface DocumentMeta {
  id: number;
  file_name: string;
  file_size: number;
  page_count: number;
  last_updated_at: string;
  pdf_url: string | null;
  cover_url: string | null;
}

interface ConfigPageData {
  chatroom_id: number;
  chatroom_name: string;
  document: DocumentMeta | null;
}

const STAGES = [
  { key: "pdf_upload", label: "PDF Upload", active: true },
  { key: "raw_words", label: "Raw Words Detection", active: false },
  { key: "canonical_words", label: "Canonical Words Selection", active: false },
  { key: "outline", label: "Outline Generation", active: false },
  { key: "chunks", label: "Chunk Assignment", active: false },
  { key: "embeddings", label: "Embeddings Generation", active: false },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function ConfigPage() {
  const router = useRouter();
  const params = useParams();
  const chatroomSlug = params.chatroomSlug as string;

  const [committedDoc, setCommittedDoc] = useState<DocumentMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [showDirtyWarning, setShowDirtyWarning] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);

  const [chatroomId, setChatroomId] = useState<number | null>(null);
  const [chatroomName, setChatroomName] = useState<string>("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "user") {
      router.replace("/under-construction");
      return;
    }

    get<ConfigPageData>(`/config/${chatroomSlug}`)
      .then((data) => {
        setCommittedDoc(data.document);
        setChatroomId(data.chatroom_id);
        setChatroomName(data.chatroom_name);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load config.";
        setLoadError(msg);
      });
  }, [chatroomSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function guardedNavigate(navigate: () => void) {
    if (isDirty) {
      pendingNavRef.current = navigate;
      setShowDirtyWarning(true);
    } else {
      navigate();
    }
  }

  function handleBack() {
    guardedNavigate(() => router.push("/admin"));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a PDF file.");
      e.target.value = "";
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      alert("File exceeds the 20 MB limit.");
      e.target.value = "";
      return;
    }
    setStagedFile(f);
    setIsDirty(true);
    setCommitError(null);
  }

  async function handleCommitConfirm() {
    if (!stagedFile) return;
    setCommitModalOpen(false);
    setCommitting(true);
    setCommitError(null);

    const formData = new FormData();
    formData.append("file", stagedFile);

    try {
      const doc = await postForm<DocumentMeta>(`/config/${chatroomSlug}/commit`, formData);
      setCommittedDoc(doc);
      setStagedFile(null);
      setIsDirty(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Commit failed. Please try again.";
      setCommitError(msg);
    } finally {
      setCommitting(false);
    }
  }

  function beginEditName() {
    if (isSavingName) return;
    setDraftName(chatroomName);
    setNameError(null);
    setIsEditingName(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }

  function cancelEditName() {
    setIsEditingName(false);
    setDraftName(chatroomName);
    setNameError(null);
  }

  async function handleSaveName() {
    if (!chatroomId) return;
    const trimmed = draftName.trim();

    if (trimmed === chatroomName) {
      setIsEditingName(false);
      setNameError(null);
      return;
    }

    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setNameError(`Name must be ${MAX_NAME_LENGTH} characters or fewer`);
      return;
    }

    setIsSavingName(true);
    setNameError(null);
    try {
      const updated = await patch<{ id: number; name: string }>(
        `/chatrooms/${chatroomId}`,
        { name: trimmed },
      );
      setChatroomName(updated.name);
      setIsEditingName(false);
      const newSlug = slugify(updated.name);
      if (newSlug !== chatroomSlug) {
        router.replace(`/admin/${newSlug}`);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setNameError(err.message);
      } else {
        setNameError("Failed to rename chatroom");
      }
    } finally {
      setIsSavingName(false);
    }
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditName();
    }
  }

  const titleSlot = chatroomName ? (
    isEditingName ? (
      <span className="config-chatroom-title-editing">
        <input
          ref={nameInputRef}
          className="config-chatroom-titleInput"
          type="text"
          maxLength={MAX_NAME_LENGTH}
          value={draftName}
          aria-label="Chatroom name"
          disabled={isSavingName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={handleNameKeyDown}
        />
        {nameError && (
          <span className="config-chatroom-titleError" role="alert">
            {nameError}
          </span>
        )}
      </span>
    ) : (
      <span
        className="config-chatroom-title"
        role="button"
        tabIndex={0}
        title="Click to rename"
        onClick={beginEditName}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            beginEditName();
          }
        }}
      >
        {chatroomName}
      </span>
    )
  ) : null;

  return (
    <div className="config-page">
      <Navbar onBack={handleBack} titleSlot={titleSlot} />

      {loadError ? (
        <div className="config-load-error">
          <p>{loadError}</p>
        </div>
      ) : (
        <div className="config-main">
          {/* Left — Pipeline Stages */}
          <div className="stage-panel">
            <h2 className="panel-heading">Pipeline Stages</h2>
            <ul className="stage-list">
              {STAGES.map((stage) => (
                <li
                  key={stage.key}
                  className={`stage-chip ${stage.active ? "chip-active" : "chip-disabled"} ${
                    stage.key === "pdf_upload" && committedDoc ? "chip-committed" : ""
                  }`}
                >
                  <span className="chip-label">{stage.label}</span>
                  {stage.key === "pdf_upload" && (
                    <span className="chip-status">
                      {committedDoc ? "Committed" : "Not committed"}
                    </span>
                  )}
                  {stage.key === "pdf_upload" && committedDoc && (
                    <span className="chip-meta">
                      {formatDate(committedDoc.last_updated_at)} &middot;{" "}
                      {formatBytes(committedDoc.file_size)} &middot;{" "}
                      {committedDoc.page_count} pages
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Middle — Action Panel */}
          <div className="action-panel">
            <h2 className="panel-heading">PDF Upload</h2>

            <div className="file-input-area">
              <label className="file-label" htmlFor="pdf-upload">
                Choose PDF
              </label>
              <input
                id="pdf-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={committing}
              />
              {stagedFile && (
                <div className="staged-file-info">
                  <span className="staged-file-name">{stagedFile.name}</span>
                  <span className="staged-file-size">{formatBytes(stagedFile.size)}</span>
                </div>
              )}
            </div>

            {commitError && <p className="commit-error">{commitError}</p>}

            <button
              className="commit-btn"
              onClick={() => setCommitModalOpen(true)}
              disabled={!stagedFile || committing}
            >
              {committing ? "Committing…" : "Commit Updates"}
            </button>
          </div>

          {/* Right — PDF Viewer */}
          <div className="pdf-panel">
            {committedDoc?.pdf_url ? (
              <embed
                className="pdf-viewer"
                src={committedDoc.pdf_url}
                type="application/pdf"
              />
            ) : (
              <div className="pdf-empty-state">
                <p>No PDF committed yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commit confirmation modal */}
      {commitModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Commit PDF?</h2>
              <button onClick={() => setCommitModalOpen(false)} aria-label="Cancel">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                This will upload <strong>{stagedFile?.name}</strong> and overwrite any existing PDF
                and cover image for this chatroom.
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={() => setCommitModalOpen(false)}>
                Cancel
              </button>
              <button className="modal-confirm-btn" onClick={handleCommitConfirm}>
                Commit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dirty navigation warning */}
      {showDirtyWarning && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Uncommitted changes</h2>
            </div>
            <div className="modal-body">
              <p>You have a staged file that hasn&apos;t been committed. Leave anyway?</p>
            </div>
            <div className="modal-footer">
              <button
                className="modal-cancel-btn"
                onClick={() => {
                  setShowDirtyWarning(false);
                  pendingNavRef.current = null;
                }}
              >
                Stay
              </button>
              <button
                className="modal-confirm-btn"
                onClick={() => {
                  setShowDirtyWarning(false);
                  pendingNavRef.current?.();
                  pendingNavRef.current = null;
                }}
              >
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
