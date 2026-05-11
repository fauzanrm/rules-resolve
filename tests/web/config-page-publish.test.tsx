import { render, screen, waitFor, within } from "@testing-library/react";
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

let uuidCounter = 0;
beforeAll(() => {
  Object.defineProperty(global, "crypto", {
    value: { randomUUID: () => `test-uuid-${++uuidCounter}` },
    configurable: true,
  });
});

const configWithDoc = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  published_at: null,
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

const rawWordsState = {
  chatroom_id: 1,
  document_id: 7,
  has_source_pdf: true,
  raw_words: {
    word_count: 2,
    page_count: 1,
    pages: [{ page: 1, width: 612, height: 792 }],
    words: [
      { word_id: "p1-b0-l0-w0", text: "Alpha", quad: [10, 20, 30, 40], page: 1, block_no: 0, line_no: 0, word_no: 0 },
    ],
    status: "committed",
    committed_at: "2026-04-18T10:00:00Z",
  },
};

const committedCanonicalState = {
  chatroom_id: 1,
  document_id: 7,
  has_raw_words: true,
  committed_words: [
    { canonical_index: 0, raw_word_index: 0, text: "Alpha", page: 1, block_no: 0, line_no: 0, word_no: 0, quad: [10, 20, 30, 40] },
  ],
  committed_at: "2026-04-19T10:00:00Z",
};

const emptyCanonicalState = {
  chatroom_id: 1,
  document_id: 7,
  has_raw_words: true,
  committed_words: null,
  committed_at: null,
};

const committedNodesState = {
  chatroom_id: 1,
  document_id: 7,
  has_canonical_words: true,
  committed_nodes: [
    { node_type: "h1", label: "Setup", start_canonical_index: 0, end_canonical_index: 0 },
  ],
};

const emptyNodesState = {
  chatroom_id: 1,
  document_id: 7,
  has_canonical_words: true,
  committed_nodes: null,
};

const committedChunksState = {
  chatroom_id: 1,
  document_id: 7,
  has_nodes: true,
  committed_chunks: [
    { chunk_index: 0, assigned_node_id: null, start_canonical_index: 0, end_canonical_index: 0, text: "Alpha" },
  ],
};

const emptyChunksState = {
  chatroom_id: 1,
  document_id: 7,
  has_nodes: false,
  committed_chunks: null,
};

const completeEmbeddingsState = {
  chatroom_id: 1,
  document_id: 7,
  has_committed_chunks: true,
  committed_chunk_count: 1,
  stored_embedding_count: 1,
  missing_count: 0,
};

const emptyEmbeddingsState = {
  chatroom_id: 1,
  document_id: null,
  has_committed_chunks: false,
  committed_chunk_count: 0,
  stored_embedding_count: 0,
  missing_count: 0,
};

function mockAllStagesComplete() {
  (apiLib.get as jest.Mock)
    .mockResolvedValueOnce(configWithDoc)
    .mockResolvedValueOnce(rawWordsState)
    .mockResolvedValueOnce(committedCanonicalState)
    .mockResolvedValueOnce(committedNodesState)
    .mockResolvedValueOnce(committedChunksState)
    .mockResolvedValueOnce(completeEmbeddingsState);
}

function mockIncompleteStages() {
  (apiLib.get as jest.Mock)
    .mockResolvedValueOnce(configWithDoc)
    .mockResolvedValueOnce(rawWordsState)
    .mockResolvedValueOnce(emptyCanonicalState)
    .mockResolvedValueOnce(emptyNodesState)
    .mockResolvedValueOnce(emptyChunksState)
    .mockResolvedValueOnce(emptyEmbeddingsState);
}

async function renderAndLoad() {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalledTimes(6));
}

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
});

// 1. Publish button renders
test("Publish button renders on config page", async () => {
  mockIncompleteStages();
  await renderAndLoad();
  expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
});

// 2. Publish button disabled when stages incomplete
test("Publish button is disabled when stages are incomplete", async () => {
  mockIncompleteStages();
  await renderAndLoad();
  expect(screen.getByRole("button", { name: /^publish$/i })).toBeDisabled();
});

// 3. Blocking hint shown when stages incomplete
test("shows blocking stages hint when publish is blocked", async () => {
  mockIncompleteStages();
  await renderAndLoad();
  await waitFor(() => {
    expect(screen.getByText(/needs:/i)).toBeInTheDocument();
  });
});

// 4. Publish button enabled when all 6 stages complete
test("Publish button is enabled when all stages are complete", async () => {
  mockAllStagesComplete();
  await renderAndLoad();
  expect(screen.getByRole("button", { name: /^publish$/i })).not.toBeDisabled();
});

// 5. Clicking publish opens confirmation modal
test("clicking Publish opens confirmation modal", async () => {
  const user = userEvent.setup();
  mockAllStagesComplete();
  await renderAndLoad();
  await user.click(screen.getByRole("button", { name: /^publish$/i }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Publish Chatroom?")).toBeInTheDocument();
});

// 6. Confirming publish calls POST /chatrooms/{id}/publish
test("confirming publish modal calls POST publish endpoint", async () => {
  const user = userEvent.setup();
  (apiLib.post as jest.Mock).mockResolvedValue({ id: 1, name: "Catan", published_at: "2026-04-26T10:00:00Z" });
  mockAllStagesComplete();
  await renderAndLoad();
  await user.click(screen.getByRole("button", { name: /^publish$/i }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^publish$/i }));
  await waitFor(() => {
    expect(apiLib.post).toHaveBeenCalledWith("/chatrooms/1/publish", {});
  });
});

// 7. Published badge appears after successful publish
test("Published badge appears on config page after publishing", async () => {
  const user = userEvent.setup();
  (apiLib.post as jest.Mock).mockResolvedValue({ id: 1, name: "Catan", published_at: "2026-04-26T10:00:00Z" });
  mockAllStagesComplete();
  await renderAndLoad();
  await user.click(screen.getByRole("button", { name: /^publish$/i }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^publish$/i }));
  await waitFor(() => {
    expect(screen.getByText("Published")).toBeInTheDocument();
  });
});

// 8. Ask placeholder page renders coming soon
test("Ask page renders coming soon message and back button", async () => {
  const AskPage = (await import("@/app/admin/[chatroomSlug]/ask/page")).default;
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  render(<AskPage />);
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /back to chatrooms/i })).toBeInTheDocument();
});
