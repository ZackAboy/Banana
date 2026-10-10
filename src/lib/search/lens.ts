import "server-only";
import type { LensProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveLens: LensProvider = {
  async search() {
    // TODO(Shopping): agree on temporary image transport, call server-side SerpApi
    // Google Lens, validate results and expose candidates via this interface.
    return notImplemented("Google Lens");
  },
};
