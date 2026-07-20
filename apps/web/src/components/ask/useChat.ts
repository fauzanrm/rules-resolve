"use client";

import { useRef, useState } from "react";
import { patch, post } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { ChatMessage, ChatQueryResponse, FeedbackCategory, Rating } from "./askTypes";

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useChat(chatroomSlug: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackTurnId, setFeedbackTurnId] = useState<number | null>(null);
  const sessionIdRef = useRef<string>(uuidv4());

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const username = getSession()?.username;

    try {
      const res = await post<ChatQueryResponse>(`/ask/${chatroomSlug}`, {
        question: content,
        history,
        session_id: sessionIdRef.current,
        username,
        viewport_width: typeof window !== "undefined" ? window.innerWidth : undefined,
        viewport_height: typeof window !== "undefined" ? window.innerHeight : undefined,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: res.answer,
          citations: res.citations,
          turnId: res.turn_id,
          rating: null,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "error",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function rateMessage(messageId: string, rating: Rating) {
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.turnId === undefined) return;

    const nextRating = target.rating === rating ? null : rating;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, rating: nextRating } : m))
    );

    try {
      await patch(`/ask/turns/${target.turnId}/rating`, { rating: nextRating });
      if (nextRating === "down") {
        setFeedbackTurnId(target.turnId);
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, rating: target.rating ?? null } : m))
      );
    }
  }

  function closeFeedbackModal() {
    setFeedbackTurnId(null);
  }

  async function submitFeedback(categories: FeedbackCategory[], details: string) {
    if (feedbackTurnId === null) return;
    const turnId = feedbackTurnId;
    setFeedbackTurnId(null);
    try {
      await patch(`/ask/turns/${turnId}/feedback`, { categories, details: details || null });
    } catch {
      // Feedback is best-effort; the rating itself was already recorded.
    }
  }

  return {
    messages,
    sendMessage,
    rateMessage,
    isLoading,
    feedbackTurnId,
    closeFeedbackModal,
    submitFeedback,
  };
}
