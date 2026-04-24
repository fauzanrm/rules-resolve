"use client";

import { useMemo, useState, useCallback } from "react";
import { RawWord, RawWordsPayload } from "./rawWordsTypes";

const DISPLAY_WIDTH = 560;
const RENDER_SCALE = 2; // must match backend Matrix(2.0, 2.0)

interface Props {
  payload: RawWordsPayload;
  variant: "generated" | "committed";
  getPageImageUrl: ((pageNum: number) => string) | null;
  onHover: (word: RawWord | null, index: number | null) => void;
}

export default function RawWordsOverlay({ payload, variant, getPageImageUrl, onHover }: Props) {
  // Keyed by page number; populated via onLoad from actual rendered image dimensions.
  // This corrects inferred page widths in old-format preseeded data.
  const [actualDims, setActualDims] = useState<Map<number, { width: number; height: number }>>(
    new Map()
  );

  const wordsByPage = useMemo(() => {
    const map = new Map<number, { word: RawWord; index: number }[]>();
    payload.words.forEach((w, i) => {
      const bucket = map.get(w.page) ?? [];
      bucket.push({ word: w, index: i });
      map.set(w.page, bucket);
    });
    return map;
  }, [payload.words]);

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

  return (
    <div
      className={`raw-words-overlay raw-words-overlay-${variant}`}
      data-testid="raw-words-overlay"
    >
      {payload.pages.map((page) => {
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
                  loading="lazy"
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
              {bucket.map(({ word, index }) => {
                const [x0, y0, x1, y1] = word.quad;
                return (
                  <div
                    key={word.word_id}
                    className={`raw-word-quad ${variant}`}
                    data-word-id={word.word_id}
                    style={{
                      left: x0 * scale,
                      top: y0 * scale,
                      width: Math.max(1, (x1 - x0) * scale),
                      height: Math.max(1, (y1 - y0) * scale),
                    }}
                    onMouseEnter={() => onHover(word, index)}
                    onMouseLeave={() => onHover(null, null)}
                    title={word.text}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { DISPLAY_WIDTH };
