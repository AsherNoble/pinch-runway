# ADR 001: Treat Pinch Payments as collection records, not invoices

## Status

Accepted for the hackathon scaffold — validate against the team’s actual sandbox before the live demo.

## Context

The product language is naturally invoice-oriented: a sole trader is waiting
for money they have earned. Pinch’s published API, however, exposes Payers,
Payments, and Payment Links rather than an Invoice resource. It also documents
creating a Payment Link but not sending an email/SMS reminder to a payer.

## Decision

- Keep the shared application type named `Invoice` so the forecast engine has a
  stable, business-friendly contract, but only create it by normalising a real
  Pinch Payment record.
- Define `due_date` as Pinch’s scheduled collection `transactionDate`, only
  when the sandbox data has been set up with that meaning.
- Use a Payment Link as the live write action. The truthful UI copy is
  **Create Pinch payment link** / **Payment link ready to share**; it must not
  claim that Pinch sent a reminder.
- Never switch from `sandbox` to seed data after an API error. A failed live
  integration must be visible as a failed live integration.
- Derive payer lateness from a successful attempt’s `transactionDate` versus
  the original scheduled payment date. Do not use `actualTransferDate`, which
  represents settlement timing rather than payer behaviour.

## Consequences

This lets the team build a real, demoable Pinch connection without fabricating
an invoice read API or delivery action. It also puts a hard limitation in the
product: any accounting-invoice identity must be carried in Pinch metadata or
come from a later, explicitly approved accounting integration.

## Sources

- [Pinch application authentication](https://docs.getpinch.com.au/docs/application-authentication)
- [Payment Links](https://docs.getpinch.com.au/docs/payment-links)
- [Payments for a payer](https://docs.getpinch.com.au/reference/list-payments-for-payer)
- [Handle dishonoured direct debit](https://docs.getpinch.com.au/docs/handle-dishonoured-direct-debit)
