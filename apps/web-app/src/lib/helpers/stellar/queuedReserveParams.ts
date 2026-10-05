import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
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

function isMissingContractData(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return Number((error as { code?: unknown }).code) === 404;
}

export async function getQueuedReserveParams(
  contractId: string,
  assets: readonly string[]
): Promise<QueuedReserveParamState[]> {
  const server = getSorobanServer(rpcUrl);
  const results = await Promise.all(
    Array.from(new Set(assets)).map(async (asset) => {
      try {
        const entry = await server.getContractData(
          contractId,
          queuedReserveConfigKey(asset),
          rpc.Durability.Temporary
        );
        const config = scValToNative(entry.val.contractData().val());
        const unlockTime = getUnlockTime(config);
        if (unlockTime === null) {
          throw new Error(
            `Queued reserve config for ${asset} did not contain unlock_time`
          );
        }
        return { asset, unlockTime };
      } catch (error) {
        if (isMissingContractData(error)) return null;
        throw error;
      }
    })
  );

  return results
    .filter((entry): entry is QueuedReserveParamState => entry !== null)
    .sort((a, b) => a.asset.localeCompare(b.asset));
}
