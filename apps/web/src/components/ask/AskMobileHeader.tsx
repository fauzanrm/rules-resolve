"use client";

import ReportIssueButton from "@/components/ReportIssueButton";

interface Props {
  title: string;
  onBack: () => void;
  onOpenPdf?: () => void;
}

export default function AskMobileHeader({ title, onBack, onOpenPdf }: Props) {
  return (
    <nav className="ask-mobile-header">
      <button className="ask-mobile-back-btn" onClick={onBack} aria-label="Back">
        ←
      </button>
      <span className="ask-mobile-header-title">{title}</span>
      <ReportIssueButton />
      {onOpenPdf && (
        <button className="ask-mobile-pdf-btn" onClick={onOpenPdf}>
          View PDF
        </button>
      )}
    </nav>
  );
}
