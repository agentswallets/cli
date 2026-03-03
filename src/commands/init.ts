import { CHAINS, getChain, resolveChainKey } from '../core/chains.js';
import { closeDb, ensureDataDir, getDb, initDbSchema, isInitialized } from '../core/db.js';
import { currentScryptParams, passwordVerifier } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { keychainAvailable, keychainSet } from '../core/keychain.js';
import { setSetting } from '../core/settings.js';
import { confirmAction, getNewMasterPassword, isNonInteractive } from '../util/agent-input.js';
import { getHomeDir } from '../core/config.js';
import { logAudit } from '../core/audit-service.js';

export async function initCommand(opts?: { chain?: string }): Promise<{
  data_dir: string;
  chain: string;
  supported_chains: string[];
}> {
  ensureDataDir();
  initDbSchema();

  if (isInitialized()) {
    // Allow switching default chain on already-initialized repos
    if (opts?.chain) {
      const chainKey = resolveChainKey(opts.chain);
      const chain = getChain(chainKey);
      setSetting('default_chain', chainKey);
      logAudit({ action: 'init.switch_chain', request: { chain: chainKey }, decision: 'ok', chain_name: chain.name, chain_id: chain.chainId });
      return { data_dir: getHomeDir(), chain: chain.name, supported_chains: Object.values(CHAINS).map(c => c.name) };
    }
    throw new AppError('ERR_INVALID_PARAMS', 'Already initialized. Use `aw init --chain <name>` to switch default chain.');
  }

  const chainKey = resolveChainKey(opts?.chain);
  const chain = getChain(chainKey);

  const p1 = await getNewMasterPassword();

  // P1-3: Atomic init — all settings written in one transaction
  const { salt, verifier } = passwordVerifier(p1);
  const db = getDb();
  db.transaction(() => {
    setSetting('master_password_salt', salt);
    setSetting('master_password_verifier', verifier);
    setSetting('master_password_kdf_params', JSON.stringify(currentScryptParams()));
    setSetting('chain_id', String(chain.chainId));
    setSetting('default_chain', chainKey);
    setSetting('initialized_at', new Date().toISOString());
  })();

  // Offer to save password to OS keychain in interactive mode
  if (!isNonInteractive() && keychainAvailable()) {
    try {
      const save = await confirmAction('Save to system keychain? (y/n): ');
      if (save) {
        keychainSet(p1);
      }
    } catch { /* non-critical, skip silently */ }
  }

  logAudit({ action: 'init', request: { chain: chainKey }, decision: 'ok', chain_name: chain.name, chain_id: chain.chainId });
  closeDb();
  return { data_dir: getHomeDir(), chain: chain.name, supported_chains: Object.values(CHAINS).map(c => c.name) };
}
