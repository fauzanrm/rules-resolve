"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSession } from "@/lib/auth";
import Navbar from "@/components/Navbar";

export default function AskPage() {
  const router = useRouter();
  const params = useParams();
  const chatroomSlug = params.chatroomSlug as string;

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "user") {
      router.replace("/under-construction");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ask-page">
      <Navbar
        onBack={() => router.push("/admin")}
        titleSlot={<span className="ask-chatroom-title">{chatroomSlug}</span>}
      />
      <main className="ask-main">
        <div className="ask-coming-soon">
          <p className="ask-coming-soon-text">Coming soon</p>
          <button className="ask-back-btn" onClick={() => router.push("/admin")}>
            ← Back to chatrooms
          </button>
        </div>
      </main>
    </div>
  );
}
