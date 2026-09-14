// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Auth from "./Auth";

vi.mock("./App", () => ({
  default: ({
    username,
    onSignOut,
    authError,
  }: {
    username: string;
    onSignOut: () => void;
    authError: string;
  }) => (
    <div>
      <p>Protected workspace for {username}</p>
      {authError && <p role="alert">{authError}</p>}
      <button onClick={onSignOut}>Sign out</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the workspace hidden until login succeeds and clears it on logout", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: "Sign in" }, { status: 401 }))
    .mockResolvedValueOnce(
      Response.json(
        { error: "Invalid username or password." },
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ user: { username: "admin" } }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Auth />);
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.queryByText(/Protected workspace/)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-only-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Invalid username or password.");
  expect(screen.queryByText(/Protected workspace/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Protected workspace for admin");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Sign in" });
  expect(screen.queryByText(/Protected workspace/)).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Password").value).toBe("");
});

it("restores an existing session and clears protected state after an unauthorized API response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ user: { username: "admin" } })),
  );
  render(<Auth />);
  await screen.findByText("Protected workspace for admin");
  fireEvent(window, new Event("session-expired"));
  await waitFor(() =>
    expect(screen.queryByText(/Protected workspace/)).toBeNull(),
  );
  expect(screen.getByRole("alert").textContent).toContain("session ended");
});
