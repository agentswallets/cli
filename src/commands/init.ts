import { CHAIN_ID, CHAIN_NAME } from '../core/constants.js';
import { closeDb, ensureDataDir, getDb, initDbSchema, isInitialized } from '../core/db.js';
import { currentScryptParams, passwordVerifier } from '../core/crypto.js';
import { AppError } from '../core/errors.js';
import { keychainAvailable, keychainSet } from '../core/keychain.js';
import { setSetting } from '../core/settings.js';
import { confirmAction, getNewMasterPassword, isNonInteractive } from '../util/agent-input.js';
import { getHomeDir } from '../core/config.js';
import { logAudit } from '../core/audit-service.js';

export async function initCommand(): Promise<{ data_dir: string; chain: string; chain_id: number }> {
  ensureDataDir();
  initDbSchema();

  if (isInitialized()) {
    throw new AppError('ERR_INVALID_PARAMS', 'Already initialized');
  }

  const p1 = await getNewMasterPassword();

  // P1-3: Atomic init — all settings written in one transaction
  const { salt, verifier } = passwordVerifier(p1);
  const db = getDb();
  db.transaction(() => {
    setSetting('master_password_salt', salt);
    setSetting('master_password_verifier', verifier);
    setSetting('master_password_kdf_params', JSON.stringify(currentScryptParams()));
    setSetting('chain_id', String(CHAIN_ID));
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

  logAudit({ action: 'init', request: {}, decision: 'ok' });
  closeDb();
  return { data_dir: getHomeDir(), chain: CHAIN_NAME, chain_id: CHAIN_ID };
}
