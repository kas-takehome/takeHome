import { useEffect, useRef, useState } from "react";
import type { Customer } from "../shared/domain";

export default function CustomerPicker({
  id,
  customers,
  value,
  onChange,
  disabled,
  loading,
  placeholder,
}: {
  id: string;
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  loading: boolean;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const selected = customers.find(
    (customer) => String(customer.customer_id) === value,
  );
  const search = selected ? "" : query.trim().toLowerCase();
  const matches = customers.filter((customer) =>
    `${customer.customer_name} · #${customer.customer_id}`
      .toLowerCase()
      .includes(search),
  );
  const expanded = open && !disabled;
  const listId = `${id}-suggestions`;

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      selected ? "" : "Choose an existing customer from the suggestions.",
    );
  }, [selected]);

  useEffect(() => {
    if (expanded && activeIndex >= 0)
      activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeIndex]);

  function choose(customer: Customer) {
    onChange(String(customer.customer_id));
    setQuery(`${customer.customer_name} · #${customer.customer_id}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <>
      <div className="customer-picker">
        <input
          ref={inputRef}
          id={id}
          className="text-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={
            expanded && matches[activeIndex]
              ? `${listId}-${matches[activeIndex].customer_id}`
              : undefined
          }
          aria-busy={loading}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          required
          value={
            selected
              ? `${selected.customer_name} · #${selected.customer_id}`
              : query
          }
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!matches.length) return;
              const next =
                !expanded || activeIndex < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : matches.length - 1
                  : activeIndex + (event.key === "ArrowDown" ? 1 : -1);
              setActiveIndex(Math.max(0, Math.min(matches.length - 1, next)));
            } else if (event.key === "Enter" && expanded) {
              event.preventDefault();
              if (matches[activeIndex]) choose(matches[activeIndex]);
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {expanded && (
          <div className="customer-suggestions">
            <div id={listId} role="listbox" aria-label="Customer suggestions">
              {matches.map((customer, index) => (
                <button
                  key={customer.customer_id}
                  id={`${listId}-${customer.customer_id}`}
                  ref={index === activeIndex ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(customer)}
                >
                  <span>{customer.customer_name}</span>
                  <span className="customer-suggestion-id">
                    #{customer.customer_id}
                  </span>
                </button>
              ))}
            </div>
            {!matches.length && (
              <div className="customer-no-results" role="status">
                No matching customers.
              </div>
            )}
          </div>
        )}
      </div>
      <p className="field-hint" id={`${id}-hint`}>
        Type a name or customer ID, then choose a suggestion.
      </p>
    </>
  );
}
