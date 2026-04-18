"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { get } from "@/lib/api";
import Navbar from "@/components/Navbar";
import ChatroomCard from "@/components/ChatroomCard";

interface Chatroom {
  id: number;
  name: string;
  cover_image_url?: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [chatrooms, setChatrooms] = useState<Chatroom[]>([]);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "user") {
      router.replace("/under-construction");
      return;
    }

    get<Chatroom[]>("/chatrooms/")
      .then(setChatrooms)
      .catch(() => setFetchError(true));
  }, [router]);

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
          ) : chatrooms.length === 0 ? (
            <p className="empty-state">Board games in progress...</p>
          ) : (
            <div className="chatroom-grid">
              {chatrooms.map((c) => (
                <ChatroomCard key={c.id} name={c.name} coverImageUrl={c.cover_image_url} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
