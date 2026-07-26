import { getChatGPTUser } from "@/app/chatgpt-auth";

/** ChatGPT Sites email when present; local fallback for fixture/dev. */
export async function getTaxOwnerEmail(): Promise<string> {
  const user = await getChatGPTUser();
  return user?.email ?? "local@dev";
}
