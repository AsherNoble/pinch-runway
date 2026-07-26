import { Resend } from "resend";

const DEFAULT_FROM = "Pinch Runway <onboarding@resend.dev>";

export async function emailPaymentLink(input: {
  to: string;
  payerName: string;
  paymentLink: string;
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: input.to,
    subject: "Your Pinch payment link",
    html: `<p>Hi ${escapeHtml(input.payerName)},</p><p>Here is your secure Pinch payment link:</p><p><a href="${escapeHtml(input.paymentLink)}">Pay with Pinch</a></p>`,
  });

  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? "Resend did not confirm delivery.");
  }
  return result.data.id;
}

export async function emailInvoiceReminder(input: {
  intendedRecipient: string;
  actualRecipient: string;
  payerName: string;
  invoiceId: string;
  amountCents: number;
  dueDate: string;
  testMode: boolean;
  reminderSequence: number;
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  const formattedAmount = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(input.amountCents / 100);
  const marker = input.testMode ? "[TEST — NOT SENT TO PAYER] " : "";
  const testNotice = input.testMode
    ? `<p><strong>Test delivery:</strong> this message was redirected to the operator. Intended recipient: ${escapeHtml(input.intendedRecipient)}.</p>`
    : "";
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: input.actualRecipient,
    subject: `${marker}Reminder: invoice ${input.invoiceId} is overdue`,
    html:
      `${testNotice}<p>Hi ${escapeHtml(input.payerName)},</p>` +
      `<p>This is a friendly reminder that demo invoice <strong>${escapeHtml(input.invoiceId)}</strong> ` +
      `for <strong>${escapeHtml(formattedAmount)}</strong> was due on ${escapeHtml(input.dueDate)}.</p>` +
      `<p>Please reply to the business owner if payment has already been arranged.</p>` +
      `<p>Reminder ${input.reminderSequence} of 5.</p>`,
  });
  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? "Resend did not confirm delivery.");
  }
  return result.data.id;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
