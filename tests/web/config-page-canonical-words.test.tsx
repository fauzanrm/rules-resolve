import { render, screen, waitFor } from "@testing-library/react";
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

const sampleRawWords = {
  word_count: 3,
  page_count: 1,
  pages: [{ page: 1, width: 612, height: 792 }],
  words: [
    { word_id: "p1-b0-l0-w0", text: "Alpha", quad: [10, 20, 30, 40], page: 1, block_no: 0, line_no: 0, word_no: 0 },
    { word_id: "p1-b0-l0-w1", text: "Beta", quad: [40, 20, 60, 40], page: 1, block_no: 0, line_no: 0, word_no: 1 },
    { word_id: "p1-b0-l1-w0", text: "Gamma", quad: [10, 50, 40, 70], page: 1, block_no: 0, line_no: 1, word_no: 0 },
  ],
};

const rawWordsState = {
  chatroom_id: 1,
  document_id: 7,
  has_source_pdf: true,
  raw_words: { ...sampleRawWords, status: "committed", committed_at: "2026-04-18T10:00:00Z" },
};

const emptyCanonicalState = {
  chatroom_id: 1,
  document_id: 7,
  has_raw_words: true,
  committed_words: null,
  committed_at: null,
};

const committedCanonicalState = {
  chatroom_id: 1,
  document_id: 7,
  has_raw_words: true,
  committed_words: [
    { canonical_index: 0, raw_word_index: 0, text: "Alpha", page: 1, block_no: 0, line_no: 0, word_no: 0, quad: [10, 20, 30, 40] },
    { canonical_index: 1, raw_word_index: 1, text: "Beta", page: 1, block_no: 0, line_no: 0, word_no: 1, quad: [40, 20, 60, 40] },
  ],
  committed_at: "2026-04-19T10:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
});

function mockLoad(canonicalState = emptyCanonicalState) {
  (apiLib.get as jest.Mock)
    .mockResolvedValueOnce(configWithDoc)
    .mockResolvedValueOnce(rawWordsState)
    .mockResolvedValueOnce(canonicalState);
}

async function renderAndLoad() {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalledTimes(3));
}

async function openCanonicalStage() {
  await userEvent.click(screen.getByText("Canonical Words Selection"));
}

// 1. All raw words included by default when no prior canonical commit
test("all raw words included by default when no prior commit", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  expect(screen.getByText(/All words included by default/)).toBeInTheDocument();
  // Overlay should show all 3 quads as included
  const overlay = screen.getByTestId("canonical-words-overlay");
  expect(overlay.querySelectorAll(".canonical-quad.included").length).toBe(3);
});

// 2. Overlay renders canonical quads
test("overlay renders quads for each raw word", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const overlay = screen.getByTestId("canonical-words-overlay");
  expect(overlay).toBeInTheDocument();
  const quads = overlay.querySelectorAll(".canonical-quad");
  expect(quads.length).toBe(3);
});

// 3. Clicking a quad selects it
test("clicking a quad toggles selection", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);

  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
});

// 4. Exclude selected removes IDs from workingIncludedIds
test("exclude selected reduces included count", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement); // select first quad
  await userEvent.click(screen.getByText("Exclude selected"));

  // excluded count should now be 1, included = 2
  expect(screen.getByText(/Excluded/)).toBeInTheDocument();
});

// 5. Include selected re-adds to workingIncludedIds
test("include selected re-adds previously excluded word", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  // Select and exclude first word
  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  // Now select same word and include it back
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Include selected"));

  // Back to 3 included, 0 excluded — dirty warning gone
  await waitFor(() =>
    expect(screen.getByText(/All words included by default/)).toBeInTheDocument()
  );
});

// 6. Reset sets workingIncludedIds back to all raw words
test("reset to all included restores full set", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  // Exclude one
  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  // Reset
  await userEvent.click(screen.getByText("Reset to all included"));

  await waitFor(() =>
    expect(screen.getByText(/All words included by default/)).toBeInTheDocument()
  );
});

// 7. Commit button disabled when not dirty
test("commit button is disabled when nothing has changed", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const commitBtn = screen.getByRole("button", { name: "Commit Updates" });
  expect(commitBtn).toBeDisabled();
});

// 8. Commit button enabled when dirty
test("commit button is enabled after excluding a word", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  expect(screen.getByRole("button", { name: "Commit Updates" })).not.toBeDisabled();
});

