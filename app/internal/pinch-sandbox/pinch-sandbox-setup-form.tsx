"use client";

import Script from "next/script";
import { FormEvent, useState } from "react";

type CaptureTokenResult = { token?: string };

declare global {
  interface Window {
    Pinch?: {
      Capture: (options: { publishableKey: string }) => {
        createToken: (input: {
          sourceType: "bank-account";
          bankAccountName: string;
          bankAccountRouting: string;
          bankAccountNumber: string;
        }) => Promise<CaptureTokenResult>;
      };
    };
  }
}

interface SeedResult {
  payer_key: string;
  provider_payer_id: string;
  provider_source_id: string;
  provider_payment_id: string;
  transaction_date: string;
  status: string | null;
}

interface AdvanceResult {
  test_time: string;
  payment: {
    id: string | null;
    status: string | null;
    transaction_date: string | null;
    attempts: readonly Record<string, string | null>[];
  };
}

interface PinchSandboxSetupFormProps {
  publishableKey: string;
}

const CAPTURE_JS_URL = "https://cdn.getpinch.com.au/capturejs/pinch.capture.v2.js";
const CAPTURE_JS_INTEGRITY =
  "sha384-hglYFSKC4AMA/rAQOGB3OiA8u5ri5F4qNMGgw4I+fggDSlTmPyREcj1J+VGnkAX8";

export function PinchSandboxSetupForm({ publishableKey }: PinchSandboxSetupFormProps) {
  const [captureReady, setCaptureReady] = useState(false);
  const [message, setMessage] = useState("Loading Pinch CaptureJS…");
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [advanceResult, setAdvanceResult] = useState<AdvanceResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function createSourceAndScheduledPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureReady || !window.Pinch?.Capture) {
      setMessage("CaptureJS has not loaded yet. Please wait and retry.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const setupToken = stringFormValue(form, "setup_token");
    const payerKey = stringFormValue(form, "payer_key");
    const bankAccountName = stringFormValue(form, "bank_account_name");
    // Preserve Pinch's documented `000-000` test BSB format. CaptureJS owns
    // validation/tokenisation, so this value never passes through Runway.
    const bankAccountRouting = stringFormValue(form, "bank_account_routing");
    const bankAccountNumber = stringFormValue(form, "bank_account_number").replace(/\s/g, "");

    setBusy(true);
    setMessage("Tokenising the documented test account directly with Pinch…");
    setAdvanceResult(null);

    try {
      const capture = window.Pinch.Capture({ publishableKey });
      const tokenResult = await capture.createToken({
        sourceType: "bank-account",
        bankAccountName,
        bankAccountRouting,
        bankAccountNumber,
      });
      if (!tokenResult.token) throw new Error("Pinch CaptureJS did not return a token.");

      setMessage("Creating a real test source and scheduled Payment…");
      const response = await fetch("/api/internal/pinch-sandbox/seed-payment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capture_token: tokenResult.token,
          payer_key: payerKey,
          setup_token: setupToken,
        }),
      });
      const payload = (await response.json()) as SeedResult | { message?: string };
      if (!response.ok || !("provider_payment_id" in payload)) {
        throw new Error("message" in payload ? payload.message ?? "Pinch setup failed." : "Pinch setup failed.");
      }

      setSeedResult(payload);
      setMessage(
        "A real sandbox Payment is scheduled. Advance the test clock below to trigger Pinch processing.",
      );
    } catch (error) {
      setMessage(describeCaptureError(error));
    } finally {
      setBusy(false);
    }
  }

  async function advanceTime(step: "next_morning" | "settle") {
    if (!seedResult) return;
    const setupToken = currentSetupToken();
    if (!setupToken) {
      setMessage("Enter the operator token before advancing the Pinch test clock.");
      return;
    }

    setBusy(true);
    setMessage("Advancing Pinch test time and reading the real Payment result…");
    try {
      const response = await fetch("/api/internal/pinch-sandbox/advance", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_id: seedResult.provider_payment_id,
          payer_key: seedResult.payer_key,
          setup_token: setupToken,
          step,
        }),
      });
      const payload = (await response.json()) as AdvanceResult | { message?: string };
      if (!response.ok || !("payment" in payload)) {
        throw new Error("message" in payload ? payload.message ?? "Time travel failed." : "Time travel failed.");
      }

      setAdvanceResult(payload);
      setMessage(
        step === "next_morning"
          ? "Pinch processing was triggered. Advance again for the settlement window."
          : "Settlement window requested. Inspect the returned real provider status and attempts below.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Time travel failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sandbox-setup-card" aria-label="Pinch sandbox data setup">
      <Script
        src={CAPTURE_JS_URL}
        integrity={CAPTURE_JS_INTEGRITY}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onLoad={() => {
          setCaptureReady(Boolean(window.Pinch?.Capture));
          setMessage(
            window.Pinch?.Capture
              ? "CaptureJS is ready. This form uses documented Pinch test account details only."
              : "CaptureJS loaded without its expected API.",
          );
        }}
        onError={() => setMessage("Pinch CaptureJS could not be loaded.")}
      />

      <div className="sandbox-setup-intro">
        <div>
          <p className="eyebrow">Step 1 · tokenise in browser</p>
          <h2>Attach a test source and schedule a $10 direct debit</h2>
        </div>
        <span className={captureReady ? "sandbox-status ready" : "sandbox-status"}>
          {captureReady ? "CaptureJS ready" : "Loading CaptureJS"}
        </span>
      </div>

      <p className="sandbox-setup-note">
        BSB and account values below are Pinch&apos;s published test values. They are tokenised
        in this browser and are never posted to Runway&apos;s server.
      </p>

      <form className="sandbox-form" onSubmit={createSourceAndScheduledPayment}>
        <label>
          Test Payer
          <select name="payer_key" defaultValue="reliable" disabled={busy}>
            <option value="reliable">Reliable probe</option>
            <option value="delayed">Delayed probe</option>
          </select>
        </label>
        <label>
          Operator token
          <input
            id="sandbox-setup-token"
            name="setup_token"
            type="password"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <label>
          Test account name
          <input
            name="bank_account_name"
            defaultValue="Runway Sandbox Test Account"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <label>
          Test BSB
          <input
            name="bank_account_routing"
            defaultValue="000-000"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <label>
          Test account number
          <input
            name="bank_account_number"
            defaultValue="0000000000"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <button className="sandbox-primary-button" type="submit" disabled={!captureReady || busy}>
          {busy ? "Working…" : "Create real test Payment"}
        </button>
      </form>

      <p className="sandbox-message" aria-live="polite">
        {message}
      </p>

      {seedResult ? (
        <section className="sandbox-time-travel" aria-labelledby="time-travel-title">
          <div>
            <p className="eyebrow">Step 2 · time travel</p>
            <h2 id="time-travel-title">Trigger Pinch&apos;s real processing windows</h2>
            <p>
              Scheduled date: <strong>{seedResult.transaction_date}</strong>. These buttons
              only issue Pinch&apos;s documented Time-Travel header against its test API.
            </p>
          </div>
          <div className="sandbox-button-row">
            <button type="button" onClick={() => void advanceTime("next_morning")} disabled={busy}>
              Advance to next morning
            </button>
            <button type="button" onClick={() => void advanceTime("settle")} disabled={busy}>
              Advance to settlement
            </button>
          </div>
        </section>
      ) : null}

      {advanceResult ? (
        <section className="sandbox-result" aria-label="Real Pinch Payment response summary">
          <p className="eyebrow">Provider result · redacted to useful fields</p>
          <pre>{JSON.stringify(advanceResult, null, 2)}</pre>
        </section>
      ) : null}
    </section>
  );
}

