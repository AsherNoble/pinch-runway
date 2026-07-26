"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BankAccountSummary,
  DataReadinessState,
} from "@/lib/runway-contracts";

export function BankControls({
  accounts,
  bankState,
  initialJobIds,
  signedIn,
}: {
  accounts: readonly BankAccountSummary[];
  bankState: DataReadinessState;
  initialJobIds?: string;
  signedIn: boolean;
}) {
  const [selected, setSelected] = useState(
    accounts.filter((account) => account.selected).map((account) => account.id),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(Boolean(initialJobIds));

  const poll = useCallback(async (jobIds: string) => {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const response = await fetch(
        `/api/basiq/jobs?jobIds=${encodeURIComponent(jobIds)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        state?: string;
        error?: string;
      };
      if (response.ok && body.state === "connected") {
        window.location.href = "/";
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Basiq sync failed.");
      setMessage("Basiq is still importing accounts and transactions…");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("Basiq is taking longer than expected. Refresh again shortly.");
  }, []);

  useEffect(() => {
    if (!initialJobIds) return;
    const timer = window.setTimeout(() => {
      void poll(initialJobIds)
        .catch((error: unknown) =>
          setMessage(error instanceof Error ? error.message : "Basiq sync failed."),
        )
        .finally(() => setBusy(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialJobIds, poll]);

  async function refresh() {
    setBusy(true);
    setMessage("Starting a fresh Basiq sync…");
    try {
      const response = await fetch("/api/basiq/refresh", { method: "POST" });
      const body = (await response.json()) as { jobIds?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Refresh failed.");
      if (!body.jobIds?.length) throw new Error("Basiq did not return a refresh job.");
      await poll(body.jobIds.join(","));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSelection() {
    setBusy(true);
    setMessage("Saving and rebuilding the forecast…");
    try {
      const response = await fetch("/api/basiq/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_ids: selected }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Account selection failed.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account selection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Basiq and remove all locally derived bank data?")) {
      return;
    }
    setBusy(true);
    setMessage("Disconnecting Basiq…");
    try {
      const response = await fetch("/api/basiq/disconnect", { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Disconnect failed.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disconnect failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="bank-onboarding">
        <p>Sign in with ChatGPT to connect the single-trader Basiq sandbox profile.</p>
        <a className="primary-button" href="/signin-with-chatgpt?return_to=%2F">
          Sign in to connect
        </a>
      </div>
    );
  }
  if (!accounts.length) {
    return (
      <div className="bank-onboarding">
        <p>
          Complete Basiq’s hosted consent journey, then choose only the accounts
          used by this business.
        </p>
        <a className="primary-button" href="/api/basiq/connect">
          Connect Basiq sandbox
        </a>
        {message ? <p className="control-message" role="status">{message}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <div className="account-options">
        {accounts.map((account) => (
          <label key={account.id}>
            <input
              checked={selected.includes(account.id)}
              disabled={busy || account.currency !== "AUD"}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, account.id]
                    : current.filter((id) => id !== account.id),
                )
              }
              type="checkbox"
            />
            <span>
              <strong>{account.name}</strong>
              <small>
                {account.masked_number ?? "Masked"} · {account.account_class} ·{" "}
                {account.currency}
                {account.cash_role === "liability" ? " · shown as liability" : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className="control-row">
        <button className="primary-button" disabled={busy} onClick={saveSelection}>
          Save accounts
        </button>
        <button className="secondary-button" disabled={busy} onClick={refresh}>
          Refresh bank data
        </button>
        <button className="text-button" disabled={busy} onClick={disconnect}>
          Disconnect
        </button>
      </div>
      {bankState === "stale" ? (
        <p className="inline-alert">Recommendations and automatic sends are paused.</p>
      ) : null}
      {message ? <p className="control-message" role="status">{message}</p> : null}
    </div>
  );
}
