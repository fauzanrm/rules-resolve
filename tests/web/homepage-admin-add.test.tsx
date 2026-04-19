import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

const newChatroom = {
  id: 42,
  name: "Catan",
  cover_image_url: "https://example.com/cover.webp",
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  (apiLib.get as jest.Mock).mockResolvedValue([]);
});

// 1. Add-new card renders on homepage
test("add new chatroom card appears on homepage", async () => {
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  expect(screen.getByText("Add New Chatroom")).toBeInTheDocument();
});

// 2. Clicking add-new card opens modal
test("clicking add new chatroom card opens modal", async () => {
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  await userEvent.click(screen.getByText("Add New Chatroom"));

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Chatroom Name")).toBeInTheDocument();
});

// 3. Save blocked without name
test("create button is disabled when name is empty", async () => {
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  await userEvent.click(screen.getByText("Add New Chatroom"));

  const file = new File(["pdf"], "rules.pdf", { type: "application/pdf" });
  fireEvent.change(document.getElementById("chatroom-pdf") as HTMLInputElement, {
    target: { files: [file] },
  });

  expect(screen.getByText("Create")).toBeDisabled();
});

// 4. Save blocked without file
test("create button is disabled when no file is selected", async () => {
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  await userEvent.click(screen.getByText("Add New Chatroom"));

  await userEvent.type(screen.getByLabelText("Chatroom Name"), "Catan");

  expect(screen.getByText("Create")).toBeDisabled();
});

// 5. Non-PDF rejected client-side
test("non-PDF file triggers alert and is not staged", async () => {
  const alertMock = jest.spyOn(window, "alert").mockImplementation(() => {});
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  await userEvent.click(screen.getByText("Add New Chatroom"));

  const file = new File(["text"], "notes.txt", { type: "text/plain" });
  fireEvent.change(document.getElementById("chatroom-pdf") as HTMLInputElement, {
    target: { files: [file] },
  });

  expect(alertMock).toHaveBeenCalledWith("Please select a PDF file.");
  expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  alertMock.mockRestore();
});

// 6. Success path — chatroom appended, modal closes
test("successful create appends new chatroom and closes modal", async () => {
  (apiLib.postForm as jest.Mock).mockResolvedValue(newChatroom);
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  await userEvent.click(screen.getByText("Add New Chatroom"));

  fireEvent.change(screen.getByLabelText("Chatroom Name"), { target: { value: "Catan" } });

  const file = new File(["pdf"], "catan.pdf", { type: "application/pdf" });
  fireEvent.change(document.getElementById("chatroom-pdf") as HTMLInputElement, {
    target: { files: [file] },
  });

  fireEvent.click(screen.getByText("Create"));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText("Catan").length).toBeGreaterThan(0));
});

// 7. postForm called with correct fields
test("postForm is called with name and file in FormData", async () => {
  (apiLib.postForm as jest.Mock).mockResolvedValue(newChatroom);
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  await userEvent.click(screen.getByText("Add New Chatroom"));

  fireEvent.change(screen.getByLabelText("Chatroom Name"), { target: { value: "Catan" } });

  const file = new File(["pdf"], "catan.pdf", { type: "application/pdf" });
  fireEvent.change(document.getElementById("chatroom-pdf") as HTMLInputElement, {
    target: { files: [file] },
  });

  fireEvent.click(screen.getByText("Create"));

  await waitFor(() => expect(apiLib.postForm).toHaveBeenCalled());
  const [url, formData] = (apiLib.postForm as jest.Mock).mock.calls[0];
  expect(url).toBe("/chatrooms/");
  expect(formData.get("name")).toBe("Catan");
  expect(formData.get("file")).toBe(file);
});

// 8. Failure shows inline error, modal stays open
test("create failure shows inline error and keeps modal open", async () => {
  (apiLib.postForm as jest.Mock).mockRejectedValue(new Error("A chatroom with that name already exists"));
  render(<AdminPage />);
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());

  await userEvent.click(screen.getByText("Add New Chatroom"));

  fireEvent.change(screen.getByLabelText("Chatroom Name"), { target: { value: "Catan" } });

  const file = new File(["pdf"], "catan.pdf", { type: "application/pdf" });
  fireEvent.change(document.getElementById("chatroom-pdf") as HTMLInputElement, {
    target: { files: [file] },
  });

  fireEvent.click(screen.getByText("Create"));

  await waitFor(() =>
    expect(screen.getByText("A chatroom with that name already exists")).toBeInTheDocument()
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
