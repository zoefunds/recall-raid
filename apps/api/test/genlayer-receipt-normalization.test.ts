import { describe, expect, it } from "vitest";
import { normalizeGenLayerTransaction } from "../src/lib/genlayer.js";
import {
  assertSuccessfulFinalizedGenVmExecution,
} from "../src/lib/settlement-validation.js";

describe("StudioNet receipt normalization", () => {
  it("maps a finalized successful leader return into the settlement gate shape", () => {
    const receipt = normalizeGenLayerTransaction({
      status_name: "FINALIZED",
      result_name: "MAJORITY_AGREE",
      consensus_data: {
        leader_receipt: [{
          mode: "leader",
          execution_result: "SUCCESS",
          error: null,
          result: { status: "return" },
        }],
      },
    });

    expect(() => assertSuccessfulFinalizedGenVmExecution(receipt)).not.toThrow();
    expect(receipt.statusName).toBe("FINALIZED");
    expect(receipt.resultName).toBe("MAJORITY_AGREE");
  });

  it("rejects a finalized receipt whose GenVM execution returned an error", () => {
    const receipt = normalizeGenLayerTransaction({
      status_name: "FINALIZED",
      result_name: "MAJORITY_AGREE",
      consensus_data: {
        leader_receipt: [{
          mode: "leader",
          execution_result: "ERROR",
          error: "execution reverted",
          result: { status: "error" },
        }],
      },
    });

    expect(() => assertSuccessfulFinalizedGenVmExecution(receipt)).toThrow(/did not finish successfully/);
  });
});
