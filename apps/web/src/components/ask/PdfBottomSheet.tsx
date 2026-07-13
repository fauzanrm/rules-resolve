"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const CLOSE_DISTANCE_PX = 120;
const CLOSE_VELOCITY_PX_MS = 0.5;

export default function PdfBottomSheet({ open, onClose, children }: Props) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = { y: e.clientY, t: Date.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setDragY(Math.max(0, e.clientY - dragStart.current.y));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const delta = e.clientY - dragStart.current.y;
    const elapsed = Date.now() - dragStart.current.t;
    const velocity = delta / Math.max(elapsed, 1);
    dragStart.current = null;
    setDragging(false);
    setDragY(0);
    if (delta > CLOSE_DISTANCE_PX || velocity > CLOSE_VELOCITY_PX_MS) {
      onClose();
    }
  }

  return (
    <>
      <div
        className={`pdf-sheet-backdrop${open ? " pdf-sheet-backdrop--open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`pdf-sheet${open ? " pdf-sheet--open" : ""}${dragging ? " pdf-sheet--dragging" : ""}`}
        style={dragging ? { transform: `translateY(${dragY}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Rulebook PDF"
      >
        <div
          className="pdf-sheet-grabber-area"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="pdf-sheet-grabber" />
        </div>
        <div className="pdf-sheet-body">{children}</div>
      </div>
    </>
  );
}
