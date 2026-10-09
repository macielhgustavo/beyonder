import { ZodError } from "zod";
import { validateCommand } from "../../../../control/validation";
import { after, NextResponse, type NextRequest } from "next/server";
import { queueControlObjective, runControlCommand, markShutdownResponseSent, type ControlCommand } from "../../../../control/commands";
import { assertLocalRequest, commandHeaders, ControlAuthError } from "../../../../control/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await assertLocalRequest(request);
    const raw = await request.text();
    if (raw.length > 32768) throw new Error("Payload muito grande.");
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new Error("JSON inválido."); }
    const body = validateCommand(payload) as ControlCommand;

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
    return NextResponse.json({ ok: false, error: error instanceof ZodError ? "Dados do comando inválidos." : error instanceof Error ? error.message : "Falha ao executar comando." }, { status: error instanceof ControlAuthError ? error.status : 400, headers: commandHeaders() });
  }
}