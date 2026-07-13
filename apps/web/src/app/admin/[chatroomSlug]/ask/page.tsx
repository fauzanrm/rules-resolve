"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession, getRoleRoute, Role } from "@/lib/auth";
import { get } from "@/lib/api";
import Navbar from "@/components/Navbar";
import PdfViewer, { PdfViewerHandle } from "@/components/ask/PdfViewer";
import MessageList from "@/components/ask/MessageList";
import ChatInput from "@/components/ask/ChatInput";
import { useChat } from "@/components/ask/useChat";
import ThumbsDownFeedbackModal from "@/components/ask/ThumbsDownFeedbackModal";
import { useHighlight } from "@/components/ask/useHighlight";
import { Citation } from "@/components/ask/askTypes";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

  function handleCitationClick(citation: Citation) {
    highlight(citation);
    viewerRef.current?.goToPage(citation.page);
  }

  const homeRoute = role ? getRoleRoute(role) : "/admin";

  if (loading) {
    return (
      <div className="ask-page">
        <Navbar onBack={() => router.push(homeRoute)} />
        <main className="ask-main ask-main--centered">
          <p className="ask-status-text">Loading…</p>
        </main>
      </div>
    );
  }

  if (loadError || !pageData) {
    return (
      <div className="ask-page">
        <Navbar onBack={() => router.push(homeRoute)} />
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
        <Navbar
          onBack={() => router.push(homeRoute)}
          titleSlot={<span className="ask-chatroom-title">{pageData.chatroom_name}</span>}
        />
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

  return (
    <div className="ask-page">
      <Navbar
        onBack={() => router.push(homeRoute)}
        titleSlot={<span className="ask-chatroom-title">{chatroom_name}</span>}
      />
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
