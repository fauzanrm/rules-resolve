"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { HighlightTarget } from "./useHighlight";
import { CitationWord } from "./askTypes";

const DISPLAY_WIDTH = 560;
const RENDER_SCALE = 2; // must match backend Matrix(2.0, 2.0)
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.6;
const INITIAL_ZOOM = 1.8;
const CITATION_TARGET_WIDTH_RATIO = 0.75;

export interface PdfViewerHandle {
  focusOnWords: (page: number, words: CitationWord[]) => void;
}

interface Props {
  getPageImageUrl: ((page: number) => string) | null;
  pageCount: number;
  highlight: HighlightTarget | null;
  displayWidth?: number;
  // Two-finger pinch-to-zoom is opt-in: only the mobile bottom-sheet viewer
  // wants it, not the desktop split-panel instance.
  enablePinchZoom?: boolean;
}

interface Dims {
  width: number; // natural px, rendered at RENDER_SCALE×
  height: number;
}

const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { getPageImageUrl, pageCount, highlight, displayWidth = DISPLAY_WIDTH, enablePinchZoom = false },
  ref
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageElRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [pageDims, setPageDims] = useState<Map<number, Dims>>(new Map());
  const pageDimsRef = useRef(pageDims);
  pageDimsRef.current = pageDims;

  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [focusPage, setFocusPage] = useState<number | null>(null);

  const pinchPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
    anchorPage: number;
    anchorPts: { x: number; y: number };
  } | null>(null);

  const zoomed = zoom > MIN_ZOOM + 0.001;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const focusPageRef = useRef(focusPage);
  focusPageRef.current = focusPage;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  // When zoomed, every page (not just the one a citation targeted) renders at
  // the zoomed width, so scrolling the container pans through the whole
  // document at that zoom level instead of being locked to a single page.
  function widthForPage(): number {
    return zoomRef.current > MIN_ZOOM + 0.001 ? displayWidth * zoomRef.current : displayWidth;
  }

  // Paints (or clears) the highlight rectangles for one page's canvas. Called
  // both from the highlight-sync effect and right after an image load resizes
  // the canvas backing store — resizing a canvas clears its contents, so the
  // draw must be re-applied at that point too, using the size that was just set.
  function paintHighlight(page: number, canvas: HTMLCanvasElement, natWidth: number) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const h = highlightRef.current;
    if (!h || h.page !== page || h.words.length === 0) return;

    const scale = widthForPage() / (natWidth / RENDER_SCALE);
    ctx.fillStyle = "rgba(255, 220, 0, 0.4)";
    ctx.strokeStyle = "rgba(200, 160, 0, 0.7)";
    ctx.lineWidth = 1;
    for (const word of h.words) {
      const [x0, y0, x1, y1] = word.quad;
      ctx.fillRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      ctx.strokeRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    }
  }

  const setPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageElRefs.current.set(page, el);
    else pageElRefs.current.delete(page);
  }, []);

  const setCanvasRef = useCallback((page: number, el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(page, el);
    else canvasRefs.current.delete(page);
  }, []);

  function recordDims(page: number, width: number, height: number) {
    setPageDims((prev) => {
      const existing = prev.get(page);
      if (existing && existing.width === width && existing.height === height) return prev;
      const next = new Map(prev);
      next.set(page, { width, height });
      return next;
    });
  }

  // Resolves a page's natural image dimensions, loading it out-of-band if it
  // hasn't been rendered yet (e.g. a citation jump to a page never scrolled to).
  function loadDims(page: number): Promise<Dims> {
    const cached = pageDimsRef.current.get(page);
    if (cached) return Promise.resolve(cached);

    const url = getPageImageUrl ? getPageImageUrl(page) : null;
    if (!url) return Promise.resolve({ width: displayWidth * RENDER_SCALE, height: displayWidth * RENDER_SCALE * 1.414 });

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        recordDims(page, dims.width, dims.height);
        resolve(dims);
      };
      img.onerror = () => {
        resolve({ width: displayWidth * RENDER_SCALE, height: displayWidth * RENDER_SCALE * 1.414 });
      };
      img.src = url;
    });
  }

  function getCurrentPage(): number {
    const containerTop = rootRef.current?.getBoundingClientRect().top ?? 0;
    let closestPage = 1;
    let closestDist = Infinity;
    pageElRefs.current.forEach((el, page) => {
      const dist = Math.abs(el.getBoundingClientRect().top - containerTop);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = page;
      }
    });
    return closestPage;
  }

  function scrollToPage(page: number) {
    const el = pageElRefs.current.get(page);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function resetZoom(andScrollTo?: number) {
    setZoom(MIN_ZOOM);
    setFocusPage(null);
    if (containerRef.current) containerRef.current.scrollLeft = 0;
    if (andScrollTo != null) {
      requestAnimationFrame(() => scrollToPage(andScrollTo));
    }
  }

  // Sets the zoom level and scrolls the container so that `anchorPts` (a
  // point in PDF-points space on `page`) ends up under `screenAnchor`
  // (container-relative px; defaults to the container's center). Used for
  // the zoom toolbar, citation jumps, and continuous pinch updates alike.
  async function applyZoom(
    page: number,
    targetZoom: number,
    anchorPts?: { x: number; y: number },
    screenAnchor?: { x: number; y: number }
  ) {
    const dims = await loadDims(page);
    const pdfWidth = dims.width / RENDER_SCALE;
    const pdfHeight = dims.height / RENDER_SCALE;
    const scaleAtZoom1 = displayWidth / pdfWidth;
    const pts = anchorPts ?? { x: pdfWidth / 2, y: pdfHeight / 2 };
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));

    setFocusPage(page);
    setZoom(z);

    requestAnimationFrame(() => {
      const container = containerRef.current;
      const pageEl = pageElRefs.current.get(page);
      if (!container || !pageEl) return;

      const containerRect = container.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const anchorPxX = pts.x * scaleAtZoom1 * z;
      const anchorPxY = pts.y * scaleAtZoom1 * z;
      const targetX = screenAnchor?.x ?? containerRect.width / 2;
      const targetY = screenAnchor?.y ?? containerRect.height / 2;
      const pageLeftInContent = pageRect.left - containerRect.left + container.scrollLeft;
      const pageTopInContent = pageRect.top - containerRect.top + container.scrollTop;

      container.scrollTo({
        left: pageLeftInContent + anchorPxX - targetX,
        top: pageTopInContent + anchorPxY - targetY,
      });
    });
  }

  useImperativeHandle(ref, () => ({
    focusOnWords(page: number, words: CitationWord[]) {
      if (words.length === 0) {
        resetZoom(page);
        return;
      }
      const x0 = Math.min(...words.map((w) => w.quad[0]));
      const y0 = Math.min(...words.map((w) => w.quad[1]));
      const x1 = Math.max(...words.map((w) => w.quad[2]));
      const y1 = Math.max(...words.map((w) => w.quad[3]));

      loadDims(page).then((dims) => {
        const pdfWidth = dims.width / RENDER_SCALE;
        const scaleAtZoom1 = displayWidth / pdfWidth;
        const bboxWidthPx = (x1 - x0) * scaleAtZoom1;
        const vw = rootRef.current?.clientWidth ?? displayWidth;
        const desiredZoom =
          bboxWidthPx > 0 ? (CITATION_TARGET_WIDTH_RATIO * vw) / bboxWidthPx : MIN_ZOOM;
        applyZoom(page, desiredZoom, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
      });
    },
  }));

  function handleZoomIn() {
    if (!zoomed) {
      applyZoom(getCurrentPage(), INITIAL_ZOOM);
    } else if (focusPage != null) {
      applyZoom(focusPage, zoom * ZOOM_STEP);
    }
  }

  function handleZoomOut() {
    if (!zoomed || focusPage == null) return;
    const next = zoom / ZOOM_STEP;
    if (next <= MIN_ZOOM + 0.001) {
      resetZoom(focusPage);
    } else {
      applyZoom(focusPage, next);
    }
  }

  function handleFitPage() {
    if (focusPage != null) resetZoom(focusPage);
  }

  // Finds which page element a viewport point falls over — used to figure out
  // which page a pinch gesture should anchor/zoom around.
  function findPageAtPoint(clientX: number, clientY: number): number | null {
    for (const [page, el] of pageElRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return page;
      }
    }
    return null;
  }

  // Converts a viewport point into a { page, pts } pair, where pts is in the
  // same PDF-points coordinate space as citation word quads.
  function screenToPdfPts(clientX: number, clientY: number): { page: number; pts: { x: number; y: number } } | null {
    const page = findPageAtPoint(clientX, clientY) ?? getCurrentPage();
    const el = pageElRefs.current.get(page);
    const dims = pageDimsRef.current.get(page);
    if (!el || !dims) return null;
    const rect = el.getBoundingClientRect();
    const pdfWidth = dims.width / RENDER_SCALE;
    const scale = rect.width / pdfWidth;
    if (scale <= 0) return null;
    return { page, pts: { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale } };
  }

  function pinchMidpoint(pts: { x: number; y: number }[]) {
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  // Single-finger panning is handled natively by the container's own
  // scrolling, so these only need to track two simultaneous touch pointers
  // for pinch-to-zoom.
  function handlePinchPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!enablePinchZoom || e.pointerType !== "touch") return;
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.current.size !== 2) return;

    const pts = Array.from(pinchPointers.current.values());
    const mid = pinchMidpoint(pts);
    const anchor = screenToPdfPts(mid.x, mid.y);
    if (!anchor) return;
    pinchStateRef.current = {
      startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      startZoom: zoomRef.current,
      anchorPage: anchor.page,
      anchorPts: anchor.pts,
    };
  }

  function handlePinchPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pinchPointers.current.has(e.pointerId)) return;
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.current.size !== 2 || !pinchStateRef.current) return;

    const pts = Array.from(pinchPointers.current.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (dist <= 0) return;
    const mid = pinchMidpoint(pts);
    const containerRect = containerRef.current?.getBoundingClientRect();
    const screenAnchor = containerRect
      ? { x: mid.x - containerRect.left, y: mid.y - containerRect.top }
      : undefined;

    const { startDist, startZoom, anchorPage, anchorPts } = pinchStateRef.current;
    applyZoom(anchorPage, startZoom * (dist / startDist), anchorPts, screenAnchor);
  }

  function handlePinchPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    pinchPointers.current.delete(e.pointerId);
    if (pinchPointers.current.size < 2) pinchStateRef.current = null;
  }

  // Re-paint highlights whenever highlight state, page dims, zoom, or focus changes.
  // (The per-image-load paint in handleImageLoad covers the case where a canvas
  // resize — which clears its contents — happens after this effect already ran.)
  useEffect(() => {
    canvasRefs.current.forEach((canvas, page) => {
      const dims = pageDims.get(page);
      if (dims) {
        paintHighlight(page, canvas, dims.width);
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, pageDims, displayWidth, zoom, focusPage]);

  function handleImageLoad(page: number, e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    recordDims(page, img.naturalWidth, img.naturalHeight);

    const canvas = canvasRefs.current.get(page);
    if (canvas) {
      // Canvas pixel dimensions match the currently rendered display size
      const pdfWidth = img.naturalWidth / RENDER_SCALE;
      const pdfHeight = img.naturalHeight / RENDER_SCALE;
      const widthPx = widthForPage();
      const displayScale = widthPx / pdfWidth;
      canvas.width = widthPx;
      canvas.height = pdfHeight * displayScale;
      paintHighlight(page, canvas, img.naturalWidth);
    }
  }

  function renderPageContent(page: number, widthPx: number) {
    const dims = pageDims.get(page);
    const pdfWidth = dims ? dims.width / RENDER_SCALE : null;
    const pdfHeight = dims ? dims.height / RENDER_SCALE : null;
    const heightPx = pdfWidth && pdfHeight ? pdfHeight * (widthPx / pdfWidth) : widthPx * 1.414;
    const imageUrl = getPageImageUrl ? getPageImageUrl(page) : null;

    return (
      <div
        key={page}
        ref={(el) => setPageRef(page, el)}
        className="pdf-page-wrapper"
        style={{ width: widthPx, height: heightPx, position: "relative" }}
      >
        {imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={`Page ${page}`}
              loading="lazy"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: "block",
              }}
              draggable={false}
              onLoad={(e) => handleImageLoad(page, e)}
            />
            <canvas
              ref={(el) => setCanvasRef(page, el)}
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                width: "100%",
                height: "100%",
              }}
            />
          </>
        ) : (
          <div className="pdf-empty-state">
            <p>Page {page}</p>
          </div>
        )}
      </div>
    );
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const pageWidthPx = widthForPage();

  return (
    <div className="pdf-viewer-root" ref={rootRef}>
      <div
        className={`pdf-viewer-container${zoomed ? " pdf-viewer-container--zoomed" : ""}`}
        ref={containerRef}
        onPointerDown={enablePinchZoom ? handlePinchPointerDown : undefined}
        onPointerMove={enablePinchZoom ? handlePinchPointerMove : undefined}
        onPointerUp={enablePinchZoom ? handlePinchPointerEnd : undefined}
        onPointerCancel={enablePinchZoom ? handlePinchPointerEnd : undefined}
      >
        {pages.map((page) => renderPageContent(page, pageWidthPx))}
      </div>

      <div className="pdf-viewer-toolbar">
        <button
          type="button"
          className="pdf-viewer-toolbar-btn"
          onClick={handleZoomOut}
          disabled={!zoomed}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="pdf-viewer-toolbar-btn"
          onClick={handleFitPage}
          disabled={!zoomed}
          aria-label="Fit page"
        >
          ⤢
        </button>
        <button
          type="button"
          className="pdf-viewer-toolbar-btn"
          onClick={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
});

export default PdfViewer;
