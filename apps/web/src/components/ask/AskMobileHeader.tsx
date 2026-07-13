"use client";

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
      {onOpenPdf && (
        <button className="ask-mobile-pdf-btn" onClick={onOpenPdf}>
          📄 PDF
        </button>
      )}
    </nav>
  );
}
