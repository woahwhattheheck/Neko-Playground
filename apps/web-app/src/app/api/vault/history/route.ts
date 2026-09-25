import { NextResponse } from "next/server";
import { listVaultRunHistory } from "@/lib/vault/investLedger";
import { errorResponse } from "@/lib/observability";

const ROUTE = "/api/vault/history";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await listVaultRunHistory();
    return NextResponse.json([...entries].reverse());
  } catch (err) {
    return errorResponse(err, { req: null, route: ROUTE, status: 500 });
  }
}
