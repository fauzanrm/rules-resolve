import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockParams = { chatroomSlug: "catan" };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => mockParams,
}));

jest.mock("@/lib/auth", () => ({
  getSession: jest.fn(),
  clearSession: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

const adminSession = { role: "admin", username: "adminuser" };

const publishedPageData = {
  chatroom_id: 5,
  chatroom_name: "Catan",
  published_at: "2025-01-01T10:00:00Z",
  document: {
    id: 10,
    file_name: "catan.pdf",
    page_count: 50,
    pdf_url: "https://example.com/catan.pdf",
  },
};

const unpublishedPageData = {
  chatroom_id: 5,
  chatroom_name: "Catan",
  published_at: null,
  document: {
    id: 10,
    file_name: "catan.pdf",
    page_count: 50,
    pdf_url: null,
  },
};

const sampleCitation = {
  index: 1,
  document_id: 10,
  chunk_id: 1,
  chunk_index: 0,
  cited_text: "Players take turns rolling dice",
  page: 3,
  highlight_mode: "word_span" as const,
  words: [
    { canonical_index: 0, text: "Players", quad: [10, 20, 50, 30] as [number, number, number, number], page: 3 },
  ],
  start_canonical_index: 0,
  end_canonical_index: 9,
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
});

// ── 1. Ask button enabled for published chatroom ──────────────────────────────

test("Ask button is enabled when chatroom is_ask_ready", () => {
  const readiness = {
    chatroom_id: 1,
    published_at: "2025-01-01T10:00:00Z",
    is_ask_ready: true,
    stages: {
      pdf: { complete: true, stale: false, committed_at: null },
      raw_words: { complete: true, stale: false, committed_at: null },
      canonical_words: { complete: true, stale: false, committed_at: null },
      nodes: { complete: true, stale: false, committed_at: null },
      chunks: { complete: true, stale: false, committed_at: null },
      embeddings: { complete: true, stale: false, committed_at: null },
    },
  };

  const ChatroomCard = require("@/components/ChatroomCard").default;
  render(
    <ChatroomCard
      chatroomId={1}
      name="Catan"
      coverImageUrl={null}
      readiness={readiness}
    />
  );

  const askBtn = screen.getByRole("button", { name: /ask/i });
  expect(askBtn).not.toBeDisabled();
});

// ── 2. Ask button disabled when not ready ────────────────────────────────────

test("Ask button is disabled when chatroom is not ask_ready", () => {
  const readiness = {
    chatroom_id: 1,
    published_at: null,
    is_ask_ready: false,
    stages: {
      pdf: { complete: false, stale: false, committed_at: null },
      raw_words: { complete: false, stale: false, committed_at: null },
      canonical_words: { complete: false, stale: false, committed_at: null },
      nodes: { complete: false, stale: false, committed_at: null },
      chunks: { complete: false, stale: false, committed_at: null },
      embeddings: { complete: false, stale: false, committed_at: null },
    },
  };

  const ChatroomCard = require("@/components/ChatroomCard").default;
  render(
    <ChatroomCard
      chatroomId={1}
      name="Catan"
      coverImageUrl={null}
      readiness={readiness}
    />
  );

  const askBtn = screen.getByRole("button", { name: /ask/i });
  expect(askBtn).toBeDisabled();
});

// ── 3. Unpublished chatroom shows unavailable state ───────────────────────────

test("Ask page shows unavailable state for unpublished chatroom", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(unpublishedPageData);

  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => {
    expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
  });
  expect(screen.queryByRole("log")).not.toBeInTheDocument();
});

// ── 4. Published Ask page renders PDF viewer and chat panel ──────────────────

test("Ask page renders PDF viewer and chat panel for published chatroom", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);

  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => {
    expect(screen.getByRole("log")).toBeInTheDocument();
  });
  expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
});

// ── 5. Submitting question appends user message and triggers POST ─────────────

test("Submitting valid question calls POST /ask and shows user message", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);
  (apiLib.post as jest.Mock).mockResolvedValue({ answer: "You roll two dice.", citations: [] });

  const user = userEvent.setup();
  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

  await user.type(screen.getByPlaceholderText(/ask a question/i), "How many dice do I roll?");
  await user.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => {
    expect(apiLib.post).toHaveBeenCalledWith(
      "/ask/catan",
      expect.objectContaining({ question: "How many dice do I roll?" })
    );
  });

  expect(screen.getByText("How many dice do I roll?")).toBeInTheDocument();
});

// ── 6. Empty input cannot be submitted ───────────────────────────────────────

test("Empty input cannot be submitted", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);

  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => screen.getByRole("button", { name: /send/i }));

  const sendBtn = screen.getByRole("button", { name: /send/i });
  expect(sendBtn).toBeDisabled();
});

// ── 7. Send button disabled while loading ────────────────────────────────────

test("Send button is disabled while a response is loading", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);
  let resolvePost: (v: unknown) => void = () => {};
  (apiLib.post as jest.Mock).mockReturnValue(new Promise((res) => { resolvePost = res; }));

  const user = userEvent.setup();
  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

  await user.type(screen.getByPlaceholderText(/ask a question/i), "Question?");
  await user.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /…/i })).toBeDisabled();
  });

  // Cleanup
  act(() => { resolvePost({ answer: "Answer", citations: [] }); });
});

// ── 8. Successful response shows assistant message with citations ─────────────

test("Successful response shows assistant message with citation chips", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);
  (apiLib.post as jest.Mock).mockResolvedValue({
    answer: "Players roll two dice [1] on their turn.",
    citations: [sampleCitation],
  });

  const user = userEvent.setup();
  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

  await user.type(screen.getByPlaceholderText(/ask a question/i), "How do I roll?");
  await user.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => {
    expect(screen.getByText(/players roll two dice/i)).toBeInTheDocument();
  });

  // Citation chip should appear
  expect(screen.getAllByRole("button", { name: /citation 1/i }).length).toBeGreaterThan(0);
});

// ── 9. Backend failure shows error message ────────────────────────────────────

test("Backend failure shows a retry-safe error message", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(publishedPageData);
  (apiLib.post as jest.Mock).mockRejectedValue(new Error("Network error"));

  const user = userEvent.setup();
  const AskPage = require("@/app/admin/[chatroomSlug]/ask/page").default;
  render(<AskPage />);

  await waitFor(() => screen.getByPlaceholderText(/ask a question/i));

  await user.type(screen.getByPlaceholderText(/ask a question/i), "Question?");
  await user.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => {
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  // Input should be re-enabled so the user can try again
  const input = screen.getByPlaceholderText(/ask a question/i);
  expect(input).not.toBeDisabled();
});
