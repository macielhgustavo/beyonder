import { NextResponse, type NextRequest } from "next/server";
import { assertLocalRequest, commandHeaders, ControlAuthError } from "../../../../control/security";
export async function POST(request: NextRequest) {
  try {
    await assertLocalRequest(request);
    return NextResponse.json({ ok: true }, { headers: commandHeaders() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Authentication denied" }, { status: error instanceof ControlAuthError ? error.status : 403, headers: commandHeaders() });
  }
}
