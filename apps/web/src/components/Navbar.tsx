"use client";

import { useRouter } from "next/navigation";
import { clearSession } from "@/lib/auth";

export default function Navbar() {
  const router = useRouter();

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="navbar-title">RuleResolve</span>
        <span className="admin-badge">Admin</span>
      </div>
      <button className="logout-btn" onClick={handleLogout}>
        Log out
      </button>
    </nav>
  );
}
