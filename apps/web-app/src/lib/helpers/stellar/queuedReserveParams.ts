import { Contract, scValToNative, xdr } from "@stellar/stellar-sdk";
import { rpcUrl } from "@/lib/constants/network";
import { getSorobanServer } from "./sorobanServer";

export interface QueuedReserveParamState {
  asset: string;
  unlockTime: number;
}

function queuedReserveConfigKey(asset: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("QueuedReserveConfig"),
    xdr.ScVal.scvSymbol(asset),
  ]);
}

function getUnlockTime(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).unlock_time;
  if (typeof candidate !== "number" && typeof candidate !== "bigint") {
    return null;
  }
  const unlockTime = Number(candidate);
  return Number.isSafeInteger(unlockTime) && unlockTime > 0 ? unlockTime : null;
}

export async function getQueuedReserveParams(
  contractId: string,
  assets: readonly string[]
): Promise<QueuedReserveParamState[]> {
  const server = getSorobanServer(rpcUrl);
  const results = await Promise.all(
    Array.from(new Set(assets)).map(async (asset) => {
      const key = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: new Contract(contractId).address().toScAddress(),
          key: queuedReserveConfigKey(asset),
          durability: xdr.ContractDataDurability.temporary(),
        })
      );

      // SDK 14.4.3 getContractData turns every lookup failure into code 404.
      // Only a successful empty ledger lookup means this asset has no queue.
      const { entries } = await server.getLedgerEntries(key);
      if (!Array.isArray(entries)) {
        throw new Error("Queued reserve lookup did not return ledger entries");
      }
      if (entries.length === 0) return null;
      if (
        entries.length !== 1 ||
        entries[0].key.toXDR("base64") !== key.toXDR("base64")
      ) {
        throw new Error(
          `Queued reserve lookup returned an unexpected key for ${asset}`
        );
      }

      const config = scValToNative(entries[0].val.contractData().val());
      const unlockTime = getUnlockTime(config);
      if (unlockTime === null) {
        throw new Error(
          `Queued reserve config for ${asset} did not contain unlock_time`
        );
      }
      return { asset, unlockTime };
    })
  );

  return results
    .filter((entry): entry is QueuedReserveParamState => entry !== null)
    .sort((a, b) => a.asset.localeCompare(b.asset));
}
