"use client";

import { TERMS_CONTENT } from "@/content/terms";

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TermsModal({ open, onClose }: TermsModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="terms-title">Terms and Conditions</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <pre>{TERMS_CONTENT}</pre>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
