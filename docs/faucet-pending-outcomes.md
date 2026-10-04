# Faucet outcomes and cooldown ownership

A submission acknowledgement does not establish that a mint succeeded. The faucet keeps the acquired cooldown when a transaction may still settle and reports the transaction hash so the caller can inspect that submission.

Both the bulk faucet contract and the legacy per-token path use `submitFaucetMint`. The existing cooldown duration, Redis acquisition, and ownership-token release remain unchanged.

## Outcomes

| Outcome | HTTP response | Cooldown |
| --- | --- | --- |
| Preparation fails before submission | 500 | Released if no other mint succeeded or remains pending |
| Submission returns `ERROR` or `TRY_AGAIN_LATER` | 500 | Released if no other mint succeeded or remains pending |
| Transaction is confirmed `FAILED` | 500 | Released if no other mint succeeded or remains pending |
| Transaction is confirmed `SUCCESS` | 200 | Kept until its existing expiry |
| Submission reply is lost | 202, `success: false`, `pending: true`, locally computed hash | Kept until its existing expiry |
| A submitted transaction's status cannot be read | 202, `success: false`, `pending: true`, RPC hash | Kept until its existing expiry |
| Status remains `NOT_FOUND` after bounded polling | 202, `success: false`, `pending: true`, RPC hash | Kept until its existing expiry |

`DUPLICATE` submissions are checked for their final outcome too. Polling retains the existing maximum of 31 status reads and 30 one-second waits. The helper never submits a second transaction.

In legacy mode, the response retains each token's success, error, or pending result. Any pending token makes the overall response 202; confirmed successes remain present in `results`. If some tokens succeed and the rest definitively fail, the existing partial-result response remains 200 with `success: false`. An exception after a confirmed mint also preserves the reservation.

Clients should inspect `pending` and `success`, rather than treating every 2xx response as a confirmed mint. A pending response provides the existing transaction hash; it does not invite an immediate replacement submission. The existing cooldown is not extended by this change.

Stellar documents submission acknowledgements and statuses in the [sendTransaction API reference](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction).

## Focused reproduction

From a normal checkout with the web application's dependencies installed:

```sh
cd apps/web-app
npx vitest run src/lib/__tests__/faucetPending.test.ts
```

The 17 cases exercise the actual route, submission helper, and in-memory limiter. RPC and external framework boundaries are controlled mocks. Cases cover bulk and legacy paths, failed status reads, lost submission replies, polling timeout, duplicate acknowledgements, definitive rejection, on-chain failure, confirmed success, and mixed legacy outcomes.

On the original PR head `79845f236c246bcd10d1d4b2baf4cfa866f33ede` (route blob `77c908334359b156bdda9a1bd817af4ab17f30de`), these cases produced 11 failures and 6 passes. With the repair, all 17 pass. For a lost submission reply or failed status read, two requests produced the following controlled result:

| Measurement | Original route | Repaired route |
| --- | --- | --- |
| First response | 500 | 202 with pending result |
| Immediate second response | 500 | 429 |
| Mint submissions | 2 | 1 |

The local execution used Node 24.19.0 and Vitest 4.1.10. Temporary resolution aliases were used only for mocked external modules; the route, helper, and limiter were imported directly from source. The helper also passed strict TypeScript checking against Stellar SDK 12.3.0 declarations and Node 20 types.

This evidence is a controlled regression reproduction. It does not measure chain settlement time, production throughput, Redis availability, or a complete application build. The existing deployment check for shared Redis concurrency remains a separate acceptance step.
