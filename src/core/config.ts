import os from 'node:os';
import path from 'node:path';

export function getHomeDir(): string {
  return process.env.AGENTSWALLETS_HOME || path.join(os.homedir(), '.agentswallets');
}

export function getDbPath(): string {
  return path.join(getHomeDir(), 'data.sqlite');
}

export function getSessionPath(): string {
  return path.join(getHomeDir(), 'session.json');
}

export function getSessionTokenPath(): string {
  return path.join(getHomeDir(), 'session-token');
}
