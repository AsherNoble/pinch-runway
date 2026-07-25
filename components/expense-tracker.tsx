"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ExtractedExpense } from "@/lib/expenses";

type ExpenseRow = {
  id: number;
  date: string;
  description: string;
  company: string;
  amountCents: number;
  gstCents: number;
  amountIncludesGst: boolean;
};

function formatAud(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function dollarsInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export function ExpenseTracker() {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ExtractedExpense | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadList(nextMonth = month, nextQ = q) {
    startTransition(async () => {
      setError(null);
      const params = new URLSearchParams();
      if (nextMonth) params.set("month", nextMonth);
      if (nextQ.trim()) params.set("q", nextQ.trim());
      const response = await fetch(`/api/expenses?${params}`, { cache: "no-store" });
      const payload = (await response.json()) as { expenses?: ExpenseRow[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not load expenses.");
        return;
      }
      setRows(payload.expenses ?? []);
    });
  }

  useEffect(() => {
    loadList();
    // Initial load only; filters reload via explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onExtract() {
    if (!file) {
      setError("Choose a receipt photo first.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setStatus("Reading receipt…");
      const body = new FormData();
      body.set("receipt", file);
      const response = await fetch("/api/expenses/extract", { method: "POST", body });
      const payload = (await response.json()) as {
        expense?: ExtractedExpense;
        error?: string;
      };
      if (!response.ok || !payload.expense) {
        setStatus(null);
        setError(payload.error ?? "Extract failed.");
        return;
      }
      setDraft(payload.expense);
      setStatus("Check details, then save.");
    });
  }

  function onSave() {
    if (!file || !draft) {
      setError("Extract a receipt before saving.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setStatus("Saving…");
      const body = new FormData();
      body.set("receipt", file);
      body.set("date", draft.date);
      body.set("description", draft.description);
      body.set("company", draft.company);
      body.set("amountCents", String(draft.amountCents));
      body.set("gstCents", String(draft.gstCents));
      body.set("amountIncludesGst", draft.amountIncludesGst ? "true" : "false");
      const response = await fetch("/api/expenses", { method: "POST", body });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(null);
        setError(payload.error ?? "Save failed.");
        return;
      }
      setFile(null);
      setDraft(null);
      setStatus("Saved.");
      loadList();
    });
  }

  return (
    <main className="runway-shell expense-shell">
      <section className="runway-hero" aria-labelledby="expenses-title">
        <div>
          <p className="eyebrow">Receipts</p>
          <h1 id="expenses-title">Expense tracker</h1>
          <p className="hero-copy">
            Upload a receipt photo. AI fills date, merchant, total, and GST — you
            confirm before it lands in the list.
          </p>
          <p className="expense-nav">
            <Link href="/">Back to Runway</Link>
          </p>
        </div>
      </section>

      <section className="expense-panel" aria-labelledby="upload-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">New expense</p>
            <h2 id="upload-title">Upload receipt</h2>
          </div>
        </div>

        <div className="expense-upload-row">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setDraft(null);
              setStatus(null);
              setError(null);
            }}
          />
          <button type="button" className="expense-button" disabled={pending || !file} onClick={onExtract}>
            Extract with AI
          </button>
        </div>

        {draft ? (
          <form
            className="expense-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <label>
              Date
              <input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                required
              />
            </label>
            <label>
              Company
              <input
                type="text"
                value={draft.company}
                onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                required
              />
            </label>
            <label className="expense-form-span">
              Description
              <input
                type="text"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                required
              />
            </label>
            <label>
              Amount (AUD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={dollarsInput(draft.amountCents)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    amountCents: Math.round(Number(event.target.value || 0) * 100),
                  })
                }
                required
              />
            </label>
            <label>
              GST (AUD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={dollarsInput(draft.gstCents)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    gstCents: Math.round(Number(event.target.value || 0) * 100),
                  })
                }
                required
              />
            </label>
            <label className="expense-check">
              <input
                type="checkbox"
                checked={draft.amountIncludesGst}
                onChange={(event) =>
                  setDraft({ ...draft, amountIncludesGst: event.target.checked })
                }
              />
              Amount includes GST
            </label>
            <div className="expense-form-actions">
              <button type="submit" className="expense-button" disabled={pending}>
                Save expense
              </button>
              <button
                type="button"
                className="expense-button expense-button-ghost"
                disabled={pending}
                onClick={() => {
                  setDraft(null);
                  setStatus(null);
                }}
              >
                Clear
              </button>
            </div>
          </form>
        ) : null}

        {status ? <p className="expense-status">{status}</p> : null}
        {error ? <p className="expense-error">{error}</p> : null}
      </section>

      <section className="expense-panel" aria-labelledby="list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2 id="list-title">Expenses</h2>
          </div>
        </div>

        <div className="expense-filters">
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => {
                const next = event.target.value;
                setMonth(next);
                loadList(next, q);
              }}
            />
          </label>
          <label className="expense-search">
            Search
            <input
              type="search"
              placeholder="Company or description"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadList(month, q);
              }}
            />
          </label>
          <button
            type="button"
            className="expense-button"
            disabled={pending}
            onClick={() => loadList(month, q)}
          >
            Apply
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="empty-copy">No expenses for this filter.</p>
        ) : (
          <ul className="expense-list expense-tracker-list">
            {rows.map((row) => (
              <li key={row.id}>
                <span>
                  <strong>{row.company}</strong>
                  <br />
                  {row.description}
                </span>
                <span>
                  {formatAud(row.amountCents)}
                  <br />
                  GST {formatAud(row.gstCents)} · {row.date}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
