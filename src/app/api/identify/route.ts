import { handle } from "@/lib/api/http";
import { readIdentifyInput } from "@/lib/api/identify-input";
import { identify } from "@/lib/services/analysis";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    const { images, scenario } = await readIdentifyInput(request);
    return identify(images, scenario);
  });
}
