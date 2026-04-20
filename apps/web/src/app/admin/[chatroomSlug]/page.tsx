"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get, post, postForm, patch, ApiError } from "@/lib/api";
import Navbar from "@/components/Navbar";
import RawWordsOverlay from "@/components/config/RawWordsOverlay";
import RawWordsHoverCard from "@/components/config/RawWordsHoverCard";
import CanonicalWordsOverlay from "@/components/config/CanonicalWordsOverlay";
import { RawWord, RawWordsPayload } from "@/components/config/rawWordsTypes";
import { CanonicalWordsState } from "@/components/config/canonicalWordsTypes";

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

  // Canonical words stage state
  const [committedCanonicalWordIds, setCommittedCanonicalWordIds] = useState<Set<string> | null>(null);
  const [canonicalCommittedAt, setCanonicalCommittedAt] = useState<string | null>(null);
  const [workingIncludedIds, setWorkingIncludedIds] = useState<Set<string> | null>(null);
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [canonicalStatus, setCanonicalStatus] = useState<"idle" | "committing" | "success" | "error">("idle");
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [hoveredCanonicalWordId, setHoveredCanonicalWordId] = useState<string | null>(null);
  const [canonicalMousePos, setCanonicalMousePos] = useState<{ x: number; y: number } | null>(null);

  // Modal for warning before raw words regeneration
  const [rawWordsGenWarnOpen, setRawWordsGenWarnOpen] = useState(false);

  const hasGeneratedRawWords = generatedRawWords !== null;
  const hasCommittedRawWords = committedRawWords !== null;
  const isRawWordsDirty = hasGeneratedRawWords;

  const isCanonicalDirty = useMemo(() => {
    if (!workingIncludedIds || !committedRawWords) return false;
    const reference = committedCanonicalWordIds
      ?? new Set(committedRawWords.words.map((w) => w.word_id));
    if (workingIncludedIds.size !== reference.size) return true;
    for (const id of workingIncludedIds) if (!reference.has(id)) return true;
    return false;
  }, [workingIncludedIds, committedCanonicalWordIds, committedRawWords]);

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

    async function loadPage() {
      const data = await get<ConfigPageData>(`/config/${chatroomSlug}`);
      setCommittedDoc(data.document);
      setChatroomId(data.chatroom_id);
      setChatroomName(data.chatroom_name);

      const rw = await get<RawWordsState>(`/raw-words/${data.chatroom_id}`);
      setHasSourcePdf(rw.has_source_pdf);
      const rawWordsPayload = rw.raw_words ?? null;
      if (rawWordsPayload) setCommittedRawWords(rawWordsPayload);
      if (rw.error) { setRawWordsError(rw.error); setRawWordsStatus("error"); }

      const cw = await get<CanonicalWordsState>(`/canonical-words/${data.chatroom_id}`);
      if (cw.committed_words?.length && rawWordsPayload) {
        const ids = new Set(
          cw.committed_words
            .map((w) => rawWordsPayload.words[w.raw_word_index]?.word_id)
            .filter((id): id is string => Boolean(id)),
        );
        if (ids.size > 0) {
          setCommittedCanonicalWordIds(ids);
          setCanonicalCommittedAt(cw.committed_at);
        }
      }
    }

    loadPage().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to load config.";
      setLoadError(msg);
    });
  }, [chatroomSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Precomputed maps for canonical tooltip
  const rawWordIndexMap = useMemo(() => {
    if (!committedRawWords) return new Map<string, number>();
    const map = new Map<string, number>();
    committedRawWords.words.forEach((w, i) => map.set(w.word_id, i));
    return map;
  }, [committedRawWords]);

  const workingCanonicalIndexMap = useMemo(() => {
    if (!workingIncludedIds || !committedRawWords) return new Map<string, number>();
    const sorted = committedRawWords.words
      .filter((w) => workingIncludedIds.has(w.word_id))
      .sort(
        (a, b) =>
          a.page - b.page ||
          a.block_no - b.block_no ||
          a.line_no - b.line_no ||
          a.word_no - b.word_no,
      );
    const map = new Map<string, number>();
    sorted.forEach((w, i) => map.set(w.word_id, i));
    return map;
  }, [workingIncludedIds, committedRawWords]);

  const anyDirty = isDirty || isRawWordsDirty || isCanonicalDirty;

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
      // Source PDF changed: invalidate raw words and canonical words
      setCommittedRawWords(null);
      setGeneratedRawWords(null);
      setHoveredWord(null);
      setHoveredIndex(null);
      setRawWordsStatus("idle");
      setRawWordsError(null);
      setHasSourcePdf(true);
      setCommittedCanonicalWordIds(null);
      setWorkingIncludedIds(null);
      setSelectedWordIds(new Set());
      setCanonicalStatus("idle");
      setCanonicalError(null);
      setCanonicalCommittedAt(null);
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

  function handleWordDragEnter(wordId: string) {
    setSelectedWordIds((prev) => {
      const next = new Set(prev);
      next.add(wordId);
      return next;
    });
  }

  function handleRectSelect(wordIds: string[]) {
    setSelectedWordIds((prev) => {
      const next = new Set(prev);
      wordIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function handleGenerateRawWordsClick() {
    if (committedCanonicalWordIds !== null) {
      setRawWordsGenWarnOpen(true);
    } else {
      handleGenerateRawWords();
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
      // Raw words replaced: canonical words are now invalid
      setCommittedCanonicalWordIds(null);
      setWorkingIncludedIds(null);
      setSelectedWordIds(new Set());
      setCanonicalStatus("idle");
      setCanonicalError(null);
      setCanonicalCommittedAt(null);
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

  function openCanonicalStage() {
    if (workingIncludedIds === null && committedRawWords) {
      const reference = committedCanonicalWordIds
        ?? new Set(committedRawWords.words.map((w) => w.word_id));
      setWorkingIncludedIds(new Set(reference));
    }
    setActiveStage("canonical_words");
  }

  function handleSelectStage(key: StageKey) {
    if (key === "pdf_upload") {
      setActiveStage("pdf_upload");
      return;
    }
    if (key === "raw_words" && (hasSourcePdf || hasCommittedRawWords)) {
      setActiveStage("raw_words");
      return;
    }
    if (key === "canonical_words" && hasCommittedRawWords) {
      openCanonicalStage();
    }
  }

  function handleWordClick(wordId: string) {
    setSelectedWordIds((prev) => {
      const next = new Set(prev);
      next.has(wordId) ? next.delete(wordId) : next.add(wordId);
      return next;
    });
  }

  function handleExcludeSelected() {
    if (!workingIncludedIds) return;
    setWorkingIncludedIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const id of selectedWordIds) next.delete(id);
      return next;
    });
    setSelectedWordIds(new Set());
  }

  function handleIncludeSelected() {
    if (!workingIncludedIds) return;
    setWorkingIncludedIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const id of selectedWordIds) next.add(id);
      return next;
    });
    setSelectedWordIds(new Set());
  }

  function handleResetToAllIncluded() {
    if (!committedRawWords) return;
    setWorkingIncludedIds(new Set(committedRawWords.words.map((w) => w.word_id)));
    setSelectedWordIds(new Set());
  }

  async function handleCommitCanonical() {
    if (!chatroomId || !workingIncludedIds || !committedRawWords) return;
    setCanonicalStatus("committing");
    setCanonicalError(null);
    try {
      const included_raw_word_indices = Array.from(workingIncludedIds)
        .map((id) => rawWordIndexMap.get(id))
        .filter((i): i is number => i !== undefined);

      const result = await post<CanonicalWordsState>(
        `/canonical-words/${chatroomId}/commit`,
        { included_raw_word_indices },
      );

      const ids = new Set(
        result.committed_words
          ?.map((w) => committedRawWords.words[w.raw_word_index]?.word_id)
          .filter((id): id is string => Boolean(id)) ?? [],
      );
      setCommittedCanonicalWordIds(ids);
      setWorkingIncludedIds(new Set(ids));
      setCanonicalCommittedAt(result.committed_at);
      setSelectedWordIds(new Set());
      setCanonicalStatus("success");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Commit failed";
      setCanonicalError(msg);
      setCanonicalStatus("error");
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
                const isCanonical = stage.key === "canonical_words";
                const clickable =
                  isPdf ||
                  (isRaw && (hasSourcePdf || hasCommittedRawWords)) ||
                  (isCanonical && hasCommittedRawWords);
                const isActive = stage.key === activeStage;
                const hasCommittedCanonical = committedCanonicalWordIds !== null;
                const committedClass =
                  (isPdf && committedDoc) ||
                  (isRaw && hasCommittedRawWords && !hasGeneratedRawWords) ||
                  (isCanonical && hasCommittedCanonical && !isCanonicalDirty)
                    ? "chip-committed"
                    : "";
                const generatedClass =
                  (isRaw && hasGeneratedRawWords) || (isCanonical && isCanonicalDirty && workingIncludedIds !== null)
                    ? "chip-generated"
                    : "";
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
                    {isCanonical && !hasCommittedRawWords && (
                      <span className="stage-helper-text">Generate Raw Words first</span>
                    )}
                    {isCanonical && hasCommittedRawWords && committedCanonicalWordIds === null && (
                      <span className="chip-status">Not committed</span>
                    )}
                    {isCanonical && hasCommittedRawWords && committedCanonicalWordIds !== null && !isCanonicalDirty && (
                      <span className="chip-status">Committed</span>
                    )}
                    {isCanonical && hasCommittedRawWords && isCanonicalDirty && (
                      <span className="chip-status">Unsaved changes</span>
                    )}
                    {isCanonical && committedCanonicalWordIds !== null && (
                      <span className="chip-meta">
                        {committedCanonicalWordIds.size} words included
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
                  onClick={handleGenerateRawWordsClick}
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

            {activeStage === "canonical_words" && workingIncludedIds !== null && committedRawWords && (
              <>
                <h2 className="panel-heading">Canonical Words</h2>
                <p className="action-status-banner">
                  {canonicalStatus === "committing" && "Committing…"}
                  {canonicalStatus === "success" && `Committed.${canonicalCommittedAt ? " " + formatDate(canonicalCommittedAt) : ""}`}
                  {canonicalStatus === "error" && "Something went wrong."}
                  {canonicalStatus === "idle" && (
                    isCanonicalDirty
                      ? "Unsaved changes."
                      : committedCanonicalWordIds !== null
                        ? `Committed.${canonicalCommittedAt ? " " + formatDate(canonicalCommittedAt) : ""}`
                        : "All words included by default."
                  )}
                </p>
                <div className="canonical-count-row">
                  <span><span className="canonical-count-label">Raw </span>{committedRawWords.word_count}</span>
                  <span><span className="canonical-count-label">Included </span>{workingIncludedIds.size}</span>
                  <span><span className="canonical-count-label">Excluded </span>{committedRawWords.word_count - workingIncludedIds.size}</span>
                </div>
                {selectedWordIds.size > 0 && (
                  <p className="canonical-selection-summary">{selectedWordIds.size} selected</p>
                )}
                {canonicalError && (
                  <p className="commit-error" role="alert">{canonicalError}</p>
                )}
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={() => setSelectedWordIds(new Set())}
                  disabled={selectedWordIds.size === 0}
                >
                  Clear Selection
                </button>
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={handleExcludeSelected}
                  disabled={selectedWordIds.size === 0 || ![...selectedWordIds].some((id) => workingIncludedIds.has(id))}
                >
                  Exclude selected
                </button>
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={handleIncludeSelected}
                  disabled={selectedWordIds.size === 0 || ![...selectedWordIds].some((id) => !workingIncludedIds.has(id))}
                >
                  Include selected
                </button>
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={handleResetToAllIncluded}
                  disabled={workingIncludedIds.size === committedRawWords.word_count}
                >
                  Reset to all included
                </button>
                <button
                  className="commit-btn"
                  onClick={handleCommitCanonical}
                  disabled={!isCanonicalDirty || canonicalStatus === "committing"}
                >
                  {canonicalStatus === "committing" ? "Committing…" : "Commit Updates"}
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

            {activeStage === "canonical_words" && (
              <div
                className="raw-words-viewer"
                onMouseMove={(e) => setCanonicalMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setCanonicalMousePos(null);
                  setHoveredCanonicalWordId(null);
                }}
              >
                {workingIncludedIds !== null && committedRawWords ? (
                  <CanonicalWordsOverlay
                    rawWordsPayload={committedRawWords}
                    workingIncludedIds={workingIncludedIds}
                    selectedWordIds={selectedWordIds}
                    getPageImageUrl={
                      committedDoc
                        ? (pageNum) => `${API_BASE}/config/${chatroomSlug}/page-image/${pageNum}`
                        : null
                    }
                    onWordClick={handleWordClick}
                    onWordDragEnter={handleWordDragEnter}
                    onRectSelect={handleRectSelect}
                    onHover={setHoveredCanonicalWordId}
                  />
                ) : (
                  <div className="pdf-empty-state">
                    <p>Generate and commit Raw Words first.</p>
                  </div>
                )}
              </div>
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

      {/* Canonical words hover tooltip */}
      {activeStage === "canonical_words" && hoveredCanonicalWordId && canonicalMousePos && committedRawWords && workingIncludedIds && (
        <div
          className="canonical-tooltip"
          style={{ left: canonicalMousePos.x + 14, top: canonicalMousePos.y + 14 }}
          role="status"
        >
          {(() => {
            const rawIdx = rawWordIndexMap.get(hoveredCanonicalWordId) ?? -1;
            const word = committedRawWords.words[rawIdx];
            const canonIdx = workingCanonicalIndexMap.get(hoveredCanonicalWordId);
            const isIncluded = workingIncludedIds.has(hoveredCanonicalWordId);
            return (
              <>
                <div className="canonical-tooltip-text">{word?.text ?? "—"}</div>
                <div className="canonical-tooltip-row">
                  <span className="canonical-tooltip-label">Raw index</span>
                  <span>{rawIdx >= 0 ? rawIdx : "—"}</span>
                </div>
                <div className="canonical-tooltip-row">
                  <span className="canonical-tooltip-label">Canonical index</span>
                  <span>{isIncluded && canonIdx !== undefined ? canonIdx : "Not included"}</span>
                </div>
              </>
            );
          })()}
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
              {(hasCommittedRawWords || committedCanonicalWordIds !== null) && (
                <p className="modal-warning">
                  Raw words detection{committedCanonicalWordIds !== null ? " and canonical words selection" : ""} will be cleared and must be redone.
                </p>
              )}
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

      {/* Raw words regeneration warning modal */}
      {rawWordsGenWarnOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Regenerate raw words?</h2>
            </div>
            <div className="modal-body">
              <p className="modal-warning">
                This will clear all committed canonical words. You will need to redo the canonical words selection.
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={() => setRawWordsGenWarnOpen(false)}>
                Cancel
              </button>
              <button
                className="modal-confirm-btn"
                onClick={() => {
                  setRawWordsGenWarnOpen(false);
                  handleGenerateRawWords();
                }}
              >
                Continue
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
