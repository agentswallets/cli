export interface ChainAdapter {
  getBalances(address: string): Promise<Record<string, string>>;
  send(params: {
    privateKey: Buffer;
    to: string;
    token: string;
    amount: string;
  }): Promise<{ txHash: string; status: string }>;
  waitForConfirmation(txHash: string, timeoutMs: number): Promise<{ status: string }>;
}
