"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";

export default function UnderConstructionPage() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <main>
      <h1>Under Construction</h1>
      <p>The chat experience is not yet available. Please check back later.</p>
    </main>
  );
}
