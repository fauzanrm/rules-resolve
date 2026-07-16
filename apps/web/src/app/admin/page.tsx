"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, getRoleRoute } from "@/lib/auth";
import { get, postForm } from "@/lib/api";
import Navbar from "@/components/Navbar";
import ChatroomCard, { ChatroomReadiness, ThumbnailResult } from "@/components/ChatroomCard";

interface Chatroom {
  id: number;
  name: string;
  cover_image_url?: string | null;
  has_custom_thumbnail?: boolean;
  published_at?: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [chatrooms, setChatrooms] = useState<Chatroom[]>([]);
  const [readinessMap, setReadinessMap] = useState<Record<number, ChatroomReadiness>>({});
  const [fetchError, setFetchError] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function refreshReadiness() {
    get<ChatroomReadiness[]>("/readiness")
      .then((results) => {
        const map: Record<number, ChatroomReadiness> = {};
        results.forEach((r) => { map[r.chatroom_id] = r; });
        setReadinessMap(map);
      })
      .catch(() => {});
  }

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.role === "user") {
      router.replace(getRoleRoute(session.role));
      return;
    }

    get<Chatroom[]>("/chatrooms/")
      .then((rooms) => {
        setChatrooms(rooms);
        refreshReadiness();
      })
      .catch(() => setFetchError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openAddModal() {
    setNewName("");
    setNewFile(null);
    setCreateError(null);
    setAddModalOpen(true);
  }

  function closeAddModal() {
    if (creating) return;
    setAddModalOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a PDF file.");
      e.target.value = "";
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      alert("File exceeds the 25 MB limit.");
      e.target.value = "";
      return;
    }
    setNewFile(f);
  }

  async function handleCreate() {
    if (!newName.trim() || !newFile || creating) return;
    setCreating(true);
    setCreateError(null);

    const formData = new FormData();
    formData.append("name", newName.trim());
    formData.append("file", newFile);

    try {
      const chatroom = await postForm<Chatroom>("/chatrooms/", formData);
      setChatrooms((prev) => [...prev, chatroom]);
      setAddModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create chatroom.";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  const canSave = newName.trim().length > 0 && newFile !== null && !creating;

  function handleThumbnailChange(chatroomId: number, result: ThumbnailResult) {
    setChatrooms((prev) =>
      prev.map((c) =>
        c.id === chatroomId
          ? { ...c, cover_image_url: result.cover_image_url, has_custom_thumbnail: result.has_custom_thumbnail }
          : c
      )
    );
  }

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
              {chatrooms.map((c) => (
                <ChatroomCard
                  key={c.id}
                  chatroomId={c.id}
                  name={c.name}
                  coverImageUrl={c.cover_image_url}
                  hasCustomThumbnail={c.has_custom_thumbnail}
                  readiness={readinessMap[c.id] ?? null}
                  onThumbnailChange={(result) => handleThumbnailChange(c.id, result)}
                />
              ))}
              <button className="add-chatroom-card" onClick={openAddModal}>
                <span className="add-chatroom-icon">+</span>
                <span className="add-chatroom-label">Add New Chatroom</span>
              </button>
            </div>
          )}
        </section>

      </main>

      {addModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Add New Chatroom</h2>
              <button onClick={closeAddModal} aria-label="Cancel">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label" htmlFor="chatroom-name">Chatroom Name</label>
                <input
                  id="chatroom-name"
                  className="form-input"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Catan"
                  disabled={creating}
                />
              </div>
              <div className="form-field">
                <label className="form-label">PDF</label>
                <label className="file-label" htmlFor="chatroom-pdf">Choose PDF</label>
                <input
                  id="chatroom-pdf"
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  disabled={creating}
                />
                {newFile && (
                  <span className="staged-file-name">{newFile.name}</span>
                )}
              </div>
              {createError && <p className="commit-error">{createError}</p>}
            </div>
            <div className="modal-footer">
              <button className="modal-cancel-btn" onClick={closeAddModal} disabled={creating}>
                Cancel
              </button>
              <button className="modal-confirm-btn" onClick={handleCreate} disabled={!canSave}>
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
