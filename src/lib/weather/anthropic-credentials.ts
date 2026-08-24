import "server-only";
import { prisma } from "@/lib/companion/prisma";

// Anthropic API key, used for the AI weather summary (Claude Haiku).
// Source: AppSettings.extra.anthropic.apiKey (settable in the UI) with a
// fallback to the ANTHROPIC_API_KEY env var. The key is never returned to the
// UI — only a boolean saying whether one is configured. Mirrors owm-credentials.

async function readExtra(): Promise<any> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: "global" } });
    return (row?.extra as any) ?? {};
  } catch {
    return {};
  }
}


export async function getAnthropicKey(): Promise<string> {
  const stored = (await readExtra())?.anthropic ?? {};
  return (stored.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
}


export async function getAnthropicStatus() {
  const stored = (await readExtra())?.anthropic ?? {};
  const hasStored = !!stored.apiKey;
  const hasEnv = !!process.env.ANTHROPIC_API_KEY;
  return {
    configured: hasStored || hasEnv,
    // From env → the UI field is read-only.
    fromEnv: !hasStored && hasEnv,
  };
}


export async function setAnthropicKey(apiKey: string): Promise<void> {
  const extra = await readExtra();
  const trimmed = (apiKey || "").trim();
  const anthropic: Record<string, string> = { ...(extra.anthropic ?? {}) };
  if (trimmed) {
    anthropic.apiKey = trimmed;
  } else {
    // An empty value clears the stored key.
    delete anthropic.apiKey;
  }
  await prisma.appSettings.upsert({
    where: { id: "global" },
    update: { extra: { ...extra, anthropic } as any, updatedAt: new Date() },
    create: { id: "global", haUrl: "", haToken: "", extra: { anthropic } as any },
  });
}
