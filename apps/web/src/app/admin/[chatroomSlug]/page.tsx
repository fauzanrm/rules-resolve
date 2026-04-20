"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get, post, postForm, patch, ApiError } from "@/lib/api";
import Navbar from "@/components/Navbar";
import RawWordsOverlay from "@/components/config/RawWordsOverlay";
import RawWordsHoverCard from "@/components/config/RawWordsHoverCard";
import { RawWord, RawWordsPayload } from "@/components/config/rawWordsTypes";

const MAX_NAME_LENGTH = 50;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  { key: "pdf_upload", label: "PDF Upload" },
  { key: "raw_words", label: "Raw Words Detection" },
  { key: "canonical_words", label: "Canonical Words Selection" },
  { key: "outline", label: "Outline Generation" },
  { key: "chunks", label: "Chunk Assignment" },
  { key: "embeddings", label: "Embeddings Generation" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

interface RawWordsState {
  chatroom_id: number;
  document_id: number | null;
  has_source_pdf: boolean;
  raw_words: RawWordsPayload | null;
  error?: string | null;
}

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

  const [activeStage, setActiveStage] = useState<StageKey>("pdf_upload");
  const [hasSourcePdf, setHasSourcePdf] = useState(false);
  const [committedRawWords, setCommittedRawWords] = useState<RawWordsPayload | null>(null);
  const [generatedRawWords, setGeneratedRawWords] = useState<RawWordsPayload | null>(null);
  const [rawWordsStatus, setRawWordsStatus] = useState<
    "idle" | "generating" | "generated" | "committing" | "success" | "error"
  >("idle");
  const [rawWordsError, setRawWordsError] = useState<string | null>(null);
  const [hoveredWord, setHoveredWord] = useState<RawWord | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const hasGeneratedRawWords = generatedRawWords !== null;
  const hasCommittedRawWords = committedRawWords !== null;
  const isRawWordsDirty = hasGeneratedRawWords;

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
        return get<RawWordsState>(`/raw-words/${data.chatroom_id}`);
      })
      .then((rw) => {
        if (!rw) return;
        setHasSourcePdf(rw.has_source_pdf);
        if (rw.raw_words) {
          setCommittedRawWords(rw.raw_words);
        }
        if (rw.error) {
          setRawWordsError(rw.error);
          setRawWordsStatus("error");
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load config.";
        setLoadError(msg);
      });
  }, [chatroomSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyDirty = isDirty || isRawWordsDirty;

  useEffect(() => {
    if (!anyDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [anyDirty]);

  function guardedNavigate(navigate: () => void) {
    if (anyDirty) {
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
      // Source PDF changed: any prior raw words are now invalidated
      setCommittedRawWords(null);
      setGeneratedRawWords(null);
      setHoveredWord(null);
      setHoveredIndex(null);
      setRawWordsStatus("idle");
      setRawWordsError(null);
      setHasSourcePdf(true);
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

  async function handleGenerateRawWords() {
    if (!chatroomId) return;
    setRawWordsStatus("generating");
    setRawWordsError(null);
    try {
      const payload = await post<RawWordsPayload>(
        `/raw-words/${chatroomId}/generate`,
        {},
      );
      setGeneratedRawWords(payload);
      setRawWordsStatus("generated");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Generation failed";
      setRawWordsError(msg);
      setRawWordsStatus("error");
    }
  }

  async function handleCommitRawWords() {
    if (!chatroomId || !generatedRawWords) return;
    setRawWordsStatus("committing");
    setRawWordsError(null);
    try {
      const committed = await post<RawWordsPayload>(
        `/raw-words/${chatroomId}/commit`,
        { payload: generatedRawWords },
      );
      setCommittedRawWords(committed);
      setGeneratedRawWords(null);
      setRawWordsStatus("success");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Commit failed";
      setRawWordsError(msg);
      setRawWordsStatus("error");
    }
  }

  function handleRawWordHover(word: RawWord | null, index: number | null) {
    setHoveredWord(word);
    setHoveredIndex(index);
  }

  function handleSelectStage(key: StageKey) {
    if (key === "pdf_upload") {
      setActiveStage("pdf_upload");
      return;
    }
    if (key === "raw_words" && (hasSourcePdf || hasCommittedRawWords)) {
      setActiveStage("raw_words");
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
              {STAGES.map((stage) => {
                const isPdf = stage.key === "pdf_upload";
                const isRaw = stage.key === "raw_words";
                const clickable = isPdf || (isRaw && (hasSourcePdf || hasCommittedRawWords));
                const isActive = stage.key === activeStage;
                const committedClass =
                  (isPdf && committedDoc) || (isRaw && hasCommittedRawWords && !hasGeneratedRawWords)
                    ? "chip-committed"
                    : "";
                const generatedClass =
                  isRaw && hasGeneratedRawWords ? "chip-generated" : "";
                const disabledClass = clickable ? "chip-active" : "chip-disabled";
                return (
                  <li
                    key={stage.key}
                    className={`stage-chip ${disabledClass} ${committedClass} ${generatedClass} ${
                      isActive ? "chip-selected" : ""
                    }`}
                    onClick={() => handleSelectStage(stage.key as StageKey)}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : -1}
                  >
                    <span className="chip-label">{stage.label}</span>
                    {isPdf && (
                      <span className="chip-status">
                        {committedDoc ? "Committed" : "Not committed"}
                      </span>
                    )}
                    {isPdf && committedDoc && (
                      <span className="chip-meta">
                        {formatDate(committedDoc.last_updated_at)} &middot;{" "}
                        {formatBytes(committedDoc.file_size)} &middot;{" "}
                        {committedDoc.page_count} pages
                      </span>
                    )}
                    {isRaw && !hasSourcePdf && (
                      <span className="stage-helper-text">Upload and commit a PDF first</span>
                    )}
                    {isRaw && hasSourcePdf && hasGeneratedRawWords && (
                      <span className="chip-status">Generated, not yet committed</span>
                    )}
                    {isRaw && hasSourcePdf && !hasGeneratedRawWords && hasCommittedRawWords && (
                      <span className="chip-status">Committed</span>
                    )}
                    {isRaw && hasSourcePdf && !hasGeneratedRawWords && !hasCommittedRawWords && (
                      <span className="chip-status">Not generated</span>
                    )}
                    {isRaw && committedRawWords && (
                      <span className="chip-meta">
                        {committedRawWords.word_count} words &middot;{" "}
                        {committedRawWords.page_count} pages
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Middle — Action Panel */}
          <div className="action-panel">
            {activeStage === "pdf_upload" && (
              <>
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
              </>
            )}

            {activeStage === "raw_words" && (
              <>
                <h2 className="panel-heading">Raw Words</h2>
                <p className="action-status-banner">
                  {rawWordsStatus === "generating" && "Generating raw words…"}
                  {rawWordsStatus === "committing" && "Committing…"}
                  {rawWordsStatus === "success" && "Committed."}
                  {rawWordsStatus === "generated" && "Generated. Not yet committed."}
                  {rawWordsStatus === "idle" &&
                    (hasCommittedRawWords
                      ? "Committed baseline loaded."
                      : "No raw words yet.")}
                  {rawWordsStatus === "error" && "Something went wrong."}
                </p>
                {(generatedRawWords || committedRawWords) && (
                  <p className="raw-words-summary">
                    {(generatedRawWords ?? committedRawWords)!.word_count} words across{" "}
                    {(generatedRawWords ?? committedRawWords)!.page_count} pages
                  </p>
                )}
                {rawWordsError && (
                  <p className="commit-error" role="alert">
                    {rawWordsError}
                  </p>
                )}
                <button
                  className="commit-btn"
                  onClick={handleGenerateRawWords}
                  disabled={
                    !hasSourcePdf ||
                    rawWordsStatus === "generating" ||
                    rawWordsStatus === "committing"
                  }
                >
                  {rawWordsStatus === "generating"
                    ? "Generating…"
                    : hasGeneratedRawWords || hasCommittedRawWords
                      ? "Regenerate Raw Words"
                      : "Generate Raw Words"}
                </button>
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={handleCommitRawWords}
                  disabled={!hasGeneratedRawWords || rawWordsStatus === "committing"}
                >
                  {rawWordsStatus === "committing" ? "Committing…" : "Commit Changes"}
                </button>
              </>
            )}
          </div>

          {/* Right — Viewer */}
          <div className="pdf-panel">
            {activeStage === "pdf_upload" && (
              committedDoc?.pdf_url ? (
                <embed
                  className="pdf-viewer"
                  src={committedDoc.pdf_url}
                  type="application/pdf"
                />
              ) : (
                <div className="pdf-empty-state">
                  <p>No PDF committed yet</p>
                </div>
              )
            )}

            {activeStage === "raw_words" && (
              <div
                className="raw-words-viewer"
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setMousePos(null)}
              >
                {generatedRawWords || committedRawWords ? (
                  <>
                    <RawWordsOverlay
                      payload={(generatedRawWords ?? committedRawWords)!}
                      variant={generatedRawWords ? "generated" : "committed"}
                      getPageImageUrl={
                        committedDoc
                          ? (pageNum) => `${API_BASE}/config/${chatroomSlug}/page-image/${pageNum}`
                          : null
                      }
                      onHover={handleRawWordHover}
                    />
                    <RawWordsHoverCard word={hoveredWord} index={hoveredIndex} mousePos={mousePos} />
                  </>
                ) : (
                  <div className="pdf-empty-state">
                    <p>
                      {hasSourcePdf
                        ? "Click Generate Raw Words to extract word-level quads."
                        : "Upload and commit a PDF first."}
                    </p>
                  </div>
                )}
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
