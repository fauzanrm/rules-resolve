"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { getSession } from "@/lib/auth";
import { post } from "@/lib/api";
import Toast from "@/components/Toast";

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 1.5v13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M3 2.2c1.4-.8 2.8-.8 4.2 0s2.8.8 4.2 0v6.4c-1.4.8-2.8.8-4.2 0s-2.8-.8-4.2 0V2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ReportIssueButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function handleClose() {
    setOpen(false);
    setDescription("");
  }

  async function handleSubmit() {
    const trimmed = description.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const session = getSession();
      await post("/reports/", {
        username: session?.username ?? null,
        role: session?.role ?? null,
        page_url: pathname ?? "",
        description: trimmed,
      });
      handleClose();
      showToast("Report sent — thanks for letting us know.", "success");
    } catch {
      showToast("Couldn't send report. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <>
      <button
        className="report-issue-btn"
        onClick={() => setOpen(true)}
        aria-label="Report an issue"
        title="Report an issue"
      >
        <FlagIcon />
      </button>

      {open && (
        <div
          className="modal-overlay"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-issue-title"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="report-issue-title">Report an Issue</h2>
              <button onClick={handleClose} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <p className="report-issue-description">
                Ran into a bug or something that isn&apos;t working right? Tell us what happened
                and our team will look into it.
              </p>
              <label className="report-issue-label" htmlFor="report-issue-input">
                What went wrong?
              </label>
              <textarea
                id="report-issue-input"
                className="feedback-details-input"
                placeholder="Describe the issue you ran into"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={handleSubmit}
                disabled={!description.trim() || submitting}
              >
                {submitting ? "Sending…" : "Send Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast
        message={toast?.message ?? ""}
        type={toast?.type ?? "success"}
        visible={toast !== null}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
