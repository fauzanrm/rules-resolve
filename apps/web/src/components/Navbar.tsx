"use client";

import { useRouter } from "next/navigation";
import { clearSession } from "@/lib/auth";

interface NavbarProps {
  onBack?: () => void;
}

export default function Navbar({ onBack }: NavbarProps = {}) {
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
          <span className="admin-badge">Admin</span>
        </div>
      </div>
      <button className="logout-btn" onClick={handleLogout}>
        Log out
      </button>
    </nav>
  );
}
