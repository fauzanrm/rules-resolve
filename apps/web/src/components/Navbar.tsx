"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getSession, Role } from "@/lib/auth";

interface NavbarProps {
  onBack?: () => void;
  titleSlot?: ReactNode;
}

export default function Navbar({ onBack, titleSlot }: NavbarProps = {}) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    setRole(getSession()?.role ?? null);
  }, []);

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
        {role === "admin" && <span className="admin-badge">Admin</span>}
        {role === "user" && <span className="user-badge">User</span>}
        <button className="logout-btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </nav>
  );
}
