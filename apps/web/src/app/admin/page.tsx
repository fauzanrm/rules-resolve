"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "user") {
      router.replace("/under-construction");
    }
  }, [router]);

  return (
    <main>
      <p>Admin homepage — coming soon.</p>
    </main>
  );
}
