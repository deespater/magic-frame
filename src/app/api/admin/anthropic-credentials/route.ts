import { NextRequest, NextResponse } from "next/server";
import {
  verifySession,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/auth/dal";
import { getAnthropicStatus, setAnthropicKey } from "@/lib/weather/anthropic-credentials";

export const dynamic = "force-dynamic";

// GET — status only (configured? from env?). The key itself is never returned.
export async function GET() {
  try {
    await verifySession();
    return NextResponse.json(await getAnthropicStatus());
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}

// POST — save the key (admin only). An empty body clears the stored key.
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession();
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Nur Admins dürfen API-Keys setzen." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    await setAnthropicKey(apiKey);
    return NextResponse.json({ ok: true, status: await getAnthropicStatus() });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    console.error("anthropic-credentials POST error", err);
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}

// DELETE — remove the stored key (the ANTHROPIC_API_KEY env fallback remains).
export async function DELETE() {
  try {
    const session = await verifySession();
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Nur Admins." }, { status: 403 });
    }
    await setAnthropicKey("");
    return NextResponse.json({ ok: true, status: await getAnthropicStatus() });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
