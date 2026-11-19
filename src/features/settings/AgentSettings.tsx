import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, CheckCircle2, Copy, PlugZap, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Toggle } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { db } from '@/db/db';
import { cn } from '@/lib/cn';
import { toast } from '@/state/toastStore';
import { OPERATIONS } from '@/agent/catalog';
import { useAgentBridge, type BridgeStatus } from '@/agent/bridgeClient';
import { relativeTime } from '@/components/system/relativeTime';
import { SettingRow, SettingsSection } from './SettingsSection';

const STATUS: Record<BridgeStatus, { label: string; cls: string }> = {
  off: { label: 'Off', cls: 'bg-ink/10 text-ink-muted' },
  connecting: { label: 'Connecting…', cls: 'bg-caution/15 text-caution' },
  connected: { label: 'Connected', cls: 'bg-positive/15 text-positive' },
  unreachable: { label: 'Server not running', cls: 'bg-caution/15 text-caution' },
  unauthorized: { label: 'Token needed', cls: 'bg-critical/15 text-critical' },
};

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`), () => toast.warning('Could not copy', text));
}

/** Settings → Agents: connect this window to the local MCP / REST server. */
export function AgentSettings() {
  const { prefs, status, detail, handled, lastOp, setPrefs } = useAgentBridge();
  const [token, setToken] = useState(prefs.token);
  const [url, setUrl] = useState(prefs.url);
  useEffect(() => { setToken(prefs.token); setUrl(prefs.url); }, [prefs.token, prefs.url]);
  const audit = useLiveQuery(() => db.auditLog.orderBy('at').reverse().limit(12).toArray(), []) ?? [];
  const s = STATUS[status];
  const counts = { read: OPERATIONS.filter((o) => o.kind === 'read').length, write: OPERATIONS.filter((o) => o.kind === 'write').length, destructive: OPERATIONS.filter((o) => o.kind === 'destructive').length };

  return (
    <>
      <SettingsSection
        title="Agent access"
        description={<>Let AI agents (Claude Desktop, Claude Code, Cursor, VS Code, any MCP client) operate LifeOS through the local <code className="text-ink">lifeos-agent</code> server on this PC. Agents use the same operations as this app, against the same data. Nothing leaves this computer.</>}
      >
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-md)] bg-ink/[0.04] px-3 py-2.5">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold', s.cls)}>
            {status === 'connected' ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === 'off' ? <Bot className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
            {s.label}
          </span>
          <span className="min-w-0 flex-1 text-[0.8125rem] text-ink-muted">
            {detail ?? (status === 'connected' ? `${handled} request${handled === 1 ? '' : 's'} handled this session${lastOp ? ` · last: ${lastOp.op} ${relativeTime(lastOp.at)}` : ''}` : status === 'off' ? 'Agents cannot see or change anything.' : '')}
          </span>
          {prefs.enabled && status !== 'connected' ? <Button size="sm" variant="secondary" iconLeft={<PlugZap className="h-3.5 w-3.5" />} onClick={() => setPrefs({})}>Retry</Button> : null}
        </div>
        <Toggle label="Allow agent access" description="Connect this window to the local agent server. Off by default." checked={prefs.enabled} onChange={(v) => setPrefs({ enabled: v })} />
        <SettingRow label="Access token" hint={<>Printed by <code>lifeos-agent token</code> (also in %LOCALAPPDATA%\LifeOS\agent.json). Stored only in this browser, never in backups.</>}>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" spellCheck={false} placeholder="lifeos_…" value={token} onChange={(e) => setToken(e.target.value.trim())} aria-label="Agent access token" />
            <Button size="sm" variant="secondary" disabled={token === prefs.token} onClick={() => setPrefs({ token })}>Save</Button>
          </div>
        </SettingRow>
        <SettingRow label="Server address" hint="Local only. Change only if you started the server on another port.">
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value.trim())} aria-label="Agent server address" spellCheck={false} />
            <Button size="sm" variant="secondary" disabled={url === prefs.url} onClick={() => setPrefs({ url })}>Save</Button>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Permissions"
        description="What a connected agent may do. The stricter of this and the server's own setting wins. Destructive operations also always require an explicit confirmation from the agent."
      >
        <SegmentedControl
          aria-label="Agent permission"
          fullWidth
          value={prefs.permission}
          onChange={(v) => setPrefs({ permission: v })}
          items={[{ value: 'read', label: 'Read only' }, { value: 'write', label: 'Read & edit' }, { value: 'full', label: 'Full (incl. delete)' }]}
        />
        <p className="t-meta flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          <span>{counts.read} read operations · {counts.write} edit operations · {counts.destructive} destructive operations. Every change an agent makes is recorded below and tagged as agent-made in your history.</span>
        </p>
        <Toggle label="Show a notification for each agent change" checked={prefs.announce} onChange={(v) => setPrefs({ announce: v })} />
      </SettingsSection>

      <SettingsSection title="Connect an agent" description="Start the server, then add LifeOS to your MCP client. Full guide: docs/AGENTS.md.">
        {[
          ['Start the server', 'scripts\\windows\\lifeos-agent-start.cmd'],
          ['Claude Code', 'claude mcp add lifeos -- node agent/dist/lifeos-agent.mjs mcp'],
          ['Claude Desktop / Cursor / VS Code config', 'node agent/dist/lifeos-agent.mjs config claude'],
          ['Check from a terminal', 'node agent/dist/lifeos-agent.mjs status'],
        ].map(([label, cmd]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[0.8125rem] text-ink-muted">{label}</div>
              <code className="block truncate text-[0.8125rem] text-ink">{cmd}</code>
            </div>
            <Button size="sm" variant="ghost" iconLeft={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(cmd!, label!)}>Copy</Button>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title="Recent agent activity" description="The audit log of changes made by agents (reads are not logged).">
        {audit.length === 0 ? <p className="t-meta">No agent changes yet.</p> : (
          <ul className="divide-y divide-line-faint">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1.5 text-[0.8125rem]">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', a.ok ? 'bg-positive' : 'bg-critical')} aria-label={a.ok ? 'Succeeded' : 'Failed'} />
                <code className="min-w-0 flex-1 truncate text-ink">{a.op}</code>
                {!a.ok ? <span className="shrink-0 text-[0.75rem] text-critical">{a.errorCode}</span> : null}
                <span className="shrink-0 text-[0.75rem] text-ink-faint">{a.client.replace(/^mcp:/, '')}</span>
                <span className="t-num shrink-0 text-[0.75rem] text-ink-faint">{relativeTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
}
