import { type Address } from 'viem';

export interface FaucetResult {
  ok: boolean;
  txHash?: string;
  message?: string;
}

/**
 * Ask the sellbonds.now testnet dispenser to send a small amount of Base Sepolia
 * ETH to `address` (just enough gas to bootstrap). The dispenser is a hosted
 * relay that pays gas from a funded hot wallet; it never touches the agent's key.
 */
export async function requestEthFromFaucet(faucetUrl: string, address: Address): Promise<FaucetResult> {
  try {
    const res = await fetch(faucetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      return { ok: false, message: body?.error || body?.message || `faucet returned ${res.status}` };
    }
    return { ok: true, txHash: body?.txHash, message: body?.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
