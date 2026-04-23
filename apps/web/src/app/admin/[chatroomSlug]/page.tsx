"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get, post, postForm, patch, ApiError } from "@/lib/api";
import Navbar from "@/components/Navbar";
import RawWordsOverlay from "@/components/config/RawWordsOverlay";
import RawWordsHoverCard from "@/components/config/RawWordsHoverCard";
import CanonicalWordsOverlay from "@/components/config/CanonicalWordsOverlay";
import OutlineNodesOverlay from "@/components/config/OutlineNodesOverlay";
import ChunksOverlay from "@/components/config/ChunksOverlay";
import { RawWord, RawWordsPayload } from "@/components/config/rawWordsTypes";
import { CanonicalWordsState } from "@/components/config/canonicalWordsTypes";
import {
  DraftNode,
  CommittedNodeApi,
  NodesApiResponse,
  HeadingLevel,
  committedToDraft,
  draftToApi,
  validateHierarchy,
  levelToNum,
  numToLevel,
  getNodeSubtree,
} from "@/components/config/outlineTypes";
import {
  DraftChunk,
  ChunkItemApi,
  ChunksApiResponse,
  committedToDraft as chunkCommittedToDraft,
  draftToApi as chunkDraftToApi,
} from "@/components/config/chunkTypes";

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

  // Outline stage state
  const [committedNodes, setCommittedNodes] = useState<CommittedNodeApi[] | null>(null);
  const [workingNodes, setWorkingNodes] = useState<DraftNode[] | null>(null);
  const [outlineStatus, setOutlineStatus] = useState<"idle" | "committing" | "success" | "error">("idle");
  const [outlineCommittedAt, setOutlineCommittedAt] = useState<string | null>(null);
  const [selectedCanonicalIndices, setSelectedCanonicalIndices] = useState<Set<number>>(new Set());
  const [activeNodeClientId, setActiveNodeClientId] = useState<string | null>(null);
  const [inferredNodeForm, setInferredNodeForm] = useState<{ label: string; level: HeadingLevel | "" } | null>(null);
  const [canonicalCommitWarnOpen, setCanonicalCommitWarnOpen] = useState(false);
  const [outlineZoom, setOutlineZoom] = useState(1.0);
  const [hoveredOutlineIndex, setHoveredOutlineIndex] = useState<number | null>(null);
  const [outlineMousePos, setOutlineMousePos] = useState<{ x: number; y: number } | null>(null);
  const dragNodeClientIdRef = useRef<string | null>(null);
  const [nodeDropTarget, setNodeDropTarget] = useState<
    { type: "before"; anchorId: string } | { type: "on"; targetId: string } | { type: "end" } | null
  >(null);
  const [dragSubtreeIds, setDragSubtreeIds] = useState<Set<string>>(new Set());

  // Chunks stage state
  const [committedChunks, setCommittedChunks] = useState<ChunkItemApi[] | null>(null);
  const [workingChunks, setWorkingChunks] = useState<DraftChunk[] | null>(null);
  const [chunksStatus, setChunksStatus] = useState<"idle" | "committing" | "success" | "error">("idle");
  const [selectedChunkCanonicalIndices, setSelectedChunkCanonicalIndices] = useState<Set<number>>(new Set());
  const [activeChunkClientId, setActiveChunkClientId] = useState<string | null>(null);
  const [activeNodeIndexForChunk, setActiveNodeIndexForChunk] = useState<number | null>(null);
  const [chunkZoom, setChunkZoom] = useState(1.0);
  const [hoveredChunkCanonicalIndex, setHoveredChunkCanonicalIndex] = useState<number | null>(null);
  const [chunkMousePos, setChunkMousePos] = useState<{ x: number; y: number } | null>(null);
  const [nodesCommitWarnOpen, setNodesCommitWarnOpen] = useState(false);
  const dragChunkClientIdRef = useRef<string | null>(null);
  const [chunksPanelSplit, setChunksPanelSplit] = useState<number>(65);
  const isDividerDraggingRef = useRef(false);
  const dividerContainerRef = useRef<HTMLDivElement>(null);

  // Toast notifications
  type ToastItem = { id: string; message: string };
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  function addToast(message: string) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }
  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

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

  const isOutlineDirty = useMemo(() => {
    if (!workingNodes && !committedNodes) return false;
    const working = (workingNodes ?? []).map(draftToApi);
    const committed = (committedNodes ?? []).map((n) => ({
      node_type: n.node_type,
      label: n.label,
      start_canonical_index: n.start_canonical_index,
      end_canonical_index: n.end_canonical_index,
    }));
    return JSON.stringify(working) !== JSON.stringify(committed);
  }, [workingNodes, committedNodes]);

  const isChunksDirty = useMemo(() => {
    if (!workingChunks && !committedChunks) return false;
    const working = (workingChunks ?? []).map((c, i) => chunkDraftToApi(c, i));
    return JSON.stringify(working) !== JSON.stringify(committedChunks ?? []);
  }, [workingChunks, committedChunks]);

  const chunkNodeInfoMap = useMemo(() => {
    const map = new Map<number, { chunk: DraftChunk }>();
    (workingChunks ?? []).forEach((chunk) => {
      for (let i = chunk.startCanonicalIndex; i <= chunk.endCanonicalIndex; i++) {
        map.set(i, { chunk });
      }
    });
    return map;
  }, [workingChunks]);

  const chunkNodeRangeInfoMap = useMemo(() => {
    const map = new Map<number, { nodeIndex: number; nodeType: string; label: string }>();
    (committedNodes ?? []).forEach((node, nodeIndex) => {
      const isInferred = node.start_canonical_index === 0 && node.end_canonical_index === 0;
      if (!isInferred) {
        for (let i = node.start_canonical_index; i <= node.end_canonical_index; i++) {
          map.set(i, { nodeIndex, nodeType: node.node_type, label: node.label });
        }
      }
    });
    return map;
  }, [committedNodes]);

  const chunkClientIdToDisplayIndex = useMemo(() => {
    const map = new Map<string, number>();
    (workingChunks ?? []).forEach((c, i) => map.set(c.clientId, i));
    return map;
  }, [workingChunks]);

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

      const nd = await get<NodesApiResponse>(`/nodes/${data.chatroom_id}`);
      if (nd.committed_nodes?.length) {
        setCommittedNodes(nd.committed_nodes);
        setWorkingNodes(nd.committed_nodes.map(committedToDraft));
      }

      const ck = await get<ChunksApiResponse>(`/chunks/${data.chatroom_id}`);
      if (ck.committed_chunks?.length) {
        setCommittedChunks(ck.committed_chunks);
        setWorkingChunks(ck.committed_chunks.map(chunkCommittedToDraft));
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

  // Canonical words ordered list for the outline overlay
  const canonicalWords = useMemo(() => {
    if (!committedRawWords || !committedCanonicalWordIds) return [];
    return committedRawWords.words
      .filter((w) => committedCanonicalWordIds.has(w.word_id))
      .sort(
        (a, b) =>
          a.page - b.page ||
          a.block_no - b.block_no ||
          a.line_no - b.line_no ||
          a.word_no - b.word_no,
      );
  }, [committedRawWords, committedCanonicalWordIds]);

  // Map: canonical_index → {nodeIndex, headingLevel, isInferred} for outline tooltip
  const outlineNodeInfoMap = useMemo(() => {
    const map = new Map<number, { nodeIndex: number; headingLevel: string | null; isInferred: boolean }>();
    (workingNodes ?? []).forEach((node, nodeIndex) => {
      if (!node.isInferred) {
        for (let i = node.startCanonicalIndex; i <= node.endCanonicalIndex; i++) {
          map.set(i, { nodeIndex, headingLevel: node.headingLevel, isInferred: false });
        }
      }
    });
    return map;
  }, [workingNodes]);

  const anyDirty = isDirty || isRawWordsDirty || isCanonicalDirty || isOutlineDirty || isChunksDirty;

  useEffect(() => {
    if (!anyDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [anyDirty]);

  useEffect(() => {
    function handleDividerMouseMove(e: MouseEvent) {
      if (!isDividerDraggingRef.current || !dividerContainerRef.current) return;
      const rect = dividerContainerRef.current.getBoundingClientRect();
      const relative = e.clientY - rect.top;
      const pct = Math.max(15, Math.min(85, (relative / rect.height) * 100));
      setChunksPanelSplit(pct);
    }
    function handleDividerMouseUp() {
      isDividerDraggingRef.current = false;
    }
    document.addEventListener("mousemove", handleDividerMouseMove);
    document.addEventListener("mouseup", handleDividerMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleDividerMouseMove);
      document.removeEventListener("mouseup", handleDividerMouseUp);
    };
  }, []);

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
      setCommittedNodes(null);
      setWorkingNodes(null);
      setOutlineStatus("idle");
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
      setCommittedChunks(null);
      setWorkingChunks(null);
      setChunksStatus("idle");
      
      setSelectedChunkCanonicalIndices(new Set());
      setActiveChunkClientId(null);
      setActiveNodeIndexForChunk(null);
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
      // Raw words replaced: canonical words and outline are now invalid
      setCommittedCanonicalWordIds(null);
      setWorkingIncludedIds(null);
      setSelectedWordIds(new Set());
      setCanonicalStatus("idle");
      setCanonicalError(null);
      setCanonicalCommittedAt(null);
      setCommittedNodes(null);
      setWorkingNodes(null);
      setOutlineStatus("idle");
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
      setCommittedChunks(null);
      setWorkingChunks(null);
      setChunksStatus("idle");
      
      setSelectedChunkCanonicalIndices(new Set());
      setActiveChunkClientId(null);
      setActiveNodeIndexForChunk(null);
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
      return;
    }
    if (key === "outline" && committedCanonicalWordIds !== null) {
      if (workingNodes === null) {
        setWorkingNodes(committedNodes ? committedNodes.map(committedToDraft) : []);
      }
      setActiveStage("outline");
    }
    if (key === "chunks" && committedNodes !== null) {
      if (workingChunks === null) {
        setWorkingChunks(committedChunks ? committedChunks.map(chunkCommittedToDraft) : []);
      }
      setActiveStage("chunks");
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

  function handleCommitCanonicalClick() {
    if (committedNodes !== null || (workingNodes && workingNodes.length > 0)) {
      setCanonicalCommitWarnOpen(true);
    } else {
      handleCommitCanonical();
    }
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
      // Canonical words replaced: outline nodes and chunks are now invalid
      setCommittedNodes(null);
      setWorkingNodes(null);
      setOutlineStatus("idle");
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
      setCommittedChunks(null);
      setWorkingChunks(null);
      setChunksStatus("idle");
      
      setSelectedChunkCanonicalIndices(new Set());
      setActiveChunkClientId(null);
      setActiveNodeIndexForChunk(null);
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

  function handleOutlineQuadClick(canonicalIndex: number) {
    if (outlineNodeInfoMap.has(canonicalIndex)) return; // already assigned
    setSelectedCanonicalIndices((prev) => {
      const next = new Set(prev);
      next.has(canonicalIndex) ? next.delete(canonicalIndex) : next.add(canonicalIndex);
      return next;
    });
  }

  function handleOutlineQuadDragEnter(canonicalIndex: number) {
    if (outlineNodeInfoMap.has(canonicalIndex)) return; // already assigned
    setSelectedCanonicalIndices((prev) => {
      const next = new Set(prev);
      next.add(canonicalIndex);
      return next;
    });
  }

  function handleOutlineRectSelect(canonicalIndices: number[]) {
    const unassigned = canonicalIndices.filter((ci) => !outlineNodeInfoMap.has(ci));
    if (unassigned.length === 0) return;
    setSelectedCanonicalIndices((prev) => {
      const next = new Set(prev);
      unassigned.forEach((ci) => next.add(ci));
      return next;
    });
  }

  function handleAddExplicitNode() {
    if (!workingNodes || selectedCanonicalIndices.size === 0) return;
    const sorted = Array.from(selectedCanonicalIndices).sort((a, b) => a - b);
    // Check sequential adjacency
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        addToast("Selected quads must be sequentially adjacent in reading order.");
        return;
      }
    }
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    // Check overlap with existing explicit nodes
    const overlap = workingNodes.some(
      (n) =>
        !n.isInferred &&
        n.startCanonicalIndex > 0 &&
        n.startCanonicalIndex <= end &&
        n.endCanonicalIndex >= start,
    );
    if (overlap) {
      addToast("Selection overlaps an existing explicit node.");
      return;
    }
    const label = sorted
      .map((ci) => canonicalWords[ci]?.text ?? "")
      .filter(Boolean)
      .join(" ");
    const newNode: DraftNode = {
      clientId: crypto.randomUUID(),
      headingLevel: "h1",
      isInferred: false,
      label,
      startCanonicalIndex: start,
      endCanonicalIndex: end,
    };
    // Insert in canonical order relative to other explicit nodes
    const newNodes = [...workingNodes];
    const insertIndex = newNodes.findIndex(
      (n) => !n.isInferred && n.startCanonicalIndex > start,
    );
    if (insertIndex === -1) {
      newNodes.push(newNode);
    } else {
      newNodes.splice(insertIndex, 0, newNode);
    }
    setWorkingNodes(newNodes);
    setSelectedCanonicalIndices(new Set());
  }

  function handleAddInferredNode() {
    if (!inferredNodeForm || !inferredNodeForm.label.trim() || !inferredNodeForm.level) return;
    if (!workingNodes) return;
    const newNode: DraftNode = {
      clientId: crypto.randomUUID(),
      headingLevel: inferredNodeForm.level as HeadingLevel,
      isInferred: true,
      label: inferredNodeForm.label.trim(),
      startCanonicalIndex: 0,
      endCanonicalIndex: 0,
    };
    const newNodes = [...workingNodes, newNode];
    const err = validateHierarchy(newNodes);
    if (err) {
      addToast(err);
      return;
    }
    setWorkingNodes(newNodes);
    setInferredNodeForm(null);
  }

  function handleDeleteNode(clientId: string) {
    if (!workingNodes) return;
    const updated = workingNodes.filter((n) => n.clientId !== clientId);
    const err = validateHierarchy(updated);
    if (err) {
      addToast(`Can't delete this node — it would leave child nodes in an invalid hierarchy. Delete or move child nodes first.`);
      return;
    }
    setWorkingNodes(updated);
    if (activeNodeClientId === clientId) setActiveNodeClientId(null);
  }

  function handleCycleHeadingLevel(clientId: string) {
    const nodes = workingNodes ?? [];
    const current = nodes.find((n) => n.clientId === clientId);
    if (!current) return;
    const levels: HeadingLevel[] = ["h1", "h2", "h3"];
    const currentIdx = current.headingLevel ? levels.indexOf(current.headingLevel) : -1;
    for (let offset = 1; offset <= 3; offset++) {
      const tryLevel = levels[(currentIdx + offset) % 3];
      const updated = nodes.map((n) => n.clientId === clientId ? { ...n, headingLevel: tryLevel } : n);
      if (!validateHierarchy(updated)) {
        setWorkingNodes(updated);
        return;
      }
    }
    // No valid level found — stay as-is
  }

  function buildHierarchyMoveError(reordered: DraftNode[], dragId: string, label: string): string {
    const dragNode = reordered.find((n) => n.clientId === dragId);
    const insertPos = reordered.findIndex((n) => n.clientId === dragId);
    let hasH1 = false;
    let hasH2 = false;
    for (let i = 0; i < insertPos; i++) {
      const lvl = reordered[i].headingLevel;
      if (lvl === "h1") { hasH1 = true; hasH2 = false; }
      else if (lvl === "h2") { hasH2 = true; }
    }
    const valid: HeadingLevel[] = ["h1"];
    if (hasH1) valid.push("h2");
    if (hasH2) valid.push("h3");

    const currentLevel = dragNode?.headingLevel;
    const levelIsValidHere = currentLevel != null && (valid as string[]).includes(currentLevel);

    if (!levelIsValidHere) {
      // The dragged node's own level is incompatible with this position.
      const posDesc = insertPos === 0 ? "at the top of the list" : "at this position";
      return `"${label}" (${currentLevel ?? "no level"}) can't be placed ${posDesc} — valid levels here: ${valid.join(", ")}. Change its heading level, or move it after a compatible parent node.`;
    }

    // The node's level is fine here; the conflict comes from another node in the list.
    const rawErr = validateHierarchy(reordered);
    return `"${label}" can be placed here as ${currentLevel}, but this move creates a hierarchy conflict elsewhere in the list: ${rawErr}. Check for h3 nodes that appear after a section boundary without an h2 in between.`;
  }

  function handleNodeDragStart(e: React.DragEvent, clientId: string) {
    dragNodeClientIdRef.current = clientId;
    e.dataTransfer.effectAllowed = "move";
    if (workingNodes) {
      const subtree = getNodeSubtree(workingNodes, clientId);
      setDragSubtreeIds(new Set(subtree.map((n) => n.clientId)));
    }
  }

  function handleNodeDragEnd() {
    dragNodeClientIdRef.current = null;
    setNodeDropTarget(null);
    setDragSubtreeIds(new Set());
  }

  function handleDropBefore(anchorClientId: string) {
    const dragId = dragNodeClientIdRef.current;
    if (!dragId || !workingNodes) return;
    const subtree = getNodeSubtree(workingNodes, dragId);
    const subtreeIds = new Set(subtree.map((n) => n.clientId));
    if (subtreeIds.has(anchorClientId)) return;
    const withoutSubtree = workingNodes.filter((n) => !subtreeIds.has(n.clientId));
    const intermediateErr = validateHierarchy(withoutSubtree);
    if (intermediateErr) {
      addToast(`Can't move "${subtree[0].label}" — the outline has an existing hierarchy conflict: ${intermediateErr}`);
      return;
    }
    const anchorIdx = withoutSubtree.findIndex((n) => n.clientId === anchorClientId);
    if (anchorIdx === -1) return;
    const reordered = [
      ...withoutSubtree.slice(0, anchorIdx),
      ...subtree,
      ...withoutSubtree.slice(anchorIdx),
    ];
    const err = validateHierarchy(reordered);
    if (err) {
      addToast(buildHierarchyMoveError(reordered, dragId, subtree[0].label));
      return;
    }
    setWorkingNodes(reordered);
    dragNodeClientIdRef.current = null;
    setDragSubtreeIds(new Set());
  }

  function handleDropOnNode(targetClientId: string) {
    const dragId = dragNodeClientIdRef.current;
    if (!dragId || !workingNodes) return;
    const subtree = getNodeSubtree(workingNodes, dragId);
    const subtreeIds = new Set(subtree.map((n) => n.clientId));
    if (subtreeIds.has(targetClientId)) return;
    const targetNode = workingNodes.find((n) => n.clientId === targetClientId);
    if (!targetNode) return;
    const targetLevelNum = levelToNum(targetNode.headingLevel);
    if (targetLevelNum >= 3) {
      addToast(`Cannot reparent onto "${targetNode.label}" (h3) — children would exceed h3.`);
      return;
    }
    const dragHeadLevelNum = levelToNum(subtree[0].headingLevel);
    const newHeadLevelNum = targetLevelNum + 1;
    const delta = newHeadLevelNum - dragHeadLevelNum;
    for (const n of subtree) {
      if (levelToNum(n.headingLevel) + delta > 3) {
        addToast(`Cannot reparent onto "${targetNode.label}" — some nodes in the group would exceed h3.`);
        return;
      }
    }
    const shiftedSubtree = subtree.map((n) => ({
      ...n,
      headingLevel: numToLevel(levelToNum(n.headingLevel) + delta),
    }));
    const withoutSubtree = workingNodes.filter((n) => !subtreeIds.has(n.clientId));
    const intermediateErr = validateHierarchy(withoutSubtree);
    if (intermediateErr) {
      addToast(`Can't move "${subtree[0].label}" — the outline has an existing hierarchy conflict: ${intermediateErr}`);
      return;
    }
    const targetSubtree = getNodeSubtree(withoutSubtree, targetClientId);
    const lastOfTarget = targetSubtree[targetSubtree.length - 1];
    const insertIdx = withoutSubtree.findIndex((n) => n.clientId === lastOfTarget.clientId) + 1;
    const reordered = [
      ...withoutSubtree.slice(0, insertIdx),
      ...shiftedSubtree,
      ...withoutSubtree.slice(insertIdx),
    ];
    const err = validateHierarchy(reordered);
    if (err) {
      addToast(err);
      return;
    }
    setWorkingNodes(reordered);
    dragNodeClientIdRef.current = null;
    setDragSubtreeIds(new Set());
  }

  function handleDropAtEnd() {
    const dragId = dragNodeClientIdRef.current;
    if (!dragId || !workingNodes) return;
    const subtree = getNodeSubtree(workingNodes, dragId);
    const subtreeIds = new Set(subtree.map((n) => n.clientId));
    const withoutSubtree = workingNodes.filter((n) => !subtreeIds.has(n.clientId));
    const intermediateErr = validateHierarchy(withoutSubtree);
    if (intermediateErr) {
      addToast(`Can't move "${subtree[0].label}" — the outline has an existing hierarchy conflict: ${intermediateErr}`);
      return;
    }
    const reordered = [...withoutSubtree, ...subtree];
    const err = validateHierarchy(reordered);
    if (err) {
      addToast(buildHierarchyMoveError(reordered, dragId, subtree[0].label));
      return;
    }
    setWorkingNodes(reordered);
    dragNodeClientIdRef.current = null;
    setDragSubtreeIds(new Set());
  }

  function handleCommitNodesClick() {
    if (workingChunks && workingChunks.length > 0) {
      setNodesCommitWarnOpen(true);
    } else {
      handleCommitNodes();
    }
  }

  async function handleCommitNodes() {
    if (!chatroomId || !workingNodes) return;
    const missing = workingNodes.filter((n) => !n.headingLevel);
    if (missing.length > 0) {
      addToast("All nodes must have a heading level before committing.");
      return;
    }
    const hierr = validateHierarchy(workingNodes);
    if (hierr) {
      addToast(hierr);
      return;
    }
    setOutlineStatus("committing");
    try {
      const result = await post<NodesApiResponse>(`/nodes/${chatroomId}/commit`, {
        nodes: workingNodes.map(draftToApi),
      });
      setCommittedNodes(result.committed_nodes);
      setWorkingNodes(result.committed_nodes ? result.committed_nodes.map(committedToDraft) : []);
      setOutlineStatus("success");
      // Clear working chunk assignments (node indices are now stale); committedChunks
      // intentionally not cleared so isChunksDirty becomes true and forces a recommit.
      setWorkingChunks((prev) => prev ? prev.map((c) => ({ ...c, assignedNodeIndex: null })) : prev);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Commit failed";
      addToast(msg);
      setOutlineStatus("error");
    }
  }

  function handleChunkQuadClick(canonicalIndex: number) {
    if (chunkNodeInfoMap.has(canonicalIndex)) return;
    setSelectedChunkCanonicalIndices((prev) => {
      const next = new Set(prev);
      next.has(canonicalIndex) ? next.delete(canonicalIndex) : next.add(canonicalIndex);
      return next;
    });
  }

  function handleChunkQuadDragEnter(canonicalIndex: number) {
    if (chunkNodeInfoMap.has(canonicalIndex)) return;
    setSelectedChunkCanonicalIndices((prev) => {
      const next = new Set(prev);
      next.add(canonicalIndex);
      return next;
    });
  }

  function handleChunkRectSelect(canonicalIndices: number[]) {
    const unassigned = canonicalIndices.filter((ci) => !chunkNodeInfoMap.has(ci));
    if (unassigned.length === 0) return;
    setSelectedChunkCanonicalIndices((prev) => {
      const next = new Set(prev);
      unassigned.forEach((ci) => next.add(ci));
      return next;
    });
  }

  function handleAddChunk(assignToNodeIndex: number | null) {
    if (!workingChunks || selectedChunkCanonicalIndices.size === 0) return;
    const sorted = Array.from(selectedChunkCanonicalIndices).sort((a, b) => a - b);
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    const overlap = workingChunks.some(
      (c) => c.startCanonicalIndex <= end && c.endCanonicalIndex >= start,
    );
    if (overlap) {
      addToast("Selection overlaps an existing chunk.");
      return;
    }
    const text = Array.from({ length: end - start + 1 }, (_, i) => start + i)
      .map((ci) => canonicalWords[ci]?.text ?? "")
      .filter(Boolean)
      .join(" ");
    const newChunk: DraftChunk = {
      clientId: crypto.randomUUID(),
      assignedNodeIndex: assignToNodeIndex,
      startCanonicalIndex: start,
      endCanonicalIndex: end,
      text,
    };
    const newChunks = [...workingChunks, newChunk].sort(
      (a, b) => a.startCanonicalIndex - b.startCanonicalIndex,
    );
    setWorkingChunks(newChunks);
    setSelectedChunkCanonicalIndices(new Set());
  }

  function handleDeleteChunk(clientId: string) {
    setWorkingChunks((prev) => (prev ? prev.filter((c) => c.clientId !== clientId) : prev));
    if (activeChunkClientId === clientId) setActiveChunkClientId(null);
  }

  function handleChunkDragStart(e: React.DragEvent, clientId: string) {
    dragChunkClientIdRef.current = clientId;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleChunkDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDropOnChunkRow(e: React.DragEvent, targetClientId: string) {
    e.preventDefault();
    e.stopPropagation();
    const clientId = dragChunkClientIdRef.current;
    if (!clientId || clientId === targetClientId || !workingChunks) return;
    const dragChunk = workingChunks.find((c) => c.clientId === clientId);
    const targetChunk = workingChunks.find((c) => c.clientId === targetClientId);
    if (!dragChunk || !targetChunk) return;
    const withoutDrag = workingChunks.filter((c) => c.clientId !== clientId);
    const targetIdx = withoutDrag.findIndex((c) => c.clientId === targetClientId);
    if (targetIdx === -1) return;
    const reordered = [
      ...withoutDrag.slice(0, targetIdx),
      { ...dragChunk, assignedNodeIndex: targetChunk.assignedNodeIndex },
      ...withoutDrag.slice(targetIdx),
    ];
    setWorkingChunks(reordered);
    dragChunkClientIdRef.current = null;
  }

  function handleDropOnNodeBucket(e: React.DragEvent, nodeIndex: number) {
    e.preventDefault();
    const clientId = dragChunkClientIdRef.current;
    if (!clientId || !workingChunks) return;
    const dragChunk = workingChunks.find((c) => c.clientId === clientId);
    if (!dragChunk) return;
    const withoutDrag = workingChunks.filter((c) => c.clientId !== clientId);
    const bucketChunks = withoutDrag.filter((c) => c.assignedNodeIndex === nodeIndex);
    const lastInBucket = bucketChunks[bucketChunks.length - 1];
    const insertIdx = lastInBucket
      ? withoutDrag.findIndex((c) => c.clientId === lastInBucket.clientId) + 1
      : withoutDrag.length;
    const reordered = [
      ...withoutDrag.slice(0, insertIdx),
      { ...dragChunk, assignedNodeIndex: nodeIndex },
      ...withoutDrag.slice(insertIdx),
    ];
    setWorkingChunks(reordered);
    dragChunkClientIdRef.current = null;
  }

  function handleDropOnUnassignedBucket(e: React.DragEvent) {
    e.preventDefault();
    const clientId = dragChunkClientIdRef.current;
    if (!clientId || !workingChunks) return;
    const dragChunk = workingChunks.find((c) => c.clientId === clientId);
    if (!dragChunk) return;
    const withoutDrag = workingChunks.filter((c) => c.clientId !== clientId);
    setWorkingChunks([...withoutDrag, { ...dragChunk, assignedNodeIndex: null }]);
    dragChunkClientIdRef.current = null;
  }

  async function handleCommitChunks() {
    if (!chatroomId || !workingChunks) return;
    setChunksStatus("committing");
    
    try {
      const result = await post<{ committed_chunks: ChunkItemApi[] | null }>(
        `/chunks/${chatroomId}/commit`,
        { chunks: workingChunks.map((c, i) => chunkDraftToApi(c, i)) },
      );
      setCommittedChunks(result.committed_chunks ?? []);
      setWorkingChunks(result.committed_chunks ? result.committed_chunks.map(chunkCommittedToDraft) : []);
      setChunksStatus("success");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Commit failed";
      addToast(msg);
      setChunksStatus("error");
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
                const isOutline = stage.key === "outline";
                const isChunks = stage.key === "chunks";
                const hasCommittedCanonical = committedCanonicalWordIds !== null;
                const clickable =
                  isPdf ||
                  (isRaw && (hasSourcePdf || hasCommittedRawWords)) ||
                  (isCanonical && hasCommittedRawWords) ||
                  (isOutline && hasCommittedCanonical) ||
                  (isChunks && committedNodes !== null);
                const isActive = stage.key === activeStage;
                const committedClass =
                  (isPdf && committedDoc) ||
                  (isRaw && hasCommittedRawWords && !hasGeneratedRawWords) ||
                  (isCanonical && hasCommittedCanonical && !isCanonicalDirty) ||
                  (isOutline && committedNodes !== null && !isOutlineDirty) ||
                  (isChunks && committedChunks !== null && !isChunksDirty)
                    ? "chip-committed"
                    : "";
                const generatedClass =
                  (isRaw && hasGeneratedRawWords) ||
                  (isCanonical && isCanonicalDirty && workingIncludedIds !== null) ||
                  (isOutline && isOutlineDirty) ||
                  (isChunks && isChunksDirty)
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
                    {isOutline && !hasCommittedCanonical && (
                      <span className="stage-helper-text">Complete Canonical Words first</span>
                    )}
                    {isOutline && hasCommittedCanonical && committedNodes === null && !isOutlineDirty && (
                      <span className="chip-status">Not started</span>
                    )}
                    {isOutline && hasCommittedCanonical && isOutlineDirty && (
                      <span className="chip-status">Unsaved changes</span>
                    )}
                    {isOutline && hasCommittedCanonical && committedNodes !== null && !isOutlineDirty && (
                      <span className="chip-status">Committed</span>
                    )}
                    {isOutline && committedNodes !== null && (
                      <span className="chip-meta">
                        {committedNodes.length} node{committedNodes.length !== 1 ? "s" : ""}
                        {outlineCommittedAt ? ` · ${formatDate(outlineCommittedAt)}` : ""}
                      </span>
                    )}
                    {isChunks && committedNodes === null && (
                      <span className="stage-helper-text">Complete Outline first</span>
                    )}
                    {isChunks && committedNodes !== null && committedChunks === null && !isChunksDirty && (
                      <span className="chip-status">Not started</span>
                    )}
                    {isChunks && committedNodes !== null && isChunksDirty && (
                      <span className="chip-status">Unsaved changes</span>
                    )}
                    {isChunks && committedNodes !== null && committedChunks !== null && !isChunksDirty && (
                      <span className="chip-status">Committed</span>
                    )}
                    {isChunks && committedChunks !== null && (
                      <span className="chip-meta">
                        {committedChunks.length} chunk{committedChunks.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Middle — Action Panel */}
          <div className={`action-panel${(activeStage === "outline" || activeStage === "chunks") ? " action-panel--wide" : ""}${activeStage === "chunks" && workingChunks !== null && committedNodes !== null ? " action-panel--split" : ""}`}>
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
                  onClick={handleCommitCanonicalClick}
                  disabled={!isCanonicalDirty || canonicalStatus === "committing"}
                >
                  {canonicalStatus === "committing" ? "Committing…" : "Commit Updates"}
                </button>
              </>
            )}

            {activeStage === "chunks" && workingChunks !== null && committedNodes !== null && (
              <div className="chunks-panel-inner">
                <div className="chunks-panel-header">
                  <h2 className="panel-heading">Chunk Assignment</h2>
                  <p className="action-status-banner">
                    {chunksStatus === "committing" && "Committing…"}
                    {chunksStatus === "success" && "Committed."}
                    {chunksStatus === "error" && "Something went wrong."}
                    {chunksStatus === "idle" && (
                      isChunksDirty
                        ? "Unsaved changes."
                        : committedChunks !== null
                          ? "Committed."
                          : "No chunks yet. Select quads to add a chunk."
                    )}
                  </p>
                  <div className="canonical-count-row">
                    <span><span className="canonical-count-label">Total </span>{workingChunks.length}</span>
                    <span><span className="canonical-count-label">Assigned </span>{workingChunks.filter((c) => c.assignedNodeIndex !== null).length}</span>
                    <span><span className="canonical-count-label">Unassigned </span>{workingChunks.filter((c) => c.assignedNodeIndex === null).length}</span>
                  </div>
                  {selectedChunkCanonicalIndices.size > 0 && (
                    <div className="outline-add-node-row">
                      <button
                        className="commit-btn commit-btn-secondary"
                        onClick={() => handleAddChunk(null)}
                      >
                        Add as unassigned chunk ({selectedChunkCanonicalIndices.size} word{selectedChunkCanonicalIndices.size !== 1 ? "s" : ""})
                      </button>
                      {activeNodeIndexForChunk !== null && (
                        <button
                          className="commit-btn commit-btn-secondary"
                          onClick={() => handleAddChunk(activeNodeIndexForChunk)}
                        >
                          Add to {committedNodes[activeNodeIndexForChunk]?.label ?? `node ${activeNodeIndexForChunk}`}
                        </button>
                      )}
                      <button
                        className="commit-btn commit-btn-secondary"
                        onClick={() => setSelectedChunkCanonicalIndices(new Set())}
                      >
                        Clear selection
                      </button>
                    </div>
                  )}
                </div>

                <div className="chunks-scrollable-area" ref={dividerContainerRef}>
                  <div className="chunks-top-scroll" style={{ flex: chunksPanelSplit }}>
                    {committedNodes.map((node, nodeIndex) => {
                      const nodeChunks = workingChunks.filter((c) => c.assignedNodeIndex === nodeIndex);
                      const isActiveBucket = activeNodeIndexForChunk === nodeIndex;
                      return (
                        <div
                          key={nodeIndex}
                          className={`chunk-node-bucket${isActiveBucket ? " chunk-node-bucket--active" : ""}`}
                          onDragOver={handleChunkDragOver}
                          onDrop={(e) => handleDropOnNodeBucket(e, nodeIndex)}
                        >
                          <div
                            className="chunk-bucket-header"
                            onClick={() => setActiveNodeIndexForChunk(isActiveBucket ? null : nodeIndex)}
                          >
                            <button className={`outline-level-btn outline-level-btn--${node.node_type}`}>{node.node_type}</button>
                            {node.start_canonical_index === 0 && node.end_canonical_index === 0 && (
                              <span className="outline-type-chip outline-type-chip--inferred">I</span>
                            )}
                            <span className="chunk-bucket-label" title={node.label}>{node.label}</span>
                            <span className="chunk-bucket-count">({nodeChunks.length})</span>
                          </div>
                          {nodeChunks.map((chunk) => (
                            <div
                              key={chunk.clientId}
                              className="chunk-row"
                              draggable
                              onDragStart={(e) => handleChunkDragStart(e, chunk.clientId)}
                              onDragOver={handleChunkDragOver}
                              onDrop={(e) => handleDropOnChunkRow(e, chunk.clientId)}
                              onClick={() => setActiveChunkClientId(activeChunkClientId === chunk.clientId ? null : chunk.clientId)}
                            >
                              <span className="outline-drag-handle">⠿</span>
                              <span className="chunk-preview" title={chunk.text}>{chunk.text}</span>
                              <span className="chunk-range">{chunk.startCanonicalIndex}–{chunk.endCanonicalIndex}</span>
                              <button
                                className="outline-delete-btn"
                                onClick={(e) => { e.stopPropagation(); handleDeleteChunk(chunk.clientId); }}
                                title="Delete chunk"
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="chunks-panel-divider"
                    onMouseDown={(e) => { e.preventDefault(); isDividerDraggingRef.current = true; }}
                  >
                    <span className="chunks-panel-divider-handle">⠿</span>
                  </div>

                  <div className="chunks-bottom-scroll" style={{ flex: 100 - chunksPanelSplit }}>
                    <div
                      className="chunk-unassigned-bucket"
                      onDragOver={handleChunkDragOver}
                      onDrop={handleDropOnUnassignedBucket}
                    >
                      <div className="chunk-bucket-header">
                        <span className="chunk-bucket-label">Unassigned</span>
                        <span className="chunk-bucket-count">({workingChunks.filter((c) => c.assignedNodeIndex === null).length})</span>
                      </div>
                      {workingChunks.filter((c) => c.assignedNodeIndex === null).map((chunk) => (
                        <div
                          key={chunk.clientId}
                          className="chunk-row"
                          draggable
                          onDragStart={(e) => handleChunkDragStart(e, chunk.clientId)}
                          onDragOver={handleChunkDragOver}
                          onDrop={(e) => handleDropOnChunkRow(e, chunk.clientId)}
                          onClick={() => setActiveChunkClientId(activeChunkClientId === chunk.clientId ? null : chunk.clientId)}
                        >
                          <span className="outline-drag-handle">⠿</span>
                          <span className="chunk-preview" title={chunk.text}>{chunk.text}</span>
                          <span className="chunk-range">{chunk.startCanonicalIndex}–{chunk.endCanonicalIndex}</span>
                          <button
                            className="outline-delete-btn"
                            onClick={(e) => { e.stopPropagation(); handleDeleteChunk(chunk.clientId); }}
                            title="Delete chunk"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="chunks-panel-footer">
                  <button
                    className="commit-btn"
                    onClick={handleCommitChunks}
                    disabled={!isChunksDirty || chunksStatus === "committing"}
                  >
                    {chunksStatus === "committing" ? "Committing…" : "Commit Chunks"}
                  </button>
                </div>
              </div>
            )}

            {activeStage === "outline" && workingNodes !== null && (
              <>
                <h2 className="panel-heading">Outline Generation</h2>
                <p className="action-status-banner">
                  {outlineStatus === "committing" && "Committing…"}
                  {outlineStatus === "success" && `Committed.${outlineCommittedAt ? " " + formatDate(outlineCommittedAt) : ""}`}
                  {outlineStatus === "error" && "Something went wrong."}
                  {outlineStatus === "idle" && (
                    isOutlineDirty
                      ? "Unsaved changes."
                      : committedNodes !== null
                        ? `Committed.${outlineCommittedAt ? " " + formatDate(outlineCommittedAt) : ""}`
                        : "No nodes yet. Select quads to add an explicit node, or add an inferred node."
                  )}
                </p>
                {workingNodes.length > 0 && (
                  <p className="raw-words-summary">
                    {workingNodes.length} node{workingNodes.length !== 1 ? "s" : ""}
                  </p>
                )}
                {selectedCanonicalIndices.size > 0 && (
                  <div className="outline-add-node-row">
                    <button
                      className="commit-btn commit-btn-secondary"
                      onClick={handleAddExplicitNode}
                    >
                      Add as node ({selectedCanonicalIndices.size} word{selectedCanonicalIndices.size !== 1 ? "s" : ""})
                    </button>
                    <button
                      className="commit-btn commit-btn-secondary"
                      onClick={() => setSelectedCanonicalIndices(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
                <button
                  className="commit-btn commit-btn-secondary"
                  onClick={() => setInferredNodeForm({ label: "", level: "" })}
                  disabled={inferredNodeForm !== null}
                >
                  + Add inferred node
                </button>
                {inferredNodeForm !== null && (
                  <div className="outline-inferred-form">
                    <input
                      className="outline-inferred-input"
                      type="text"
                      placeholder="Node label"
                      value={inferredNodeForm.label}
                      onChange={(e) => setInferredNodeForm((f) => f ? { ...f, label: e.target.value } : f)}
                      autoFocus
                    />
                    <select
                      className="outline-level-select"
                      value={inferredNodeForm.level}
                      onChange={(e) => setInferredNodeForm((f) => f ? { ...f, level: e.target.value as HeadingLevel | "" } : f)}
                    >
                      <option value="">— Level —</option>
                      <option value="h1">h1</option>
                      <option value="h2">h2</option>
                      <option value="h3">h3</option>
                    </select>
                    <div className="outline-inferred-actions">
                      <button
                        className="commit-btn"
                        onClick={handleAddInferredNode}
                        disabled={!inferredNodeForm.label.trim() || !inferredNodeForm.level}
                      >
                        Add
                      </button>
                      <button
                        className="commit-btn commit-btn-secondary"
                        onClick={() => setInferredNodeForm(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {workingNodes.length > 0 && (
                  <div
                    className="outline-node-list"
                    role="list"
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setNodeDropTarget(null);
                    }}
                  >
                    {workingNodes.map((node) => {
                      const indent = node.headingLevel === "h1" ? 0 : node.headingLevel === "h2" ? 1 : 2;
                      const isActive = node.clientId === activeNodeClientId;
                      const isBeforeTarget = nodeDropTarget?.type === "before" && nodeDropTarget.anchorId === node.clientId;
                      const isOnTarget = nodeDropTarget?.type === "on" && nodeDropTarget.targetId === node.clientId && !dragSubtreeIds.has(node.clientId);
                      const isDraggingSubtree = dragSubtreeIds.has(node.clientId);
                      return (
                        <React.Fragment key={node.clientId}>
                          <div
                            className={`outline-drop-zone${isBeforeTarget ? " outline-drop-zone--active" : ""}`}
                            onDragOver={(e) => { e.preventDefault(); setNodeDropTarget({ type: "before", anchorId: node.clientId }); }}
                            onDrop={(e) => { e.preventDefault(); handleDropBefore(node.clientId); setNodeDropTarget(null); }}
                          />
                          <div
                            role="listitem"
                            className={`outline-node-row${isActive ? " outline-node-row--active" : ""}${isOnTarget ? " outline-node-row--on-target" : ""}${isDraggingSubtree ? " outline-node-row--dragging" : ""}`}
                            style={{ paddingLeft: `${indent * 0.875 + 0.5}rem` }}
                            draggable
                            onDragStart={(e) => handleNodeDragStart(e, node.clientId)}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragSubtreeIds.has(node.clientId)) setNodeDropTarget({ type: "on", targetId: node.clientId }); }}
                            onDragEnd={handleNodeDragEnd}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnNode(node.clientId); setNodeDropTarget(null); }}
                            onClick={() => setActiveNodeClientId(isActive ? null : node.clientId)}
                          >
                            <span className="outline-drag-handle" title="Drag to reorder">⠿</span>
                            <button
                              className={`outline-level-btn outline-level-btn--${node.headingLevel ?? "none"}`}
                              title="Click to cycle heading level"
                              onClick={(e) => { e.stopPropagation(); handleCycleHeadingLevel(node.clientId); }}
                            >
                              {node.headingLevel ?? "—"}
                            </button>
                            {node.isInferred && (
                              <span className="outline-type-chip outline-type-chip--inferred">I</span>
                            )}
                            <span className="outline-node-label" title={node.label}>{node.label}</span>
                            <button
                              className="outline-delete-btn"
                              onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.clientId); }}
                              title="Delete node"
                            >
                              ✕
                            </button>
                          </div>
                        </React.Fragment>
                      );
                    })}
                    <div
                      className={`outline-drop-zone outline-drop-zone--end${nodeDropTarget?.type === "end" ? " outline-drop-zone--active" : ""}`}
                      onDragOver={(e) => { e.preventDefault(); setNodeDropTarget({ type: "end" }); }}
                      onDrop={(e) => { e.preventDefault(); handleDropAtEnd(); setNodeDropTarget(null); }}
                    />
                  </div>
                )}
                <button
                  className="commit-btn"
                  onClick={handleCommitNodesClick}
                  disabled={outlineStatus === "committing" || workingNodes.length === 0}
                >
                  {outlineStatus === "committing" ? "Committing…" : "Commit Outline"}
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

            {activeStage === "outline" && (
              <div
                className="raw-words-viewer"
                onMouseMove={(e) => setOutlineMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => { setOutlineMousePos(null); setHoveredOutlineIndex(null); }}
              >
                <div className="outline-zoom-controls">
                  <button
                    className="outline-zoom-btn"
                    onClick={() => setOutlineZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                    title="Zoom in"
                  >+</button>
                  <span className="outline-zoom-label">{Math.round(outlineZoom * 100)}%</span>
                  <button
                    className="outline-zoom-btn"
                    onClick={() => setOutlineZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                    title="Zoom out"
                  >−</button>
                </div>
                {workingNodes !== null && committedRawWords && committedCanonicalWordIds !== null ? (
                  <OutlineNodesOverlay
                    rawWordsPayload={committedRawWords}
                    canonicalWords={canonicalWords}
                    draftNodes={workingNodes}
                    selectedCanonicalIndices={selectedCanonicalIndices}
                    activeNodeClientId={activeNodeClientId}
                    getPageImageUrl={
                      committedDoc
                        ? (pageNum) => `${API_BASE}/config/${chatroomSlug}/page-image/${pageNum}`
                        : null
                    }
                    zoomLevel={outlineZoom}
                    onQuadClick={handleOutlineQuadClick}
                    onQuadDragEnter={handleOutlineQuadDragEnter}
                    onRectSelect={handleOutlineRectSelect}
                    onHover={setHoveredOutlineIndex}
                  />
                ) : (
                  <div className="pdf-empty-state">
                    <p>Complete Canonical Words first.</p>
                  </div>
                )}
              </div>
            )}

            {activeStage === "chunks" && (
              <div
                className="raw-words-viewer"
                onMouseMove={(e) => setChunkMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => { setChunkMousePos(null); setHoveredChunkCanonicalIndex(null); }}
              >
                <div className="outline-zoom-controls">
                  <button
                    className="outline-zoom-btn"
                    onClick={() => setChunkZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                    title="Zoom in"
                  >+</button>
                  <span className="outline-zoom-label">{Math.round(chunkZoom * 100)}%</span>
                  <button
                    className="outline-zoom-btn"
                    onClick={() => setChunkZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                    title="Zoom out"
                  >−</button>
                </div>
                {workingChunks !== null && committedRawWords && committedCanonicalWordIds !== null && committedNodes !== null ? (
                  <ChunksOverlay
                    rawWordsPayload={committedRawWords}
                    canonicalWords={canonicalWords}
                    draftChunks={workingChunks}
                    committedNodes={committedNodes}
                    selectedCanonicalIndices={selectedChunkCanonicalIndices}
                    activeChunkClientId={activeChunkClientId}
                    getPageImageUrl={
                      committedDoc
                        ? (pageNum) => `${API_BASE}/config/${chatroomSlug}/page-image/${pageNum}`
                        : null
                    }
                    zoomLevel={chunkZoom}
                    onQuadClick={handleChunkQuadClick}
                    onQuadDragEnter={handleChunkQuadDragEnter}
                    onRectSelect={handleChunkRectSelect}
                    onHover={setHoveredChunkCanonicalIndex}
                  />
                ) : (
                  <div className="pdf-empty-state">
                    <p>Complete Outline first.</p>
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

      {/* Outline hover tooltip */}
      {activeStage === "outline" && hoveredOutlineIndex !== null && outlineMousePos && canonicalWords.length > 0 && (
        <div
          className="canonical-tooltip"
          style={{ left: outlineMousePos.x + 14, top: outlineMousePos.y + 14 }}
          role="status"
        >
          {(() => {
            const word = canonicalWords[hoveredOutlineIndex];
            const nodeInfo = outlineNodeInfoMap.get(hoveredOutlineIndex);
            return (
              <>
                <div className="canonical-tooltip-text">{word?.text ?? "—"}</div>
                <div className="canonical-tooltip-row">
                  <span className="canonical-tooltip-label">Canonical #</span>
                  <span>{hoveredOutlineIndex}</span>
                </div>
                {nodeInfo ? (
                  <>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Node #</span>
                      <span>{nodeInfo.nodeIndex}</span>
                    </div>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Type</span>
                      <span>{nodeInfo.headingLevel ?? "—"} · explicit</span>
                    </div>
                  </>
                ) : (
                  <div className="canonical-tooltip-row">
                    <span className="canonical-tooltip-label">Node</span>
                    <span>unassigned</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Chunks hover tooltip */}
      {activeStage === "chunks" && hoveredChunkCanonicalIndex !== null && chunkMousePos && canonicalWords.length > 0 && (
        <div
          className="canonical-tooltip"
          style={{ left: chunkMousePos.x + 14, top: chunkMousePos.y + 14 }}
          role="status"
        >
          {(() => {
            const word = canonicalWords[hoveredChunkCanonicalIndex];
            const chunkInfo = chunkNodeInfoMap.get(hoveredChunkCanonicalIndex);
            const nodeRangeInfo = chunkNodeRangeInfoMap.get(hoveredChunkCanonicalIndex);
            const nodeIdx = chunkInfo?.chunk.assignedNodeIndex ?? null;
            const assignedNode = nodeIdx !== null && committedNodes ? committedNodes[nodeIdx] ?? null : null;
            const displayChunkIndex = chunkInfo ? chunkClientIdToDisplayIndex.get(chunkInfo.chunk.clientId) : undefined;
            return (
              <>
                <div className="canonical-tooltip-text">{word?.text ?? "—"}</div>
                <div className="canonical-tooltip-row">
                  <span className="canonical-tooltip-label">Canonical #</span>
                  <span>{hoveredChunkCanonicalIndex}</span>
                </div>
                {chunkInfo ? (
                  <>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Chunk #</span>
                      <span>{displayChunkIndex !== undefined ? displayChunkIndex : "—"}</span>
                    </div>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Canonical range</span>
                      <span>{chunkInfo.chunk.startCanonicalIndex}–{chunkInfo.chunk.endCanonicalIndex}</span>
                    </div>
                    {assignedNode ? (
                      <div className="canonical-tooltip-row">
                        <span className="canonical-tooltip-label">Node</span>
                        <span>{assignedNode.label} ({assignedNode.node_type})</span>
                      </div>
                    ) : (
                      <div className="canonical-tooltip-row">
                        <span className="canonical-tooltip-label">Node</span>
                        <span>unassigned</span>
                      </div>
                    )}
                  </>
                ) : nodeRangeInfo ? (
                  <>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Node #</span>
                      <span>{nodeRangeInfo.nodeIndex}</span>
                    </div>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Header</span>
                      <span>{nodeRangeInfo.nodeType}</span>
                    </div>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Node</span>
                      <span>{nodeRangeInfo.label}</span>
                    </div>
                    <div className="canonical-tooltip-row">
                      <span className="canonical-tooltip-label">Chunk</span>
                      <span>not yet chunked</span>
                    </div>
                  </>
                ) : (
                  <div className="canonical-tooltip-row">
                    <span className="canonical-tooltip-label">Chunk</span>
                    <span>unassigned</span>
                  </div>
                )}
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
                  Raw words detection{committedCanonicalWordIds !== null ? ", canonical words selection" : ""}
                  {committedNodes !== null ? ", and outline nodes" : ""} will be cleared and must be redone.
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

      {/* Canonical commit warning modal (outline will be cleared) */}
      {canonicalCommitWarnOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Commit canonical words?</h2>
            </div>
            <div className="modal-body">
              <p className="modal-warning">
                This will replace the committed canonical words and clear all outline nodes. You will need to redo the outline generation.
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={() => setCanonicalCommitWarnOpen(false)}>
                Cancel
              </button>
              <button
                className="modal-confirm-btn"
                onClick={() => {
                  setCanonicalCommitWarnOpen(false);
                  handleCommitCanonical();
                }}
              >
                Continue
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
                This will clear all committed canonical words{committedNodes !== null ? " and outline nodes" : ""}. You will need to redo the downstream stages.
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

      {/* Nodes commit warning modal (chunk assignments will be cleared) */}
      {nodesCommitWarnOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Commit outline?</h2>
            </div>
            <div className="modal-body">
              <p className="modal-warning">
                This will re-commit the outline and clear all chunk node assignments. Chunks will be preserved but become unassigned.
              </p>
            </div>
            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={() => setNodesCommitWarnOpen(false)}>
                Cancel
              </button>
              <button
                className="modal-confirm-btn"
                onClick={() => {
                  setNodesCommitWarnOpen(false);
                  handleCommitNodes();
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="toast-container" role="alert" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              <span className="toast-message">{toast.message}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">✕</button>
            </div>
          ))}
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
