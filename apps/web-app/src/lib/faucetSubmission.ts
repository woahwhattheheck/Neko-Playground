import type { rpc, Transaction } from "@stellar/stellar-sdk";

/** A submitted mint may still settle, so its cooldown must remain reserved. */
export class FaucetMintPendingError extends Error {
  readonly hash: string;

  constructor(hash: string) {
    super(
      "Mint outcome is not yet confirmed; check the existing transaction before retrying"
    );
    this.name = "FaucetMintPendingError";
    this.hash = hash;
  }
}

/** Submit once and distinguish a definitive failure from an unknown outcome. */
export async function submitFaucetMint(
  server: Pick<rpc.Server, "sendTransaction" | "getTransaction">,
  transaction: Transaction
): Promise<{ hash: string }> {
  // The local hash remains available even if the submission response is lost.
  const localHash = transaction.hash().toString("hex");
  let response: Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
  try {
    response = await server.sendTransaction(transaction);
  } catch {
    throw new FaucetMintPendingError(localHash);
  }

  if (response.status === "ERROR" || response.status === "TRY_AGAIN_LATER") {
    throw new Error(`Transaction not accepted: ${response.status}`);
  }

  const hash = response.hash;
  // PENDING and DUPLICATE both require the final on-chain result. An
  // acknowledgement, a missed status read, or NOT_FOUND is not mint success.
  for (let retries = 0; retries <= 30; retries++) {
    let result: Awaited<ReturnType<rpc.Server["getTransaction"]>>;
    try {
      result = await server.getTransaction(hash);
    } catch {
      throw new FaucetMintPendingError(hash);
    }

    if (result.status === "SUCCESS") return { hash };
    if (result.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
    if (retries < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new FaucetMintPendingError(hash);
}
