"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { RawWord, RawWordsPayload } from "./rawWordsTypes";

const DISPLAY_WIDTH = 560;
const RENDER_SCALE = 2;

interface RectBox { x: number; y: number; w: number; h: number }

interface Props {
  rawWordsPayload: RawWordsPayload;
  workingIncludedIds: Set<string>;
  selectedWordIds: Set<string>;
  getPageImageUrl: ((pageNum: number) => string) | null;
  onWordClick: (wordId: string) => void;
  onWordDragEnter: (wordId: string) => void;
  onRectSelect: (wordIds: string[]) => void;
  onHover: (wordId: string | null) => void;
}

export default function CanonicalWordsOverlay({
  rawWordsPayload,
  workingIncludedIds,
  selectedWordIds,
  getPageImageUrl,
  onWordClick,
  onWordDragEnter,
  onRectSelect,
  onHover,
}: Props) {
  const [actualDims, setActualDims] = useState<Map<number, { width: number; height: number }>>(
    new Map()
  );
  const [rectBox, setRectBox] = useState<RectBox | null>(null);

  // Quad-drag selection refs
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartWordIdRef = useRef<string | null>(null);

  // Rect-selection refs
  const rectAnchorRef = useRef<{ x: number; y: number } | null>(null);

  // Stable callback refs so the global listener doesn't need re-registration
  const onWordClickRef = useRef(onWordClick);
  const onWordDragEnterRef = useRef(onWordDragEnter);
  const onRectSelectRef = useRef(onRectSelect);
  useEffect(() => { onWordClickRef.current = onWordClick; }, [onWordClick]);
  useEffect(() => { onWordDragEnterRef.current = onWordDragEnter; }, [onWordDragEnter]);
  useEffect(() => { onRectSelectRef.current = onRectSelect; }, [onRectSelect]);

  useEffect(() => {
    function handleGlobalMouseUp(e: MouseEvent) {
      // --- Rect selection completion ---
      if (rectAnchorRef.current) {
        const anchor = rectAnchorRef.current;
        const x1 = Math.min(anchor.x, e.clientX);
        const y1 = Math.min(anchor.y, e.clientY);
        const x2 = Math.max(anchor.x, e.clientX);
        const y2 = Math.max(anchor.y, e.clientY);

        if (x2 - x1 > 4 || y2 - y1 > 4) {
          const overlapping: string[] = [];
          document.querySelectorAll<HTMLElement>("[data-word-id]").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
              const id = el.getAttribute("data-word-id");
              if (id) overlapping.push(id);
            }
          });
          if (overlapping.length > 0) onRectSelectRef.current(overlapping);
        }

        rectAnchorRef.current = null;
        setRectBox(null);
      }

      // --- Quad click/drag completion ---
      if (!hasDraggedRef.current && dragStartWordIdRef.current) {
        onWordClickRef.current(dragStartWordIdRef.current);
      }
      isDraggingRef.current = false;
      hasDraggedRef.current = false;
      dragStartWordIdRef.current = null;
    }

    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const wordsByPage = useMemo(() => {
    const map = new Map<number, RawWord[]>();
    rawWordsPayload.words.forEach((w) => {
      const bucket = map.get(w.page) ?? [];
      bucket.push(w);
      map.set(w.page, bucket);
    });
    return map;
  }, [rawWordsPayload.words]);

  const handleImageLoad = useCallback(
    (pageNum: number, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setActualDims((prev) => {
        const next = new Map(prev);
        next.set(pageNum, {
          width: img.naturalWidth / RENDER_SCALE,
          height: img.naturalHeight / RENDER_SCALE,
        });
        return next;
      });
    },
    []
  );

  // Container mousedown — starts rect-selection; quads stopPropagation so they never reach here
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

  // Quad mousedown — starts quad-drag selection
  function handleQuadMouseDown(e: React.MouseEvent, wordId: string) {
    e.preventDefault();
    e.stopPropagation(); // don't bubble to container (avoids triggering rect mode)
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartWordIdRef.current = wordId;
  }

  function handleQuadMouseEnter(wordId: string) {
    onHover(wordId);
    if (!isDraggingRef.current) return;
    if (!hasDraggedRef.current) {
      hasDraggedRef.current = true;
      if (dragStartWordIdRef.current && dragStartWordIdRef.current !== wordId) {
        onWordDragEnterRef.current(dragStartWordIdRef.current);
      }
    }
    onWordDragEnterRef.current(wordId);
  }

  return (
    <div
      className="canonical-words-overlay"
      data-testid="canonical-words-overlay"
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
        const bucket = wordsByPage.get(page.page) ?? [];
        const imageUrl = getPageImageUrl ? getPageImageUrl(page.page) : null;

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
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "block",
                  }}
                  draggable={false}
                  onLoad={(e) => handleImageLoad(page.page, e)}
                />
              )}
              {bucket.map((word) => {
                const [x0, y0, x1, y1] = word.quad;
                const isIncluded = workingIncludedIds.has(word.word_id);
                const isSelected = selectedWordIds.has(word.word_id);
                return (
                  <div
                    key={word.word_id}
                    className={[
                      "canonical-quad",
                      "raw-light",
                      isIncluded ? "included" : "",
                      isSelected ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-word-id={word.word_id}
                    style={{
                      left: x0 * scale,
                      top: y0 * scale,
                      width: Math.max(1, (x1 - x0) * scale),
                      height: Math.max(1, (y1 - y0) * scale),
                    }}
                    title={word.text}
                    onMouseDown={(e) => handleQuadMouseDown(e, word.word_id)}
                    onMouseEnter={() => handleQuadMouseEnter(word.word_id)}
                    onMouseLeave={() => onHover(null)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Rubber-band selection rectangle */}
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
