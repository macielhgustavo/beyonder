import { NextResponse, type NextRequest } from "next/server";
import { getDashboardDataSource } from "../../../../data";
import { assertLocalRequest, commandHeaders } from "../../../../control/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  assertLocalRequest(request);
  return NextResponse.json(await getDashboardDataSource().getHome(), { headers: commandHeaders() });
}
