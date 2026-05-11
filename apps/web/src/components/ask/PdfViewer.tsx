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

const DISPLAY_WIDTH = 560;
const RENDER_SCALE = 2; // must match backend Matrix(2.0, 2.0)

export interface PdfViewerHandle {
  goToPage: (page: number) => void;
}

interface Props {
  getPageImageUrl: ((page: number) => string) | null;
  pageCount: number;
  highlight: HighlightTarget | null;
}

const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { getPageImageUrl, pageCount, highlight },
  ref
) {
  const pageElRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [pageDims, setPageDims] = useState<Map<number, { width: number; height: number }>>(
    new Map()
  );

  const setPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageElRefs.current.set(page, el);
    else pageElRefs.current.delete(page);
  }, []);

  const setCanvasRef = useCallback((page: number, el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(page, el);
    else canvasRefs.current.delete(page);
  }, []);

  useImperativeHandle(ref, () => ({
    goToPage(page: number) {
      const el = pageElRefs.current.get(page);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
  }));

  // Draw / clear highlights whenever highlight state or page dims change
  useEffect(() => {
    // Clear all canvases first
    canvasRefs.current.forEach((canvas) => {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    if (!highlight || highlight.words.length === 0) return;

    const canvas = canvasRefs.current.get(highlight.page);
    if (!canvas) return;

    const dims = pageDims.get(highlight.page);
    if (!dims) return;

    // Scale from PDF points → display pixels
    // dims.width is naturalWidth (rendered at RENDER_SCALE×), so PDF points = dims.width / RENDER_SCALE
    const scale = DISPLAY_WIDTH / (dims.width / RENDER_SCALE);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "rgba(255, 220, 0, 0.4)";
    ctx.strokeStyle = "rgba(200, 160, 0, 0.7)";
    ctx.lineWidth = 1;

    for (const word of highlight.words) {
      const [x0, y0, x1, y1] = word.quad;
      ctx.fillRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      ctx.strokeRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    }
  }, [highlight, pageDims]);

  function handleImageLoad(page: number, e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const dims = { width: img.naturalWidth, height: img.naturalHeight };

    setPageDims((prev) => {
      const next = new Map(prev);
      next.set(page, dims);
      return next;
    });

    const canvas = canvasRefs.current.get(page);
    if (canvas) {
      // Canvas pixel dimensions match the displayed image size
      const pdfWidth = dims.width / RENDER_SCALE;
      const pdfHeight = dims.height / RENDER_SCALE;
      const displayScale = DISPLAY_WIDTH / pdfWidth;
      canvas.width = DISPLAY_WIDTH;
      canvas.height = pdfHeight * displayScale;
    }
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="pdf-viewer-container">
      {pages.map((page) => {
        const dims = pageDims.get(page);
        const pdfWidth = dims ? dims.width / RENDER_SCALE : null;
        const pdfHeight = dims ? dims.height / RENDER_SCALE : null;
        const displayHeight = pdfWidth && pdfHeight
          ? pdfHeight * (DISPLAY_WIDTH / pdfWidth)
          : DISPLAY_WIDTH * 1.414; // A4 fallback aspect ratio

        const imageUrl = getPageImageUrl ? getPageImageUrl(page) : null;

        return (
          <div
            key={page}
            ref={(el) => setPageRef(page, el)}
            className="pdf-page-wrapper"
            style={{ width: DISPLAY_WIDTH, height: displayHeight, position: "relative" }}
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
      })}
    </div>
  );
});

export default PdfViewer;
