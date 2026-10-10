import "server-only";
import type { VerificationProvider } from "@/lib/providers/interfaces";
import { notImplemented } from "@/lib/errors";
export const liveVerification: VerificationProvider = {
  async verify() {
    // TODO(Shopping): verify candidate against model/variant evidence; user choice
    // alone must not be represented as independent visual confirmation.
    return notImplemented("Candidate verification");
  },
};
