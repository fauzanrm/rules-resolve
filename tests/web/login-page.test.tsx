import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "@/app/login/page";
import * as authLib from "@/lib/auth";
import * as apiLib from "@/lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@/lib/auth", () => ({
  getSession: jest.fn().mockReturnValue(null),
  setSession: jest.fn(),
  clearSession: jest.fn(),
  getRoleRoute: jest.fn((role: string) => (role === "admin" ? "/admin" : "/under-construction")),
}));

jest.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { post: jest.fn(), ApiError };
});

beforeEach(() => {
  jest.clearAllMocks();
  (authLib.getSession as jest.Mock).mockReturnValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

// 1. Render test
test("renders title, subtitle, inputs, checkbox, and sign-in button", () => {
  render(<LoginPage />);

  expect(screen.getByText("RuleResolve Beta")).toBeInTheDocument();
  expect(screen.getByText(/Thank you for participating/)).toBeInTheDocument();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
});

// 2. Submit blocked when T&C unchecked
test("sign-in button is disabled when Terms and Conditions is unchecked", () => {
  render(<LoginPage />);
  expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
});

// 3. Clicking Terms and Conditions opens the modal
test("clicking Terms and Conditions opens the modal", async () => {
  const user = userEvent.setup();
  render(<LoginPage />);

  await user.click(screen.getByRole("button", { name: /terms and conditions/i }));

  expect(screen.getByRole("heading", { name: /terms and conditions/i })).toBeInTheDocument();
});

// 4. Successful admin login
test("valid admin credentials show success toast and redirect to /admin", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ delay: null });
  (apiLib.post as jest.Mock).mockResolvedValue({ role: "admin", username: "adminuser" });

  render(<LoginPage />);

  await user.type(screen.getByLabelText(/username/i), "adminuser");
  await user.type(screen.getByLabelText(/password/i), "password");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.getByText(/login successful/i)).toBeInTheDocument();
  });

  act(() => jest.advanceTimersByTime(1500));
  expect(mockPush).toHaveBeenCalledWith("/admin");

  jest.useRealTimers();
});

// 5. Successful user login
test("valid user credentials redirect to /under-construction", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ delay: null });
  (apiLib.post as jest.Mock).mockResolvedValue({ role: "user", username: "regularuser" });
  (authLib.getRoleRoute as jest.Mock).mockReturnValue("/under-construction");

  render(<LoginPage />);

  await user.type(screen.getByLabelText(/username/i), "regularuser");
  await user.type(screen.getByLabelText(/password/i), "password");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.getByText(/login successful/i)).toBeInTheDocument();
  });

  act(() => jest.advanceTimersByTime(1500));
  expect(mockPush).toHaveBeenCalledWith("/under-construction");

  jest.useRealTimers();
});

// 6. Invalid credentials show error, preserve username, clear password
test("invalid credentials show error and preserve username", async () => {
  const user = userEvent.setup();
  const { ApiError } = jest.requireMock("@/lib/api");
  (apiLib.post as jest.Mock).mockRejectedValue(new ApiError(401, "Invalid credentials"));

  render(<LoginPage />);

  await user.type(screen.getByLabelText(/username/i), "adminuser");
  await user.type(screen.getByLabelText(/password/i), "wrongpass");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
  });

  expect(screen.getByLabelText(/username/i)).toHaveValue("adminuser");
  expect(screen.getByLabelText(/password/i)).toHaveValue("");
});

// 7. Retry: sign-in button re-enabled after failure
test("user can attempt login again after failure", async () => {
  const user = userEvent.setup();
  const { ApiError } = jest.requireMock("@/lib/api");
  (apiLib.post as jest.Mock).mockRejectedValue(new ApiError(401, "Invalid credentials"));

  render(<LoginPage />);

  await user.type(screen.getByLabelText(/username/i), "adminuser");
  await user.type(screen.getByLabelText(/password/i), "wrong");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
  });

  expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled();
});

// 8. Empty fields validation (client-side, no API call)
test("submitting with empty fields shows an error without calling the API", async () => {
  const user = userEvent.setup();
  render(<LoginPage />);

  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  expect(screen.getByText(/please enter your username and password/i)).toBeInTheDocument();
  expect(apiLib.post).not.toHaveBeenCalled();
});

// 9. Rapid submission: button disabled while request is in flight
test("sign-in button is disabled while a request is in flight", async () => {
  const user = userEvent.setup();
  let settle: (v: unknown) => void;
  (apiLib.post as jest.Mock).mockImplementation(
    () => new Promise((resolve) => { settle = resolve; })
  );

  render(<LoginPage />);

  await user.type(screen.getByLabelText(/username/i), "adminuser");
  await user.type(screen.getByLabelText(/password/i), "pass");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();

  act(() => settle!({ role: "admin", username: "adminuser" }));
});
