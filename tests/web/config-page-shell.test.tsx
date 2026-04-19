import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigPage from "@/app/admin/[chatroomSlug]/page";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ chatroomSlug: "lifeboat" }),
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

const mockConfigNoDoc = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  document: null,
};

const mockConfigWithDoc = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  document: {
    id: 1,
    file_name: "catan_rules.pdf",
    file_size: 1024000,
    page_count: 42,
    last_updated_at: "2026-04-17T10:00:00Z",
    pdf_url: "https://example.com/catan.pdf",
    cover_url: "https://example.com/cover.webp",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  (apiLib.get as jest.Mock).mockResolvedValue(mockConfigNoDoc);
});

// 1. Renders three panels
test("renders pdf panel, stage panel, and action panel", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  expect(screen.getByText("Pipeline Stages")).toBeInTheDocument();
  expect(document.querySelector(".action-panel")).toBeInTheDocument();
  expect(screen.getByText("Commit Updates")).toBeInTheDocument();
});

// 2. Stage panel: PDF Upload active, others disabled
test("stage panel shows PDF Upload active and others disabled", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  const pdfChip = document.querySelector(".stage-chip.chip-active");
  expect(pdfChip).toBeInTheDocument();
  const rawWordsChip = screen.getByText("Raw Words Detection").closest("li");
  expect(rawWordsChip).toHaveClass("chip-disabled");
});

// 3. Empty state when no committed doc
test("shows empty state when no document committed", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  expect(screen.getByText("No PDF committed yet")).toBeInTheDocument();
  expect(screen.queryByRole("embed")).not.toBeInTheDocument();
});

// 4. Uploading a file shows file info
test("selecting a PDF shows file name and size in action panel", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  expect(screen.getByText("rules.pdf")).toBeInTheDocument();
});

// 5. Commit button disabled when no file staged
test("commit button is disabled when no file is staged", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  expect(screen.getByText("Commit Updates")).toBeDisabled();
});

// 6. Commit confirmation modal opens on click
test("clicking commit opens confirmation modal", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  await userEvent.click(screen.getByText("Commit Updates"));
  expect(screen.getByText("Commit PDF?")).toBeInTheDocument();
  expect(screen.getByText(/overwrite any existing PDF/i)).toBeInTheDocument();
});

// 7. Successful commit updates chip to Committed
test("successful commit updates chip status and shows metadata", async () => {
  (apiLib.postForm as jest.Mock).mockResolvedValue(mockConfigWithDoc.document);
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "catan_rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  await userEvent.click(screen.getByText("Commit Updates"));
  await userEvent.click(screen.getByText("Commit"));

  await waitFor(() => expect(screen.getByText("Committed")).toBeInTheDocument());
  expect(screen.getByText(/42 pages/i)).toBeInTheDocument();
});

// 8. PDF viewer renders after commit
test("pdf viewer embed is present after committed doc loaded", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue(mockConfigWithDoc);
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  const embed = document.querySelector("embed");
  expect(embed).toBeInTheDocument();
  expect(embed?.getAttribute("src")).toBe("https://example.com/catan.pdf");
});

// 9. Dirty warning appears when navigating away with staged file
test("back button shows dirty warning when file is staged", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  await userEvent.click(screen.getByText("← Back"));
  expect(screen.getByText("Uncommitted changes")).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});

// 10. No warning when nothing is staged
test("back button navigates immediately when nothing is staged", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  await userEvent.click(screen.getByText("← Back"));
  expect(mockPush).toHaveBeenCalledWith("/admin");
});

// 11. Stay option keeps user on page
test("choosing Stay in dirty warning keeps user on the page", async () => {
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  await userEvent.click(screen.getByText("← Back"));
  await userEvent.click(screen.getByText("Stay"));

  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.queryByText("Uncommitted changes")).not.toBeInTheDocument();
});

// 12. Commit error displays inline
test("commit failure shows inline error message", async () => {
  (apiLib.postForm as jest.Mock).mockRejectedValue(new Error("Upload failed"));
  render(<ConfigPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  const input = document.getElementById("pdf-upload") as HTMLInputElement;
  const file = new File(["pdf content"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  await userEvent.click(screen.getByText("Commit Updates"));
  await userEvent.click(screen.getByText("Commit"));

  await waitFor(() => expect(screen.getByText("Upload failed")).toBeInTheDocument());
});
