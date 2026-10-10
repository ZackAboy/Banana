import { handle, parseInput, readJson } from "@/lib/api/http";
import { verifyRequestSchema } from "@/schemas/api";
import { verify } from "@/lib/services/analysis";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () =>
    verify(parseInput(verifyRequestSchema, await readJson(request))),
  );
}
