"use client";

import { useRef, useState } from "react";
import { patch, post } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { ChatMessage, ChatQueryResponse, Rating } from "./askTypes";

function uid(): string {
  return Math.random().toString(36).slice(2);
}

export function useChat(chatroomSlug: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const sessionIdRef = useRef<string>(uid());

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
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, rating: target.rating ?? null } : m))
      );
    }
  }

  return { messages, sendMessage, rateMessage, isLoading };
}
