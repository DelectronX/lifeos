import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT_PORT, type PermissionLevel } from '../../src/agent/catalog';

/**
 * Local configuration: %LOCALAPPDATA%\LifeOS\agent.json (Windows) or
 * ~/.lifeos/agent.json elsewhere. Holds the bearer token (generated on first
 * run, never logged), the port and the server-side permission ceiling.
 */
export interface AgentConfig {
  token: string;
  port: number;
  host: string;
  permission: PermissionLevel;
  /** Seconds the app has to answer one request. */
  timeoutSeconds: number;
}

export function configDir(): string {
  const base = process.env.LIFEOS_AGENT_HOME
    ?? (process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'LifeOS') : join(homedir(), '.lifeos'));
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

export const configPath = () => join(configDir(), 'agent.json');
export const pidPath = () => join(configDir(), 'agent.pid');

export function newToken(): string {
  return `lifeos_${randomBytes(24).toString('base64url')}`;
}

export function loadConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  let stored: Partial<AgentConfig> = {};
  try { stored = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<AgentConfig>; } catch { /* first run */ }
  const cfg: AgentConfig = {
    token: process.env.LIFEOS_AGENT_TOKEN ?? stored.token ?? newToken(),
    port: Number(process.env.LIFEOS_AGENT_PORT ?? stored.port ?? DEFAULT_AGENT_PORT),
    host: stored.host ?? '127.0.0.1',
    permission: (process.env.LIFEOS_AGENT_PERMISSION as PermissionLevel | undefined) ?? stored.permission ?? 'write',
    timeoutSeconds: stored.timeoutSeconds ?? 30,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  };
  if (!stored.token || stored.port === undefined) saveConfig({ ...stored, ...cfg, token: stored.token ?? cfg.token });
  return cfg;
}

export function saveConfig(cfg: Partial<AgentConfig>): void {
  writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function rotateToken(): string {
  const cfg = loadConfig();
  const token = newToken();
  saveConfig({ ...cfg, token });
  return token;
}

export function writePid(): void { writeFileSync(pidPath(), String(process.pid)); }
export function readPid(): number | null {
  try { return Number(readFileSync(pidPath(), 'utf8').trim()) || null; } catch { return null; }
}
export function clearPid(): void { try { rmSync(pidPath()); } catch { /* already gone */ } }

export const requestId = () => randomUUID();
