"use client";

import { useState } from "react";
import { FEEDBACK_CATEGORIES, FeedbackCategory } from "./askTypes";

interface ThumbsDownFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (categories: FeedbackCategory[], details: string) => void;
}

export default function ThumbsDownFeedbackModal({
  open,
  onClose,
  onSubmit,
}: ThumbsDownFeedbackModalProps) {
  const [categories, setCategories] = useState<FeedbackCategory[]>([]);
  const [details, setDetails] = useState("");

  if (!open) return null;

  function handleClose() {
    setCategories([]);
    setDetails("");
    onClose();
  }

  function toggleCategory(value: FeedbackCategory) {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  function handleSubmit() {
    onSubmit(categories, details.trim());
    setCategories([]);
    setDetails("");
  }

  return (
    <div
      className="modal-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="feedback-title">What went wrong?</h2>
          <button onClick={handleClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="feedback-categories">
            {FEEDBACK_CATEGORIES.map((c) => (
              <label key={c.value} className="feedback-category-option">
                <input
                  type="checkbox"
                  name="feedback-category"
                  value={c.value}
                  checked={categories.includes(c.value)}
                  onChange={() => toggleCategory(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
          <textarea
            className="feedback-details-input"
            placeholder="Anything else you'd like to add? (optional)"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
          />
        </div>
        <div className="modal-footer">
          <button onClick={handleSubmit}>Submit</button>
        </div>
      </div>
    </div>
  );
}
