"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession, getRoleRoute, Role } from "@/lib/auth";
import { get } from "@/lib/api";
import Navbar from "@/components/Navbar";
import AskMobileHeader from "@/components/ask/AskMobileHeader";
import PdfBottomSheet from "@/components/ask/PdfBottomSheet";
import PdfViewer, { PdfViewerHandle } from "@/components/ask/PdfViewer";
import MessageList from "@/components/ask/MessageList";
import ChatInput from "@/components/ask/ChatInput";
import { useChat } from "@/components/ask/useChat";
import ThumbsDownFeedbackModal from "@/components/ask/ThumbsDownFeedbackModal";
import { useHighlight } from "@/components/ask/useHighlight";
import { Citation } from "@/components/ask/askTypes";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MOBILE_BREAKPOINT = "(max-width: 768px)";
const MOBILE_PDF_HORIZONTAL_MARGIN = 32;

interface DocumentMeta {
  id: number;
  file_name: string;
  page_count: number;
  pdf_url: string | null;
}

interface ConfigPageData {
  chatroom_id: number;
  chatroom_name: string;
  document: DocumentMeta | null;
  published_at: string | null;
}

export default function AskPage() {
  const router = useRouter();
  const params = useParams();
  const chatroomSlug = params.chatroomSlug as string;

  const [pageData, setPageData] = useState<ConfigPageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pdfSheetOpen, setPdfSheetOpen] = useState(false);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const {
    messages,
    sendMessage,
    rateMessage,
    isLoading,
    feedbackTurnId,
    closeFeedbackModal,
    submitFeedback,
  } = useChat(chatroomSlug);
  const { active: activeHighlight, highlight } = useHighlight();

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setRole(session.role);

    get<ConfigPageData>(`/config/${chatroomSlug}`)
      .then((data) => {
        setPageData(data);
        setLoading(false);
      })
      .catch(() => {
        setLoadError("Failed to load chatroom. Please try again.");
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const sync = () => {
      setIsMobile(mq.matches);
      setViewportWidth(window.innerWidth);
    };
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  function handleCitationClick(citation: Citation) {
    highlight(citation);
    viewerRef.current?.goToPage(citation.page);
    setPdfSheetOpen(true);
  }

  const homeRoute = role ? getRoleRoute(role) : "/admin";
  const mobilePdfWidth = Math.max(200, viewportWidth - MOBILE_PDF_HORIZONTAL_MARGIN);

  function renderHeader(title: string, onOpenPdf?: () => void) {
    if (isMobile) {
      return (
        <AskMobileHeader
          title={title}
          onBack={() => router.push(homeRoute)}
          onOpenPdf={onOpenPdf}
        />
      );
    }
    return (
      <Navbar
        onBack={() => router.push(homeRoute)}
        titleSlot={<span className="ask-chatroom-title">{title}</span>}
      />
    );
  }

  if (loading) {
    return (
      <div className="ask-page">
        {renderHeader("Loading…")}
        <main className="ask-main ask-main--centered">
          <p className="ask-status-text">Loading…</p>
        </main>
      </div>
    );
  }

  if (loadError || !pageData) {
    return (
      <div className="ask-page">
        {renderHeader("Chatroom")}
        <main className="ask-main ask-main--centered">
          <p className="ask-status-text ask-status-text--error">
            {loadError ?? "Chatroom not found."}
          </p>
          <button className="ask-back-btn" onClick={() => router.push(homeRoute)}>
            ← Back to chatrooms
          </button>
        </main>
      </div>
    );
  }

  const isPublished = Boolean(pageData.published_at) && Boolean(pageData.document);

  if (!isPublished) {
    return (
      <div className="ask-page">
        {renderHeader(pageData.chatroom_name)}
        <main className="ask-main ask-main--centered">
          <p className="ask-status-text">
            {pageData.document
              ? "This chatroom is not published yet."
              : "This chatroom has no processed document."}
          </p>
          <button className="ask-back-btn" onClick={() => router.push(homeRoute)}>
            ← Back to chatrooms
          </button>
        </main>
      </div>
    );
  }

  const { document: doc, chatroom_name } = pageData;
  const getPageImageUrl = (page: number) =>
    `${API_BASE}/config/${chatroomSlug}/page-image/${page}`;

  if (isMobile) {
    return (
      <div className="ask-page">
        {renderHeader(chatroom_name, () => setPdfSheetOpen(true))}
        <main className="ask-mobile-main">
          <MessageList
            messages={messages}
            activeHighlight={activeHighlight}
            onCitationClick={handleCitationClick}
            onRate={rateMessage}
            isLoading={isLoading}
          />
          <ChatInput onSubmit={sendMessage} disabled={isLoading} />
        </main>
        <PdfBottomSheet open={pdfSheetOpen} onClose={() => setPdfSheetOpen(false)}>
          <PdfViewer
            ref={viewerRef}
            getPageImageUrl={getPageImageUrl}
            pageCount={doc!.page_count}
            highlight={activeHighlight}
            displayWidth={mobilePdfWidth}
          />
        </PdfBottomSheet>
        <ThumbsDownFeedbackModal
          open={feedbackTurnId !== null}
          onClose={closeFeedbackModal}
          onSubmit={submitFeedback}
        />
      </div>
    );
  }

  return (
    <div className="ask-page">
      {renderHeader(chatroom_name)}
      <main className="ask-split-main">
        <section className="ask-pdf-panel">
          <PdfViewer
            ref={viewerRef}
            getPageImageUrl={getPageImageUrl}
            pageCount={doc!.page_count}
            highlight={activeHighlight}
          />
        </section>
        <section className="ask-chat-panel">
          <MessageList
            messages={messages}
            activeHighlight={activeHighlight}
            onCitationClick={handleCitationClick}
            onRate={rateMessage}
            isLoading={isLoading}
          />
          <ChatInput onSubmit={sendMessage} disabled={isLoading} />
        </section>
      </main>
      <ThumbsDownFeedbackModal
        open={feedbackTurnId !== null}
        onClose={closeFeedbackModal}
        onSubmit={submitFeedback}
      />
    </div>
  );
}
