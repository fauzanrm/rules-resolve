"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clearSession } from "@/lib/auth";

interface NavbarProps {
  onBack?: () => void;
  titleSlot?: ReactNode;
}

export default function Navbar({ onBack, titleSlot }: NavbarProps = {}) {
  const router = useRouter();

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  return (
    <nav className="navbar">
      <div className="navbar-left">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            ← Back
          </button>
        )}
        <div className="navbar-brand">
          <span className="navbar-title">RuleResolve</span>
        </div>
        {titleSlot && <div className="navbar-context">{titleSlot}</div>}
      </div>
      <div className="navbar-right">
        <span className="admin-badge">Admin</span>
        <button className="logout-btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </nav>
  );
}