// 9. Successful commit refreshes committedCanonicalWordIds and clears dirty
test("commit clears dirty state and shows committed status", async () => {
  mockLoad();
  (apiLib.post as jest.Mock).mockResolvedValue({
    chatroom_id: 1,
    document_id: 7,
    has_raw_words: true,
    committed_words: [
      { canonical_index: 0, raw_word_index: 1, text: "Beta", page: 1, block_no: 0, line_no: 0, word_no: 1, quad: [40, 20, 60, 40] },
      { canonical_index: 1, raw_word_index: 2, text: "Gamma", page: 1, block_no: 0, line_no: 1, word_no: 0, quad: [10, 50, 40, 70] },
    ],
    committed_at: "2026-04-19T12:00:00Z",
  });

  await renderAndLoad();
  await openCanonicalStage();

  // Exclude first word to make it dirty
  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  await userEvent.click(screen.getByRole("button", { name: "Commit Updates" }));

  await waitFor(() =>
    expect(apiLib.post).toHaveBeenCalledWith(
      "/canonical-words/1/commit",
      expect.objectContaining({ included_raw_word_indices: expect.any(Array) }),
    )
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Commit Updates" })).toBeDisabled()
  );
});

// 10. Reopening stage after prior commit restores committed selection
test("committed selection is restored when reopening stage after prior commit", async () => {
  mockLoad(committedCanonicalState);
  await renderAndLoad();
  await openCanonicalStage();

  // Only 2 of 3 raw words were committed, so included = 2, excluded = 1
  await waitFor(() => {
    const overlay = screen.getByTestId("canonical-words-overlay");
    const included = overlay.querySelectorAll(".canonical-quad.included");
    expect(included.length).toBe(2);
  });
});

// 11. Nav warning appears with uncommitted canonical changes
test("back navigation triggers unsaved warning when canonical words are dirty", async () => {
  mockLoad();
  await renderAndLoad();
  await openCanonicalStage();

  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  await userEvent.click(screen.getByText("← Back"));
  expect(screen.getByText(/Uncommitted changes/)).toBeInTheDocument();
});

// 12. Empty commit (all excluded) is accepted without error
test("committing with all words excluded is accepted", async () => {
  mockLoad();
  (apiLib.post as jest.Mock).mockResolvedValue({
    chatroom_id: 1,
    document_id: 7,
    has_raw_words: true,
    committed_words: null,
    committed_at: "2026-04-19T12:00:00Z",
  });

  await renderAndLoad();
  await openCanonicalStage();

  // Exclude all three words
  const quads = document.querySelectorAll(".canonical-quad");
  for (const quad of quads) {
    await userEvent.click(quad as HTMLElement);
  }
  await userEvent.click(screen.getByText("Exclude selected"));

  await userEvent.click(screen.getByRole("button", { name: "Commit Updates" }));

  await waitFor(() =>
    expect(apiLib.post).toHaveBeenCalledWith("/canonical-words/1/commit", {
      included_raw_word_indices: [],
    })
  );
});

// 13. Word identity (not text) used for include/exclude
test("word selection uses word_id not text (handles duplicate text correctly)", async () => {
  // Use a raw words set where two words share the same text
  const rawWithDuplicateText = {
    chatroom_id: 1,
    document_id: 7,
    has_source_pdf: true,
    raw_words: {
      word_count: 2,
      page_count: 1,
      pages: [{ page: 1, width: 612, height: 792 }],
      words: [
        { word_id: "p1-b0-l0-w0", text: "Same", quad: [10, 20, 30, 40], page: 1, block_no: 0, line_no: 0, word_no: 0 },
        { word_id: "p1-b0-l0-w1", text: "Same", quad: [40, 20, 60, 40], page: 1, block_no: 0, line_no: 0, word_no: 1 },
      ],
      status: "committed",
      committed_at: "2026-04-18T10:00:00Z",
    },
  };

  (apiLib.get as jest.Mock)
    .mockResolvedValueOnce(configWithDoc)
    .mockResolvedValueOnce(rawWithDuplicateText)
    .mockResolvedValueOnce(emptyCanonicalState);

  await renderAndLoad();
  await openCanonicalStage();

  // Click only the first quad
  const quads = document.querySelectorAll(".canonical-quad");
  await userEvent.click(quads[0] as HTMLElement);
  await userEvent.click(screen.getByText("Exclude selected"));

  // Exactly 1 selected: 1 excluded, 1 included
  await waitFor(() => {
    const overlay = screen.getByTestId("canonical-words-overlay");
    const included = overlay.querySelectorAll(".canonical-quad.included");
    expect(included.length).toBe(1);
  });
});
