// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CustomerPicker from "./CustomerPicker";
import CreateDispute from "./CreateDispute";
import type { Customer } from "../shared/domain";

const customers: Customer[] = [
  { customer_id: 12, customer_name: "Olivia Martinez" },
  { customer_id: 20, customer_name: "Olivia Martinez" },
  { customer_id: 31, customer_name: "James Wilson" },
];

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Picker({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="customer">Customer</label>
      <CustomerPicker
        id="customer"
        customers={customers}
        value={value}
        onChange={setValue}
        disabled={disabled}
        loading={disabled}
        placeholder="Search customers"
      />
    </>
  );
}

describe("customer suggestions", () => {
  it("filters by name without case sensitivity and distinguishes duplicate names by ID", () => {
    render(<Picker />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    act(() => input.focus());
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.change(input, { target: { value: " mArTiNeZ " } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    const option = screen.getByRole("option", { name: /#20/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(input.value).toBe("Olivia Martinez · #20");
    expect(input.checkValidity()).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters by numeric ID and selects with arrow keys and Enter", () => {
    render(<Picker />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    fireEvent.change(input, { target: { value: "#31" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "customer-suggestions-31",
    );
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("James Wilson · #31");
    expect(input.checkValidity()).toBe(true);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Olivia Martinez · #20");
  });

  it("invalidates a prior selection on edits and rejects arbitrary or unselected text", () => {
    render(<Picker />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: /#12/ }));
    expect(input.checkValidity()).toBe(true);
    fireEvent.change(input, { target: { value: "Not a customer" } });
    expect(screen.getByRole("status").textContent).toBe(
      "No matching customers.",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.checkValidity()).toBe(false);
    fireEvent.change(input, { target: { value: "Olivia Martinez" } });
    expect(input.checkValidity()).toBe(false);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(input.checkValidity()).toBe(false);
  });

  it("dismisses suggestions with Escape or blur while preserving dialog Escape handling", () => {
    render(<Picker />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true);
    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("disables input and suggestions while customers are unavailable", () => {
    render(<Picker disabled />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("submits only the selected numeric customer ID and retains selection after a server error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ customers }))
      .mockResolvedValueOnce(
        Response.json({ error: "Please retry." }, { status: 500 }),
      )
      .mockResolvedValueOnce(Response.json({ dispute: { id: "DSP-1051" } }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    render(
      <CreateDispute
        agentOptions={[]}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Customer",
    });
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "martinez" } });
    fireEvent.click(screen.getByRole("option", { name: /#20/ }));
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "fraud" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "12.50" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add dispute", hidden: true }),
    );
    await screen.findByText("Please retry.");
    expect(input.value).toBe("Olivia Martinez · #20");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/disputes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dispute-Client": "internal-web",
      },
      body: JSON.stringify({
        customer_id: 20,
        amount: 1250,
        currency: "USD",
        reason_code: "fraud",
        assigned_agent: null,
        notes: "",
      }),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add dispute", hidden: true }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("DSP-1051"));
  });
});
