import { render, screen, waitFor, within } from "@testing-library/react";
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
}));

const adminSession = { role: "admin", username: "adminuser" };

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(adminSession);
  (apiLib.get as jest.Mock).mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

// 1. Render test
test("renders navbar, hero section, and chatroom area", async () => {
  render(<AdminPage />);

  const nav = screen.getByRole("navigation");
  expect(within(nav).getByText("RuleResolve")).toBeInTheDocument();
  expect(within(nav).getByText("Admin")).toBeInTheDocument();
  expect(within(nav).getByRole("button", { name: /log out/i })).toBeInTheDocument();

  expect(screen.getByRole("heading", { level: 1, name: "RuleResolve" })).toBeInTheDocument();
  expect(screen.getByText(/Don't know the exact rules/)).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getByText("Add New Chatroom")).toBeInTheDocument();
  });
});

// 2. Logout interaction
test("clicking logout clears session and redirects to /login", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);

  await user.click(screen.getByRole("button", { name: /log out/i }));

  expect(authLib.clearSession).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/login");

  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
});

// 3. Chatroom fetch — cards rendered with correct names
test("fetched chatrooms are rendered as cards", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue([
    { id: 1, name: "Catan" },
    { id: 2, name: "Pandemic" },
  ]);

  render(<AdminPage />);

  await waitFor(() => {
    expect(screen.getByText("Catan")).toBeInTheDocument();
    expect(screen.getByText("Pandemic")).toBeInTheDocument();
  });
});

// 4. Add-new card always visible
test("shows add new chatroom card when no chatrooms exist", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue([]);

  render(<AdminPage />);

  await waitFor(() => {
    expect(screen.getByText("Add New Chatroom")).toBeInTheDocument();
  });
});

// 5. Chatroom cards link to their config page
test("chatroom cards link to their slug-based config page", async () => {
  (apiLib.get as jest.Mock).mockResolvedValue([{ id: 1, name: "Chess" }]);

  render(<AdminPage />);

  await waitFor(() => {
    expect(screen.getByText("Chess")).toBeInTheDocument();
  });

  const card = screen.getByText("Chess").closest(".chatroom-card");
  expect(card).toBeInTheDocument();
  expect(card?.tagName.toLowerCase()).toBe("a");
  expect(card).toHaveAttribute("href", "/admin/chess");
});

// 6. Partial visibility — chatroom section present in document on initial render
test("chatroom section is present in the document on initial render", async () => {
  render(<AdminPage />);

  expect(document.querySelector(".chatroom-section")).toBeInTheDocument();

  await waitFor(() => expect(apiLib.get).toHaveBeenCalled());
});

// 7. Error state
test("shows error message when chatroom fetch fails", async () => {
  (apiLib.get as jest.Mock).mockRejectedValue(new Error("Network error"));

  render(<AdminPage />);

  await waitFor(() => {
    expect(screen.getByText(/Failed to load board games/i)).toBeInTheDocument();
  });

  expect(document.querySelector(".chatroom-grid")).not.toBeInTheDocument();
});
