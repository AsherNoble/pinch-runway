"use client";
import { useState } from "react";

export function PaymentLinkAction({ invoiceId }: { invoiceId: string }) {
  const [link, setLink] = useState<string>();
  const [state, setState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [confirmState, setConfirmState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [confirmMessage, setConfirmMessage] = useState("");

  async function create() {
    setState("working");
    setMessage("");
    try {
      const r = await fetch("/api/collection-actions/payment-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoice_id: invoiceId }) });
      const p = await r.json() as { payment_link?: { url?: string }; error?: string };
      if (!r.ok || !p.payment_link?.url) throw new Error(p.error ?? "Payment link was not created.");
      setLink(p.payment_link.url);
      setState("ready");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Payment link was not created.");
    }
  }

  async function shared() {
    setConfirmState("working");
    const r = await fetch(`/api/collection-actions/${encodeURIComponent(invoiceId)}/shared`, { method: "POST" });
    if (!r.ok) {
      const p = await r.json().catch(() => ({})) as { error?: string };
      setConfirmState("error");
      setConfirmMessage(p.error ?? "Could not record sharing.");
      return;
    }
    setConfirmState("done");
    setConfirmMessage("Sharing recorded. The unpaid reminder warning begins after 48 hours.");
  }

  async function email() {
    setConfirmState("working");
    const r = await fetch(`/api/collection-actions/${encodeURIComponent(invoiceId)}/email`, { method: "POST" });
    const p = await r.json().catch(() => ({})) as { error?: string };
    if (!r.ok) {
      setConfirmState("error");
      setConfirmMessage(p.error ?? "Could not email the payer.");
      return;
    }
    setConfirmState("done");
    setConfirmMessage("Payment link emailed and recorded. The unpaid reminder warning begins after 48 hours.");
  }

  if (state === "ready" && link) {
    const confirmBusy = confirmState === "working" || confirmState === "done";
    return (
      <div className="ping-actions">
        <strong>Payment link ready to share</strong>
        <a href={link} target="_blank" rel="noreferrer">Open payment link</a>
        <button type="button" onClick={() => navigator.clipboard.writeText(link)}>Copy link</button>
        <button type="button" onClick={shared} disabled={confirmBusy}>I’ve shared it</button>
        <button type="button" onClick={email} disabled={confirmBusy}>Email payer instead</button>
        {confirmMessage && <span role={confirmState === "error" ? "alert" : undefined}>{confirmMessage}</span>}
      </div>
    );
  }
  return (
    <div className="ping-actions">
      <button type="button" onClick={create} disabled={state === "working"}>{state === "working" ? "Creating payment link…" : "Create payment link"}</button>
      {state === "error" && <span role="alert">{message}</span>}
    </div>
  );
}
