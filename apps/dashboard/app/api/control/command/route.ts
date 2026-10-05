import { validateCommand } from "../../../../control/validation";
import { after, NextResponse, type NextRequest } from "next/server";
import { queueControlObjective, runControlCommand, markShutdownResponseSent, type ControlCommand } from "../../../../control/commands";
import { assertLocalRequest, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLocalRequest(request);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("Content-Type deve ser application/json.");
    if (!request.headers.get("origin") || new URL(request.headers.get("origin")!).host !== request.headers.get("host") || new URL(request.headers.get("origin")!).protocol !== new URL(request.url).protocol) throw new Error("Origem da requisição inválida.");
    const raw = await request.text();
    if (raw.length > 32768) throw new Error("Payload muito grande.");
    const body = validateCommand(JSON.parse(raw)) as ControlCommand;
    if (body.type === "submitObjective") {
      const queued = await queueControlObjective(body.objective);
      after(async () => { try { await queued.run(); } catch { /* Failure state is persisted by the mission runner. */ } });
      return NextResponse.json(queued.response, { status: 202, headers: commandHeaders() });
    }
    const result = await runControlCommand(body);
    if (body.type === "safeShutdown") after(() => markShutdownResponseSent());
    return NextResponse.json(result, { headers: commandHeaders() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: commandHeaders() });
  }
}
