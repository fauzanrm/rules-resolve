"use client";

import { useState } from "react";
import { post } from "@/lib/api";
import { ChatMessage, ChatQueryResponse } from "./askTypes";

function uid(): string {
  return Math.random().toString(36).slice(2);
}

export function useChat(chatroomSlug: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await post<ChatQueryResponse>(`/ask/${chatroomSlug}`, {
        question: content,
        history,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: res.answer,
          citations: res.citations,
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

  return { messages, sendMessage, isLoading };
}
