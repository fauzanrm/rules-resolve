"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { RawWord, RawWordsPayload } from "./rawWordsTypes";
import { DraftNode, HeadingLevel } from "./outlineTypes";

const BASE_DISPLAY_WIDTH = 560;
const RENDER_SCALE = 2;

const LEVEL_COLORS: Record<HeadingLevel, { bg: string; border: string; activeBg: string; activeBorder: string }> = {
  h1: {
    bg: "rgba(99, 102, 241, 0.35)",
    border: "rgba(99, 102, 241, 0.7)",
    activeBg: "rgba(99, 102, 241, 0.55)",
    activeBorder: "rgba(99, 102, 241, 1)",
  },
  h2: {
    bg: "rgba(16, 185, 129, 0.3)",
    border: "rgba(16, 185, 129, 0.65)",
    activeBg: "rgba(16, 185, 129, 0.5)",
    activeBorder: "rgba(16, 185, 129, 1)",
  },
  h3: {
    bg: "rgba(245, 158, 11, 0.3)",
    border: "rgba(245, 158, 11, 0.65)",
    activeBg: "rgba(245, 158, 11, 0.5)",
    activeBorder: "rgba(245, 158, 11, 1)",
  },
};

interface RectBox { x: number; y: number; w: number; h: number }

interface Props {
  rawWordsPayload: RawWordsPayload;
  canonicalWords: RawWord[];
  draftNodes: DraftNode[];
  selectedCanonicalIndices: Set<number>;
  activeNodeClientId: string | null;
  getPageImageUrl: ((pageNum: number) => string) | null;
  zoomLevel: number;
  onQuadClick: (canonicalIndex: number) => void;
  onQuadDragEnter: (canonicalIndex: number) => void;
  onRectSelect: (canonicalIndices: number[]) => void;
  onHover: (canonicalIndex: number | null) => void;
}

