import { shutdownReady } from "../../../../control/commands";
import { NextResponse, type NextRequest } from "next/server";
import { LocalDashboardDataSource } from "../../../../data/local";
import { assertLocalRequest, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  assertLocalRequest(request);
  const status = await new LocalDashboardDataSource().getRuntimeStatus();
  return NextResponse.json({ ok: true, service: "beyonder-control-center", pid: process.pid, shutdownReady: shutdownReady(), status }, { headers: commandHeaders() });
}
