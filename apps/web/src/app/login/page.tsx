"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import TermsModal from "@/components/TermsModal";
import Toast from "@/components/Toast";
import { getSession, setSession, getRoleRoute } from "@/lib/auth";
import { post, ApiError } from "@/lib/api";

interface LoginResponse {
  role: "admin" | "user";
  username: string;
}

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session) {
      router.replace(getRoleRoute(session.role));
    }
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!termsChecked || submitting) return;

    if (!username.trim() || !password.trim()) {
      setErrorMessage("Please enter your username and password.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const data = await post<LoginResponse>("/auth/login", { username, password });
      setSession(data.role, data.username);
      setShowSuccessToast(true);
      setTimeout(() => {
        router.push(getRoleRoute(data.role));
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErrorMessage("Invalid username or password.");
      } else {
        setErrorMessage("Something went wrong. Please try again.");
      }
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-container">
        <div className="login-title">
          <h1>RuleResolve Beta</h1>
          <p>
            Thank you for participating in our beta. Sign in with your credentials and you can
            start asking questions about the rules of your favorite board games
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={submitting}
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
            />
          </div>

          <div className="terms-row">
            <input
              id="terms"
              type="checkbox"
              checked={termsChecked}
              onChange={(e) => setTermsChecked(e.target.checked)}
            />
            <label htmlFor="terms">
              I agree to the{" "}
              <button type="button" className="terms-link" onClick={() => setTermsOpen(true)}>
                Terms and Conditions
              </button>
            </label>
          </div>

          {errorMessage && <p className="error-message">{errorMessage}</p>}

          <button
            type="submit"
            className="sign-in-button"
            disabled={!termsChecked || submitting}
          >
            Sign In
          </button>
        </form>
      </div>

      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <Toast
        message="Login successful. Redirecting..."
        type="success"
        visible={showSuccessToast}
      />
    </main>
  );
}
