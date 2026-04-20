import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigPage from "@/app/admin/[chatroomSlug]/page";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ chatroomSlug: "catan" }),
}));

jest.mock("@/lib/auth", () => ({
  getSession: jest.fn(),
  clearSession: jest.fn(),
}));

jest.mock("@/lib/api", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "ApiError";
    }
  }
  return {
    get: jest.fn(),
    postForm: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    ApiError: MockApiError,
  };
});

const adminSession = { role: "admin", username: "adminuser" };

const configNoDoc = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  document: null,
};

const configWithDoc = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  document: {
    id: 7,
    file_name: "catan.pdf",
    file_size: 1024,
    page_count: 1,
    last_updated_at: "2026-04-17T10:00:00Z",
    pdf_url: "https://example.com/catan.pdf",
    cover_url: null,
  },
};

const samplePayload = {
  word_count: 2,
  page_count: 1,
  pages: [{ page: 1, width: 612, height: 792 }],
  words: [
    {
      word_id: "p1-b0-l0-w0",
      text: "Hello",
      quad: [10, 20, 30, 40],
      page: 1,
      block_no: 0,
      line_no: 0,
      word_no: 0,
    },
    {
      word_id: "p1-b0-l0-w1",
      text: "World",
      quad: [40, 20, 60, 40],
      page: 1,
      block_no: 0,
      line_no: 0,
      word_no: 1,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
});

const emptyCanonicalState = {
  chatroom_id: 1,
  document_id: 7,
  has_raw_words: true,
  committed_words: null,
  committed_at: null,
};

function mockInitialLoad(
  { hasPdf, committed }: { hasPdf: boolean; committed?: typeof samplePayload | null } = {
    hasPdf: true,
    committed: null,
  },
) {
  const cfg = hasPdf ? configWithDoc : configNoDoc;
  (apiLib.get as jest.Mock)
    .mockResolvedValueOnce(cfg)
    .mockResolvedValueOnce({
      chatroom_id: 1,
      document_id: 7,
      has_source_pdf: hasPdf,
      raw_words: committed
        ? { ...committed, status: "committed", committed_at: "2026-04-18T10:00:00Z" }
        : null,
    })
    .mockResolvedValueOnce(emptyCanonicalState);
}

async function renderAndLoad() {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalledTimes(3));
}

// 1. Committed raw words load on mount
test("loads committed raw words on page load", async () => {
  mockInitialLoad({ hasPdf: true, committed: samplePayload });
  await renderAndLoad();
  // Select raw-words stage
  await userEvent.click(screen.getByText("Raw Words Detection"));
  expect(screen.getByTestId("raw-words-overlay")).toBeInTheDocument();
});

// 2. Stage disabled when no PDF
test("raw words stage shows helper text when no source PDF", async () => {
  mockInitialLoad({ hasPdf: false });
  await renderAndLoad();
  expect(screen.getByText(/Upload and commit a PDF first/)).toBeInTheDocument();
  // Clicking should not switch the action panel — PDF upload panel remains
  await userEvent.click(screen.getByText("Raw Words Detection"));
  expect(screen.getByRole("heading", { name: "PDF Upload" })).toBeInTheDocument();
  expect(screen.queryByText("Generate Raw Words")).not.toBeInTheDocument();
});

// 3. Generating marks dirty + updates chip status
test("generate produces overlay and sets generated status", async () => {
  mockInitialLoad({ hasPdf: true });
  (apiLib.post as jest.Mock).mockResolvedValue(samplePayload);
  await renderAndLoad();

  await userEvent.click(screen.getByText("Raw Words Detection"));
  await userEvent.click(screen.getByText("Generate Raw Words"));

  await waitFor(() =>
    expect(apiLib.post).toHaveBeenCalledWith("/raw-words/1/generate", {})
  );
  expect(await screen.findByTestId("raw-words-overlay")).toBeInTheDocument();
  expect(screen.getByText(/Generated, not yet committed/)).toBeInTheDocument();
});

// 4. Commit persists and clears dirty
test("commit persists raw words and clears generated state", async () => {
  mockInitialLoad({ hasPdf: true });
  (apiLib.post as jest.Mock)
    .mockResolvedValueOnce(samplePayload) // generate
    .mockResolvedValueOnce({
      ...samplePayload,
      committed_at: "2026-04-19T00:00:00Z",
    });
  await renderAndLoad();

  await userEvent.click(screen.getByText("Raw Words Detection"));
  await userEvent.click(screen.getByText("Generate Raw Words"));
  await screen.findByText(/Generated, not yet committed/);

  await userEvent.click(screen.getByText("Commit Changes"));
  await waitFor(() =>
    expect(apiLib.post).toHaveBeenLastCalledWith("/raw-words/1/commit", {
      payload: samplePayload,
    })
  );
  await waitFor(() =>
    expect(screen.queryByText(/Generated, not yet committed/)).not.toBeInTheDocument()
  );
});

// 5. Overlay renders a quad per word
test("overlay renders a quad per word", async () => {
  mockInitialLoad({ hasPdf: true, committed: samplePayload });
  await renderAndLoad();
  await userEvent.click(screen.getByText("Raw Words Detection"));

  const overlay = screen.getByTestId("raw-words-overlay");
  const quads = overlay.querySelectorAll(".raw-word-quad");
  expect(quads.length).toBe(2);
});

// 6. Hover shows metadata in hover card
test("hovering a quad shows word metadata", async () => {
  mockInitialLoad({ hasPdf: true, committed: samplePayload });
  await renderAndLoad();
  await userEvent.click(screen.getByText("Raw Words Detection"));

  const viewer = document.querySelector(".raw-words-viewer") as HTMLElement;
  fireEvent.mouseMove(viewer, { clientX: 100, clientY: 100 });

  const firstQuad = document.querySelector(".raw-word-quad") as HTMLElement;
  fireEvent.mouseEnter(firstQuad);

  expect(await screen.findByRole("status")).toHaveTextContent("Hello");
});

// 7. Generation error shows inline
test("generation failure shows inline error", async () => {
  mockInitialLoad({ hasPdf: true });
  (apiLib.post as jest.Mock).mockRejectedValue(
    new (apiLib as unknown as { ApiError: new (status: number, msg: string) => Error }).ApiError(
      500,
      "Parse failed"
    )
  );
  await renderAndLoad();

  await userEvent.click(screen.getByText("Raw Words Detection"));
  await userEvent.click(screen.getByText("Generate Raw Words"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Parse failed");
});

// 8. Navigation warning when uncommitted raw words exist
test("back navigation triggers unsaved warning when raw words uncommitted", async () => {
  mockInitialLoad({ hasPdf: true });
  (apiLib.post as jest.Mock).mockResolvedValue(samplePayload);
  await renderAndLoad();

  await userEvent.click(screen.getByText("Raw Words Detection"));
  await userEvent.click(screen.getByText("Generate Raw Words"));
  await screen.findByText(/Generated, not yet committed/);

  await userEvent.click(screen.getByText("← Back"));
  expect(screen.getByText(/Uncommitted changes/)).toBeInTheDocument();
});
