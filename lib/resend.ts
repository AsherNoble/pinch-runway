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

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