export default function OutlineNodesOverlay({
  rawWordsPayload,
  canonicalWords,
  draftNodes,
  selectedCanonicalIndices,
  activeNodeClientId,
  getPageImageUrl,
  zoomLevel,
  onQuadClick,
  onQuadDragEnter,
  onRectSelect,
  onHover,
}: Props) {
  const [actualDims, setActualDims] = useState<Map<number, { width: number; height: number }>>(new Map());
  const [rectBox, setRectBox] = useState<RectBox | null>(null);

  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartIndexRef = useRef<number | null>(null);
  const rectAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const onQuadClickRef = useRef(onQuadClick);
  const onQuadDragEnterRef = useRef(onQuadDragEnter);
  const onRectSelectRef = useRef(onRectSelect);
  useEffect(() => { onQuadClickRef.current = onQuadClick; }, [onQuadClick]);
  useEffect(() => { onQuadDragEnterRef.current = onQuadDragEnter; }, [onQuadDragEnter]);
  useEffect(() => { onRectSelectRef.current = onRectSelect; }, [onRectSelect]);

  useEffect(() => {
    function handleGlobalMouseUp(e: MouseEvent) {
      // Rect selection completion
      if (rectAnchorRef.current) {
        const anchor = rectAnchorRef.current;
        const x1 = Math.min(anchor.x, e.clientX);
        const y1 = Math.min(anchor.y, e.clientY);
        const x2 = Math.max(anchor.x, e.clientX);
        const y2 = Math.max(anchor.y, e.clientY);
        if (x2 - x1 > 4 || y2 - y1 > 4) {
          const overlapping: number[] = [];
          document.querySelectorAll<HTMLElement>("[data-outline-ci]").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
              const idx = el.getAttribute("data-outline-ci");
              if (idx !== null) overlapping.push(Number(idx));
            }
          });
          if (overlapping.length > 0) onRectSelectRef.current(overlapping);
        }
        rectAnchorRef.current = null;
        setRectBox(null);
      }

      // Quad click/drag completion
      if (!hasDraggedRef.current && dragStartIndexRef.current !== null) {
        onQuadClickRef.current(dragStartIndexRef.current);
      }
      isDraggingRef.current = false;
      hasDraggedRef.current = false;
      dragStartIndexRef.current = null;
    }
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // Map: canonical_index → {node, nodeIndex} (explicit nodes only)
  const canonicalIndexToNode = useMemo(() => {
    const map = new Map<number, { node: DraftNode; nodeIndex: number }>();
    draftNodes.forEach((node, nodeIndex) => {
      if (!node.isInferred) {
        for (let i = node.startCanonicalIndex; i <= node.endCanonicalIndex; i++) {
          map.set(i, { node, nodeIndex });
        }
      }
    });
    return map;
  }, [draftNodes]);

  const activeNode = useMemo(
    () => (activeNodeClientId ? draftNodes.find((n) => n.clientId === activeNodeClientId) ?? null : null),
    [activeNodeClientId, draftNodes]
  );

  const canonicalWordsByPage = useMemo(() => {
    const map = new Map<number, Array<{ word: RawWord; canonicalIndex: number }>>();
    canonicalWords.forEach((word, idx) => {
      const bucket = map.get(word.page) ?? [];
      bucket.push({ word, canonicalIndex: idx });
      map.set(word.page, bucket);
    });
    return map;
  }, [canonicalWords]);

  const handleImageLoad = useCallback(
    (pageNum: number, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setActualDims((prev) => {
        const next = new Map(prev);
        next.set(pageNum, { width: img.naturalWidth / RENDER_SCALE, height: img.naturalHeight / RENDER_SCALE });
        return next;
      });
    },
    []
  );

  function handleContainerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    rectAnchorRef.current = { x: e.clientX, y: e.clientY };
    setRectBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  function handleContainerMouseMove(e: React.MouseEvent) {
    if (!rectAnchorRef.current) return;
    const anchor = rectAnchorRef.current;
    setRectBox({
      x: Math.min(anchor.x, e.clientX),
      y: Math.min(anchor.y, e.clientY),
      w: Math.abs(e.clientX - anchor.x),
      h: Math.abs(e.clientY - anchor.y),
    });
  }

  function handleQuadMouseDown(e: React.MouseEvent, canonicalIndex: number, isAssigned: boolean) {
    e.preventDefault();
    e.stopPropagation();
    if (isAssigned) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartIndexRef.current = canonicalIndex;
  }

  function handleQuadMouseEnter(canonicalIndex: number, isAssigned: boolean) {
    onHover(canonicalIndex);
    if (isAssigned || !isDraggingRef.current) return;
    if (!hasDraggedRef.current) {
      hasDraggedRef.current = true;
      if (dragStartIndexRef.current !== null && dragStartIndexRef.current !== canonicalIndex) {
        onQuadDragEnterRef.current(dragStartIndexRef.current);
      }
    }
    onQuadDragEnterRef.current(canonicalIndex);
  }

  const DISPLAY_WIDTH = BASE_DISPLAY_WIDTH * zoomLevel;

  return (
    <div
      className="canonical-words-overlay"
      data-testid="outline-nodes-overlay"
      style={{ userSelect: "none" }}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleContainerMouseMove}
    >
      {rawWordsPayload.pages.map((page) => {
        const dims = actualDims.get(page.page);
        const pageWidth = dims?.width ?? page.width;
        const pageHeight = dims?.height ?? page.height;
        const scale = DISPLAY_WIDTH / pageWidth;
        const height = pageHeight * scale;
        const imageUrl = getPageImageUrl ? getPageImageUrl(page.page) : null;
        const bucket = canonicalWordsByPage.get(page.page) ?? [];

        return (
          <div key={page.page} className="raw-word-page-wrapper">
            <span className="raw-word-page-label">Page {page.page}</span>
            <div
              className="raw-word-page"
              style={{ width: DISPLAY_WIDTH, height }}
              data-page={page.page}
            >
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={`Page ${page.page}`}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
                  draggable={false}
                  onLoad={(e) => handleImageLoad(page.page, e)}
                />
              )}
              {bucket.map(({ word, canonicalIndex }) => {
                const [x0, y0, x1, y1] = word.quad;
                const nodeInfo = canonicalIndexToNode.get(canonicalIndex);
                const ownerNode = nodeInfo?.node;
                const isAssigned = nodeInfo !== undefined;
                const isSelected = selectedCanonicalIndices.has(canonicalIndex);
                const isActiveNode =
                  activeNode !== null &&
                  !activeNode.isInferred &&
                  canonicalIndex >= activeNode.startCanonicalIndex &&
                  canonicalIndex <= activeNode.endCanonicalIndex;

                let bg = "rgba(156, 163, 175, 0.12)";
                let border = "rgba(156, 163, 175, 0.3)";
                let outline = "none";
                let cursor = "crosshair";

                if (isSelected) {
                  bg = "rgba(29, 78, 216, 0.35)";
                  border = "rgba(29, 78, 216, 0.8)";
                } else if (ownerNode?.headingLevel) {
                  const colors = LEVEL_COLORS[ownerNode.headingLevel];
                  if (isActiveNode) {
                    bg = colors.activeBg;
                    border = colors.activeBorder;
                    outline = `2px solid ${colors.activeBorder}`;
                  } else {
                    bg = colors.bg;
                    border = colors.border;
                  }
                  cursor = "default";
                }

                return (
                  <div
                    key={canonicalIndex}
                    {...(!isAssigned ? { "data-outline-ci": canonicalIndex } : {})}
                    style={{
                      position: "absolute",
                      left: x0 * scale,
                      top: y0 * scale,
                      width: Math.max(1, (x1 - x0) * scale),
                      height: Math.max(1, (y1 - y0) * scale),
                      background: bg,
                      border: `1px solid ${border}`,
                      outline,
                      cursor,
                      transition: "background 0.05s",
                    }}
                    onMouseDown={(e) => handleQuadMouseDown(e, canonicalIndex, isAssigned)}
                    onMouseEnter={() => handleQuadMouseEnter(canonicalIndex, isAssigned)}
                    onMouseLeave={() => onHover(null)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {rectBox && rectBox.w > 2 && rectBox.h > 2 && (
        <div
          className="canonical-rect-select"
          style={{
            position: "fixed",
            left: rectBox.x,
            top: rectBox.y,
            width: rectBox.w,
            height: rectBox.h,
            pointerEvents: "none",
            zIndex: 9998,
          }}
        />
      )}
    </div>
  );
}
