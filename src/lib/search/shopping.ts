import "server-only";
import type { ShoppingProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveShopping: ShoppingProvider = {
  async search() {
    // TODO(ProductSearch): SerpApi Shopping, exact variant verification, normalized offers.
    return notImplemented("Google Shopping");
  },
};
