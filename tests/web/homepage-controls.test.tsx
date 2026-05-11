import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminPage from "@/app/admin/page";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@/lib/auth", () => ({
  getSession: jest.fn(),
  clearSession: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  get: jest.fn(),
  postForm: jest.fn(),
}));

const adminSession = { role: "admin", username: "adminuser" };

const greenStage = { complete: true, stale: false, committed_at: "2025-01-01T10:00:00Z" };
const grayStage = { complete: false, stale: false, committed_at: null };
const yellowStage = { complete: false, stale: true, committed_at: "2024-12-31T10:00:00Z" };

const readyReadiness = {
  chatroom_id: 1,
  published_at: "2025-01-02T09:00:00Z",
  is_ask_ready: true,
  stages: {
    pdf: greenStage,
    raw_words: greenStage,
    canonical_words: greenStage,
    nodes: greenStage,
    chunks: greenStage,
    embeddings: greenStage,
  },
};

const notReadyReadiness = {
  chatroom_id: 1,
  published_at: null,
  is_ask_ready: false,
  stages: {
    pdf: greenStage,
    raw_words: grayStage,
    canonical_words: grayStage,
    nodes: grayStage,
    chunks: grayStage,
    embeddings: grayStage,
  },
};

const staleReadiness = {
  chatroom_id: 1,
  published_at: "2025-01-02T09:00:00Z",
  is_ask_ready: false,
  stages: {
    pdf: greenStage,
    raw_words: yellowStage,
    canonical_words: grayStage,
    nodes: grayStage,
    chunks: grayStage,
    embeddings: grayStage,
  },
};

function mockGet(chatrooms: { id: number; name: string }[], readiness: unknown = null) {
  (apiLib.get as jest.Mock).mockImplementation((url: string) => {
    if (url === "/chatrooms/") return Promise.resolve(chatrooms);
    if (url.startsWith("/readiness/")) return Promise.resolve(readiness);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  mockGet([]);
});

// 1. Configure button renders on each card
test("Configure button renders on each chatroom card", async () => {
  mockGet([{ id: 1, name: "Catan" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /configure/i })).toBeInTheDocument();
  });
});

// 2. Configure button navigates to /admin/[slug]
test("Configure button navigates to slug-based config page", async () => {
  const user = userEvent.setup();
  mockGet([{ id: 1, name: "Ticket To Ride" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /configure/i })).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /configure/i }));
  expect(mockPush).toHaveBeenCalledWith("/admin/ticket-to-ride");
});

// 3. Ask button is disabled when is_ask_ready is false
test("Ask button is disabled when chatroom is not ask-ready", async () => {
  mockGet([{ id: 1, name: "Catan" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /ask/i })).toBeDisabled();
});

// 4. Ask button is enabled when is_ask_ready is true
test("Ask button is enabled when chatroom is ask-ready", async () => {
  mockGet([{ id: 1, name: "Catan" }], readyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /ask/i })).not.toBeDisabled();
});

// 5. Clicking enabled Ask navigates to /admin/[slug]/ask
test("clicking enabled Ask button navigates to ask page", async () => {
  const user = userEvent.setup();
  mockGet([{ id: 1, name: "Catan" }], readyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /ask/i }));
  expect(mockPush).toHaveBeenCalledWith("/admin/catan/ask");
});

// 6. Stage indicator renders 6 dots per card
test("stage indicator renders 6 dots per card", async () => {
  mockGet([{ id: 1, name: "Catan" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByLabelText(/pipeline stage status/i)).toBeInTheDocument());
  const indicator = screen.getByLabelText(/pipeline stage status/i);
  const dots = indicator.querySelectorAll(".stage-dot");
  expect(dots).toHaveLength(6);
});

// 7. Green dots for complete stages
test("complete stages render green dots", async () => {
  mockGet([{ id: 1, name: "Catan" }], readyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByLabelText(/pipeline stage status/i)).toBeInTheDocument());
  const indicator = screen.getByLabelText(/pipeline stage status/i);
  const greenDots = indicator.querySelectorAll(".stage-dot--green");
  expect(greenDots).toHaveLength(6);
});

// 8. Yellow dot for stale stage
test("stale stage renders yellow dot", async () => {
  mockGet([{ id: 1, name: "Catan" }], staleReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByLabelText(/pipeline stage status/i)).toBeInTheDocument());
  const indicator = screen.getByLabelText(/pipeline stage status/i);
  expect(indicator.querySelector(".stage-dot--yellow")).toBeInTheDocument();
});

// 9. Gray dot for not-started stage
test("not-started stage renders gray dot", async () => {
  mockGet([{ id: 1, name: "Catan" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByLabelText(/pipeline stage status/i)).toBeInTheDocument());
  const indicator = screen.getByLabelText(/pipeline stage status/i);
  expect(indicator.querySelector(".stage-dot--gray")).toBeInTheDocument();
});

// 10. Published badge visible when is_ask_ready
test("Published badge is visible when chatroom is ask-ready", async () => {
  mockGet([{ id: 1, name: "Catan" }], readyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByText(/published/i)).toBeInTheDocument());
  expect(screen.getByText(/published/i)).toBeInTheDocument();
});

// 11. Published badge hidden when not ask-ready
test("Published badge is hidden when chatroom is not ask-ready", async () => {
  mockGet([{ id: 1, name: "Catan" }], notReadyReadiness);
  render(<AdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /configure/i })).toBeInTheDocument());
  expect(screen.queryByText("Published")).not.toBeInTheDocument();
});