function stringFormValue(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function currentSetupToken(): string {
  const input = document.getElementById("sandbox-setup-token");
  return input instanceof HTMLInputElement ? input.value : "";
}

/**
 * CaptureJS can reject with a plain provider object instead of an Error. Show
 * only its short, non-sensitive code/message fields so a failed tokenisation
 * is diagnosable without echoing any bank details or opaque tokens.
 */
function describeCaptureError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && shortText(error)) {
    return `Pinch CaptureJS tokenisation failed: ${shortText(error)}`;
  }
  if (!isRecord(error)) return "Pinch sandbox setup failed before creating a Payment.";

  const nestedError = isRecord(error.error) ? error.error : undefined;
  const firstError = Array.isArray(error.errors) && isRecord(error.errors[0])
    ? error.errors[0]
    : undefined;
  const code =
    shortText(error.code) ??
    shortText(error.errorCode) ??
    shortText(nestedError?.code) ??
    shortText(firstError?.code);
  const providerMessage =
    shortText(error.message) ??
    shortText(error.errorDescription) ??
    shortText(nestedError?.message) ??
    shortText(firstError?.message);
  const type = shortText(error.type) ?? shortText(error.name) ?? shortText(nestedError?.type);
  const status = typeof error.status === "number" ? error.status : undefined;

  if (code && providerMessage) {
    return `Pinch CaptureJS tokenisation failed (${code}): ${providerMessage}`;
  }
  if (code) return `Pinch CaptureJS tokenisation failed (${code}).`;
  if (providerMessage) return `Pinch CaptureJS tokenisation failed: ${providerMessage}`;
  if (type && status) return `Pinch CaptureJS tokenisation failed (${type}, status ${status}).`;
  if (type) return `Pinch CaptureJS tokenisation failed (${type}).`;
  if (status) return `Pinch CaptureJS tokenisation failed (status ${status}).`;
  return "Pinch sandbox setup failed before creating a Payment.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180) return undefined;
  return trimmed;
}
