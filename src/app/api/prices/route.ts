import { handle, parseInput } from "@/lib/api/http";
import { productQuerySchema } from "@/schemas/api";
import { prices } from "@/lib/services/analysis";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handle(async () =>
    prices(
      parseInput(
        productQuerySchema,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    ),
  );
}
