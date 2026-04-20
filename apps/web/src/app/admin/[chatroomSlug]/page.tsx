"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get, post, postForm, patch, ApiError } from "@/lib/api";
import Navbar from "@/components/Navbar";
import RawWordsOverlay from "@/components/config/RawWordsOverlay";
import RawWordsHoverCard from "@/components/config/RawWordsHoverCard";
import CanonicalWordsOverlay from "@/components/config/CanonicalWordsOverlay";
import OutlineNodesOverlay from "@/components/config/OutlineNodesOverlay";
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
} from "@/components/config/outlineTypes";

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
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineCommittedAt, setOutlineCommittedAt] = useState<string | null>(null);
  const [selectedCanonicalIndices, setSelectedCanonicalIndices] = useState<Set<number>>(new Set());
  const [activeNodeClientId, setActiveNodeClientId] = useState<string | null>(null);
  const [inferredNodeForm, setInferredNodeForm] = useState<{ label: string; level: HeadingLevel | "" } | null>(null);
  const [addNodeError, setAddNodeError] = useState<string | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [canonicalCommitWarnOpen, setCanonicalCommitWarnOpen] = useState(false);
  const [outlineZoom, setOutlineZoom] = useState(1.0);
  const [hoveredOutlineIndex, setHoveredOutlineIndex] = useState<number | null>(null);
  const [outlineMousePos, setOutlineMousePos] = useState<{ x: number; y: number } | null>(null);
  const dragNodeClientIdRef = useRef<string | null>(null);

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

  const anyDirty = isDirty || isRawWordsDirty || isCanonicalDirty || isOutlineDirty;

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
      setCommittedNodes(null);
      setWorkingNodes(null);
      setOutlineStatus("idle");
      setOutlineError(null);
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
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
      setOutlineError(null);
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
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
      // Canonical words replaced: outline nodes are now invalid
      setCommittedNodes(null);
      setWorkingNodes(null);
      setOutlineStatus("idle");
      setOutlineError(null);
      setOutlineCommittedAt(null);
      setSelectedCanonicalIndices(new Set());
      setActiveNodeClientId(null);
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
    setAddNodeError(null);
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
    setAddNodeError(null);
  }

  function handleAddExplicitNode() {
    if (!workingNodes || selectedCanonicalIndices.size === 0) return;
    const sorted = Array.from(selectedCanonicalIndices).sort((a, b) => a - b);
    // Check sequential adjacency
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        setAddNodeError("Selected quads must be sequentially adjacent in reading order.");
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
      setAddNodeError("Selection overlaps an existing explicit node.");
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
    setAddNodeError(null);
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
      setHierarchyError(err);
      return;
    }
    setWorkingNodes(newNodes);
    setInferredNodeForm(null);
    setHierarchyError(null);
  }

  function handleDeleteNode(clientId: string) {
    setWorkingNodes((prev) => (prev ? prev.filter((n) => n.clientId !== clientId) : prev));
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
        setHierarchyError(null);
        setWorkingNodes(updated);
        return;
      }
    }
    // No valid level found — stay as-is
  }

  function handleNodeDragStart(e: React.DragEvent, clientId: string) {
    dragNodeClientIdRef.current = clientId;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleNodeDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleNodeDrop(e: React.DragEvent, targetClientId: string) {
    e.preventDefault();
    const dragId = dragNodeClientIdRef.current;
    if (!dragId || dragId === targetClientId || !workingNodes) return;
    const dragNode = workingNodes.find((n) => n.clientId === dragId);
    if (!dragNode) return;

    const withoutDrag = workingNodes.filter((n) => n.clientId !== dragId);
    const targetIndex = withoutDrag.findIndex((n) => n.clientId === targetClientId);
    if (targetIndex === -1) return;
    const reordered = [
      ...withoutDrag.slice(0, targetIndex + 1),
      dragNode,
      ...withoutDrag.slice(targetIndex + 1),
    ];
    // Verify explicit node canonical ordering is preserved
    const explicitInOrder = reordered.filter((n) => !n.isInferred);
    const explicitSorted = [...explicitInOrder].sort(
      (a, b) => a.startCanonicalIndex - b.startCanonicalIndex,
    );
    const orderOk = explicitInOrder.every((n, i) => n.clientId === explicitSorted[i].clientId);
    if (!orderOk) {
      setHierarchyError("Explicit nodes must remain in canonical index order.");
      return;
    }
    const err = validateHierarchy(reordered);
    if (err) {
      setHierarchyError(err);
      return;
    }
    setHierarchyError(null);
    setWorkingNodes(reordered);
    dragNodeClientIdRef.current = null;
  }

  async function handleCommitNodes() {
    if (!chatroomId || !workingNodes) return;
    const missing = workingNodes.filter((n) => !n.headingLevel);
    if (missing.length > 0) {
      setOutlineError("All nodes must have a heading level before committing.");
      return;
    }
    const hierr = validateHierarchy(workingNodes);
    if (hierr) {
      setOutlineError(hierr);
      return;
    }
    setOutlineStatus("committing");
    setOutlineError(null);
    try {
      const result = await post<NodesApiResponse>(`/nodes/${chatroomId}/commit`, {
        nodes: workingNodes.map(draftToApi),
      });
      setCommittedNodes(result.committed_nodes);
      setWorkingNodes(result.committed_nodes ? result.committed_nodes.map(committedToDraft) : []);
      setOutlineStatus("success");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Commit failed";
      setOutlineError(msg);
      setOutlineStatus("error");
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
                const hasCommittedCanonical = committedCanonicalWordIds !== null;
                const clickable =
                  isPdf ||
                  (isRaw && (hasSourcePdf || hasCommittedRawWords)) ||
                  (isCanonical && hasCommittedRawWords) ||
                  (isOutline && hasCommittedCanonical);
                const isActive = stage.key === activeStage;
                const committedClass =
                  (isPdf && committedDoc) ||
                  (isRaw && hasCommittedRawWords && !hasGeneratedRawWords) ||
                  (isCanonical && hasCommittedCanonical && !isCanonicalDirty) ||
                  (isOutline && committedNodes !== null && !isOutlineDirty)
                    ? "chip-committed"
                    : "";
                const generatedClass =
                  (isRaw && hasGeneratedRawWords) ||
                  (isCanonical && isCanonicalDirty && workingIncludedIds !== null) ||
                  (isOutline && isOutlineDirty)
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
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Middle — Action Panel */}
          <div className={`action-panel${activeStage === "outline" ? " action-panel--wide" : ""}`}>
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
                      onClick={() => { setSelectedCanonicalIndices(new Set()); setAddNodeError(null); }}
                    >
                      Clear selection
                    </button>
                    {addNodeError && (
                      <p className="commit-error" role="alert">{addNodeError}</p>
                    )}
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
                        onClick={() => { setInferredNodeForm(null); setHierarchyError(null); }}
                      >
                        Cancel
                      </button>
                    </div>
                    {hierarchyError && (
                      <p className="commit-error" role="alert">{hierarchyError}</p>
                    )}
                  </div>
                )}
                {workingNodes.length > 0 && (
                  <ul className="outline-node-list">
                    {workingNodes.map((node) => {
                      const indent = node.headingLevel === "h1" ? 0 : node.headingLevel === "h2" ? 1 : 2;
                      const isActive = node.clientId === activeNodeClientId;
                      return (
                        <li
                          key={node.clientId}
                          className={`outline-node-row ${isActive ? "outline-node-row--active" : ""}`}
                          style={{ paddingLeft: `${indent * 0.875 + 0.5}rem` }}
                          draggable
                          onDragStart={(e) => handleNodeDragStart(e, node.clientId)}
                          onDragOver={(e) => handleNodeDragOver(e)}
                          onDrop={(e) => handleNodeDrop(e, node.clientId)}
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
                        </li>
                      );
                    })}
                  </ul>
                )}
                {hierarchyError && !inferredNodeForm && (
                  <p className="commit-error" role="alert">{hierarchyError}</p>
                )}
                {outlineError && (
                  <p className="commit-error" role="alert">{outlineError}</p>
                )}
                <button
                  className="commit-btn"
                  onClick={handleCommitNodes}
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
