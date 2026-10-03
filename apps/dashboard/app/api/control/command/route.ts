import { NextResponse, type NextRequest } from "next/server";
import { runControlCommand, type ControlCommand } from "../../../../control/commands";
import { assertLocalRequest, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "submitObjective",
  "discoverOpportunities",
  "prepareApplication",
  "approveAction",
  "rejectAction",
  "pauseRuntime",
  "resumeRuntime",
  "safeShutdown",
  "emergencyStop",
  "completeFirstRun",
  "setDeveloperMode",
  "setStartup",
  "setSecret"
]);

export async function POST(request: NextRequest) {
  try {
    assertLocalRequest(request);
    const body = await request.json() as ControlCommand;
    if (!body || typeof body !== "object" || !("type" in body) || !ALLOWED.has(String(body.type))) {
      return NextResponse.json({ ok: false, error: "Unknown Control Center command." }, { status: 400, headers: commandHeaders() });
    }
    const result = await runControlCommand(body);
    return NextResponse.json(result, { headers: commandHeaders() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: commandHeaders() });
  }
}
