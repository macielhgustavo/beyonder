import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDataSource } from "../../../../../data";
import { assertLocalRequest, commandHeaders } from "../../../../../control/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  assertLocalRequest(request);
  const { taskId } = await context.params;
  if (!/^task_[A-Za-z0-9_-]{1,180}$/.test(taskId)) return NextResponse.json({ ok: false, error: "Missão inválida." }, { status: 400, headers: commandHeaders() });
  const mission = await getDashboardDataSource().getTask(taskId);
  return mission
    ? NextResponse.json({ ok: true, mission }, { headers: commandHeaders() })
    : NextResponse.json({ ok: false, error: "Missão não encontrada." }, { status: 404, headers: commandHeaders() });
}
