"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, getRoleRoute } from "@/lib/auth";
import { get } from "@/lib/api";
import Navbar from "@/components/Navbar";
import ChatroomCard from "@/components/ChatroomCard";

interface Chatroom {
  id: number;
  name: string;
  cover_image_url?: string | null;
  published_at?: string | null;
}

export default function ChatroomsPage() {
  const router = useRouter();
  const [chatrooms, setChatrooms] = useState<Chatroom[]>([]);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "admin") {
      router.replace(getRoleRoute(session.role));
      return;
    }

    get<Chatroom[]>("/chatrooms/")
      .then((rooms) => setChatrooms(rooms))
      .catch(() => setFetchError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const publishedChatrooms = chatrooms.filter((c) => c.published_at);

  return (
    <div className="admin-page">
      <Navbar />
      <main className="admin-main">
        <section className="hero-section">
          <h1>RuleResolve</h1>
          <p>
            Don&apos;t know the exact rules to your favorite board game? Just ask the rulebook
            directly.
          </p>
        </section>
        <section className="chatroom-section">
          {fetchError ? (
            <p className="fetch-error">Failed to load board games. Please refresh.</p>
          ) : (
            <div className="chatroom-grid">
              {publishedChatrooms.map((c) => (
                <ChatroomCard
                  key={c.id}
                  chatroomId={c.id}
                  name={c.name}
                  coverImageUrl={c.cover_image_url}
                  viewOnly
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
