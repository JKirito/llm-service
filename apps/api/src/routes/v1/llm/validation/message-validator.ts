import { validateUIMessages } from "ai";
import type { BasicUIMessage } from "../messages";

export async function validateMessages(
  messages: unknown[]
): Promise<BasicUIMessage[]> {
  // Use AI SDK validation
  const validated = await validateUIMessages({ messages });
  return validated as BasicUIMessage[];
}

export function containsUserMessage(messages: BasicUIMessage[]): boolean {
  return messages.some((message) => message.role === "user");
}
