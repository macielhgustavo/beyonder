import { ZodError } from "zod";
import { validateCommand } from "../../../../control/validation";
import { after, NextResponse, type NextRequest } from "next/server";
import { queueControlObjective, runControlCommand, markShutdownResponseSent, type ControlCommand } from "../../../../control/commands";
import { assertLocalRequest, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

// Mutating command types that require authentication
const MUTATING_COMMANDS = new Set([
  "submitObjective",
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
  "confirmApplication",
  "confirmSubmission",
  "recordSettlement",
  "setSecret"
]);

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > 32768) throw new Error("Payload muito grande.");
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new Error("JSON inválido."); }
    const body = validateCommand(payload) as ControlCommand;

    // For mutating commands, require full local auth + token
    if (MUTATING_COMMANDS.has(body.type)) {
      await assertLocalRequest(request);
    } else {
      // For read-only commands, just check local origin
      const host = request.headers.get("host") ?? "";
      let hostname: string;
      try { hostname = new URL(`http://${host}`).hostname; } catch { throw new Error("Host inválido."); }
      if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
        throw new Error("Control Center only accepts local requests.");
      }
      const origin = request.headers.get("origin");
      if (origin) {
        const parsed = new URL(origin);
        if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.host !== host) {
          throw new Error("Origin is not allowed for Control Center commands.");
        }
      }
    }

    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("Content-Type deve ser application/json.");

    if (body.type === "submitObjective") {
      const queued = await queueControlObjective(body.objective);
      after(async () => { try { await queued.run(); } catch { /* Failure state is persisted by the mission runner. */ } });
      return NextResponse.json(queued.response, { status: 202, headers: commandHeaders() });
    }
    const result = await runControlCommand(body);
    if (body.type === "safeShutdown") after(() => markShutdownResponseSent());
    return NextResponse.json(result, { headers: commandHeaders() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof ZodError ? "Dados do comando inválidos." : error instanceof Error ? error.message : "Falha ao executar comando." }, { status: 400, headers: commandHeaders() });
  }
}