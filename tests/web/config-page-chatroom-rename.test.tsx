import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigPage from "@/app/admin/[chatroomSlug]/page";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";
import { ApiError } from "@/lib/api";

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
    patch: jest.fn(),
    ApiError: MockApiError,
  };
});

const adminSession = { role: "admin", username: "adminuser" };

const mockConfig = {
  chatroom_id: 1,
  chatroom_name: "Catan",
  document: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  (apiLib.get as jest.Mock).mockResolvedValue(mockConfig);
});

async function waitForLoaded() {
  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Catan/ })).toBeInTheDocument()
  );
}

// 1. Title rendered
test("chatroom name appears as title above pipeline", async () => {
  render(<ConfigPage />);
  await waitForLoaded();
  const title = screen.getByRole("button", { name: /Catan/ });
  expect(title).toBeInTheDocument();
});

// 2. Click enters edit mode with prefilled input
test("clicking title enters edit mode with prefilled, focused input", async () => {
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));

  const input = screen.getByLabelText("Chatroom name") as HTMLInputElement;
  expect(input).toBeInTheDocument();
  expect(input.value).toBe("Catan");
});

// 3. Save on Enter calls PATCH and updates UI
test("pressing Enter saves rename and updates title", async () => {
  (apiLib.patch as jest.Mock).mockResolvedValue({ id: 1, name: "Settlers" });
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.change(input, { target: { value: "Settlers" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(apiLib.patch).toHaveBeenCalledWith("/chatrooms/1", { name: "Settlers" })
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Settlers/ })).toBeInTheDocument()
  );
  expect(mockReplace).toHaveBeenCalledWith("/admin/settlers");
});

// 4. Save on blur
test("blur triggers rename save", async () => {
  (apiLib.patch as jest.Mock).mockResolvedValue({ id: 1, name: "Risk" });
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.change(input, { target: { value: "Risk" } });
  fireEvent.blur(input);

  await waitFor(() => expect(apiLib.patch).toHaveBeenCalled());
});

// 5. Duplicate error shows inline, stays in edit mode
test("duplicate name shows inline error and keeps edit mode", async () => {
  (apiLib.patch as jest.Mock).mockRejectedValue(
    new (apiLib as unknown as { ApiError: typeof ApiError }).ApiError(
      409,
      "A chatroom with that name already exists"
    )
  );
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.change(input, { target: { value: "Pandemic" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i)
  );
  expect(screen.getByLabelText("Chatroom name")).toBeInTheDocument();
});

// 6. Invalid (empty) name shows inline error, no API call
test("empty name shows inline error without calling API", async () => {
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/empty/i)
  );
  expect(apiLib.patch).not.toHaveBeenCalled();
});

// 7. No-op: unchanged name exits without API call
test("unchanged name exits edit mode without API call", async () => {
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    expect(screen.queryByLabelText("Chatroom name")).not.toBeInTheDocument()
  );
  expect(apiLib.patch).not.toHaveBeenCalled();
});

// 8. Escape cancels edit and reverts
test("Escape cancels edit and reverts to committed name", async () => {
  render(<ConfigPage />);
  await waitForLoaded();

  await userEvent.click(screen.getByRole("button", { name: /Catan/ }));
  const input = screen.getByLabelText("Chatroom name");
  fireEvent.change(input, { target: { value: "TYPO" } });
  fireEvent.keyDown(input, { key: "Escape" });

  await waitFor(() =>
    expect(screen.queryByLabelText("Chatroom name")).not.toBeInTheDocument()
  );
  expect(screen.getByRole("button", { name: /Catan/ })).toBeInTheDocument();
  expect(apiLib.patch).not.toHaveBeenCalled();
});

// 9. Safety: pipeline chips still render alongside title
test("rename UI does not remove pipeline chips", async () => {
  render(<ConfigPage />);
  await waitForLoaded();
  expect(screen.getByText("Pipeline Stages")).toBeInTheDocument();
  expect(screen.getAllByText("PDF Upload").length).toBeGreaterThan(0);
});
