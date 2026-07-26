"use client";

import { useState } from "react";

export function ExpenseExclusions({
  patterns,
}: {
  patterns: readonly string[];
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function mutate(method: "POST" | "DELETE", pattern: string) {
    setBusy(true);
    setMessage("Rebuilding the expense baseline…");
    try {
      const url = method === "DELETE"
        ? `/api/runway/exclusions?pattern=${encodeURIComponent(pattern)}`
        : "/api/runway/exclusions";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ pattern }) } : {}),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Exclusion update failed.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exclusion update failed.");
      setBusy(false);
    }
  }

  return (
    <div className="exclusion-controls">
      <p>Exclude personal or misclassified merchant text from future baselines.</p>
      {patterns.length ? (
        <div className="exclusion-tags">
          {patterns.map((pattern) => (
            <button
              disabled={busy}
              key={pattern}
              onClick={() => void mutate("DELETE", pattern)}
              title="Remove exclusion"
            >
              {pattern} ×
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void mutate("POST", value);
        }}
      >
        <input
          aria-label="Merchant exclusion pattern"
          disabled={busy}
          maxLength={80}
          onChange={(event) => setValue(event.target.value)}
          placeholder="e.g. personal groceries"
          value={value}
        />
        <button className="secondary-button" disabled={busy || value.trim().length < 2}>
          Exclude pattern
        </button>
      </form>
      {message ? <p className="control-message" role="status">{message}</p> : null}
    </div>
  );
}
