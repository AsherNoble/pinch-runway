export type IntegrationProvenance = "live" | "simulated" | "fallback";

export interface ProviderEnvelope<T> {
  provider: "basiq" | "pinch" | "gmail" | "google_calendar" | "twilio_whatsapp";
  provenance: IntegrationProvenance;
  retrieved_at: string;
  data: T;
  warning?: string;
}
