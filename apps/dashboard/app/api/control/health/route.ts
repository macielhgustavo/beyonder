import { getOrCreateAuthToken } from "../../../../control/auth-token";
import { shutdownReady } from "../../../../control/commands";
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDataSource } from "../../../../data";
import { assertLocalOrigin, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  assertLocalOrigin(request);
  await getOrCreateAuthToken();
  const status = await getDashboardDataSource().getRuntimeStatus();
  return NextResponse.json({ ok: true, service: "beyonder-control-center", pid: process.pid, shutdownReady: shutdownReady(), status }, { headers: commandHeaders() });
}
