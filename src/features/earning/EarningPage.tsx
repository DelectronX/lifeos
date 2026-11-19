import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InsetGroup, MetricTile, Row, money } from '@/components/ui/Grouped';
import { db } from '@/db/db';
import { addDaysToKey, formatDateKeyShort, relativeDayLabel, todayKey } from '@/lib/date';
import { cn } from '@/lib/cn';
import { toast } from '@/state/toastStore';
import { createProject } from '@/services/projectService';
import { PIPELINE_STAGES, balanceDue, earningSummary, isOverdue, isPartiallyPaid, paidSoFar } from '@/engines/workgrowth';
import { BarChart } from '@/components/charts/BarChart';
import {
  addMoney, createContact, deleteContact, deleteMoney, deletePayment, logInteraction, markPaid, recordPayment, setContactStage, updateContact,
} from '@/services/workgrowthService';
import type { Contact, ContactInteraction, ContactStage, MoneyEntry, MoneyStatus } from '@/types/workgrowth';

type Tab = 'overview' | 'clients' | 'ledger';
const STAGE_LABEL: Record<ContactStage, string> = {
  lead: 'Lead', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal sent', negotiation: 'Negotiating',
  won: 'Won', client: 'Client', lost: 'Lost',
};
const INCOME_CATEGORIES = ['Freelance', 'Client retainer', 'Consulting', 'Templates & products', 'App revenue', 'Content & ads', 'Affiliate', 'Interest & dividends', 'Prize / scholarship', 'Other'];
const EXPENSE_CATEGORIES = ['Software & tools', 'Hosting & domains', 'Hardware', 'Courses', 'Marketing', 'Fees & taxes', 'Other'];

function monthBounds(date: string) {
  const from = `${date.slice(0, 7)}-01`;
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0);
  return { from, to: addDaysToKey(from, d.getDate() - 1) };
}

export function EarningPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [sheet, setSheet] = useState<'income' | 'expense' | 'contact' | null>(null);
  const [openContact, setOpenContact] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const entries = useLiveQuery(() => db.money.orderBy('date').reverse().toArray(), []) ?? [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) ?? [];
  const profile = useLiveQuery(() => db.profile.toCollection().first(), []);
  const currency = (profile as { currency?: string } | undefined)?.currency ?? entries[0]?.currency ?? 'INR';
  const today = todayKey();
  const { from, to } = monthBounds(today);
  const month = useMemo(() => earningSummary(entries, contacts, from, to, today, currency), [entries, contacts, from, to, today, currency]);
  const year = useMemo(() => earningSummary(entries, contacts, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`, today, currency), [entries, contacts, today, currency]);

  return (
    <Page
      title="Earning"
      subtitle="Clients, freelance pipeline and every rupee in or out: active and passive income kept apart."
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSheet('contact')}>New lead</Button>
          <Button variant="secondary" onClick={() => setSheet('expense')}>Expense</Button>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setSheet('income')}>Income</Button>
        </div>
      )}
    >
      <div className="mb-6 max-w-md">
        <SegmentedControl aria-label="Section" fullWidth value={tab} onChange={setTab}
          items={[{ value: 'overview', label: 'Overview' }, { value: 'clients', label: `Clients${contacts.length ? ` ${contacts.length}` : ''}` }, { value: 'ledger', label: 'Ledger' }]} />
      </div>

      {tab === 'overview' ? <Overview month={month} year={year} entries={entries} contacts={contacts} today={today} onContact={setOpenContact} onPay={setPayFor} /> : null}
      {tab === 'clients' ? <Pipeline contacts={contacts} currency={currency} onOpen={setOpenContact} onNew={() => setSheet('contact')} /> : null}
      {tab === 'ledger' ? <Ledger entries={entries} contacts={contacts} today={today} onNew={() => setSheet('income')} onPay={setPayFor} /> : null}
      {payFor ? <PaymentSheet entry={entries.find((e) => e.id === payFor)} onClose={() => setPayFor(null)} /> : null}

      {sheet === 'income' || sheet === 'expense' ? <MoneySheet direction={sheet} currency={currency} contacts={contacts} onClose={() => setSheet(null)} /> : null}
      {sheet === 'contact' ? <ContactSheet onClose={() => setSheet(null)} /> : null}
      {openContact ? <ContactDetail contact={contacts.find((c) => c.id === openContact)} entries={entries} currency={currency} onClose={() => setOpenContact(null)} /> : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ */

function Overview({
  month, year, entries, contacts, today, onContact, onPay,
}: {
  onPay: (id: string) => void;
  month: ReturnType<typeof earningSummary>;
  year: ReturnType<typeof earningSummary>;
  entries: MoneyEntry[];
  contacts: Contact[];
  today: string;
  onContact: (id: string) => void;
}) {
  const c = month.currency;
  const followUps = contacts.filter((x) => x.nextFollowUp && x.nextFollowUp <= addDaysToKey(today, 7) && x.stage !== 'lost')
    .sort((a, b) => (a.nextFollowUp! < b.nextFollowUp! ? -1 : 1));
  const overdue = entries.filter((e) => isOverdue(e, today));
  const passiveShare = month.revenue ? month.passiveRevenue / month.revenue : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Earned this month" value={money(month.revenue, c)} caption={`${money(year.revenue, c)} this year`} tone="accent" />
        <MetricTile label="Active · Passive" value={`${money(month.activeRevenue, c)} · ${money(month.passiveRevenue, c)}`} caption={`${Math.round(passiveShare * 100)}% passive`} />
        <MetricTile label="Profit this month" value={money(month.profit, c)} caption={`${money(month.expenses, c)} spent`} tone={month.profit < 0 ? 'critical' : 'positive'} />
        <MetricTile label="Outstanding" value={money(month.outstanding, c)} caption={month.overdueCount ? `${month.overdueCount} overdue` : 'nothing overdue'} tone={month.overdueCount ? 'caution' : 'default'} />
        <MetricTile label="Weighted pipeline" value={money(month.pipelineValue, c)} caption={`${month.openDeals} open deals`} />
        <MetricTile label="Clients" value={month.clients} caption={month.winRate !== null ? `${Math.round(month.winRate * 100)}% win rate` : 'no closed deals yet'} />
        <MetricTile label="Effective rate" value={year.effectiveHourlyRate ? `${money(year.effectiveHourlyRate, c)}/h` : '—'} caption="paid income ÷ logged hours, this year" />
        <MetricTile label="Follow-ups due" value={month.followUpsDue} tone={month.followUpsDue ? 'caution' : 'default'} />
      </div>

      <InsetGroup header="This year" footer="Money actually received or spent, by month. Instalments count in the month they arrived.">
        {year.byMonth.length === 0 ? <Row title={<span className="text-ink-muted">No payments yet.</span>} /> : (
          <div className="px-4 pb-3 pt-4">
            <BarChart
              ariaLabel="Monthly income and expenses"
              format={(n) => money(n, c)}
              series={[{ key: 'income', label: 'In', color: 'rgb(var(--c-accent))' }, { key: 'expenses', label: 'Out', color: 'rgb(var(--c-ink) / 0.28)' }]}
              data={[...year.byMonth].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
                label: new Date(`${m.month}-01T00:00`).toLocaleString(undefined, { month: 'short' }),
                values: { income: m.income, expenses: m.expenses },
              }))}
            />
          </div>
        )}
      </InsetGroup>

      <div className="grid gap-6 lg:grid-cols-2">
        <InsetGroup header="Follow-ups · next 7 days">
          {followUps.length === 0 ? <Row title={<span className="text-ink-muted">Nothing due.</span>} /> : followUps.map((x) => (
            <Row key={x.id} chevron onClick={() => onContact(x.id)} title={x.name}
              subtitle={`${STAGE_LABEL[x.stage]}${x.company ? ` · ${x.company}` : ''}`}
              trailing={<span className={cn(x.nextFollowUp! < today && 'text-critical')}>{relativeDayLabel(x.nextFollowUp!, today)}</span>} />
          ))}
        </InsetGroup>
        <InsetGroup header="Overdue invoices">
          {overdue.length === 0 ? <Row title={<span className="text-ink-muted">All paid up.</span>} /> : overdue.map((e) => (
            <Row key={e.id} title={e.description || e.category}
              subtitle={<PaidMeter entry={e} prefix={e.dueDate ? `Due ${formatDateKeyShort(e.dueDate)}` : undefined} />}
              trailing={<><span className="tabular text-critical">{money(balanceDue(e), e.currency)}</span><Button size="xs" onClick={() => onPay(e.id)}>Record payment</Button></>} />
          ))}
        </InsetGroup>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Pipeline({ contacts, currency, onOpen, onNew }: { contacts: Contact[]; currency: string; onOpen: (id: string) => void; onNew: () => void }) {
  if (contacts.length === 0) {
    return <EmptyState icon={<Briefcase className="h-6 w-6" />} title="No leads or clients yet"
      description="Track every lead from first message to signed client, with follow-up dates and a timeline."
      action={<Button variant="primary" onClick={onNew}>Add a lead</Button>} />;
  }
  const columns: ContactStage[] = [...PIPELINE_STAGES, 'client', 'lost'];
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map((stage) => {
          const list = contacts.filter((c) => c.stage === stage);
          const value = list.reduce((s, c) => s + (c.dealValue ?? 0), 0);
          return (
            <div key={stage} className="w-64 shrink-0">
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className="t-label">{STAGE_LABEL[stage]} · {list.length}</span>
                {value ? <span className="text-[0.75rem] tabular text-ink-faint">{money(value, currency)}</span> : null}
              </div>
              <div className="space-y-2">
                {list.map((c) => (
                  <button key={c.id} type="button" onClick={() => onOpen(c.id)}
                    className="w-full rounded-xl bg-surface-raised px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken/60">
                    <div className="truncate text-[0.9375rem] text-ink">{c.name}</div>
                    <div className="truncate text-[0.75rem] text-ink-muted">{[c.company, c.service].filter(Boolean).join(' · ') || c.source || '—'}</div>
                    <div className="mt-1 flex justify-between text-[0.75rem] text-ink-faint tabular">
                      <span>{c.dealValue ? money(c.dealValue, currency) : ''}</span>
                      <span>{c.nextFollowUp ? `↻ ${formatDateKeyShort(c.nextFollowUp)}` : ''}</span>
                    </div>
                  </button>
                ))}
                {list.length === 0 ? <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[0.75rem] text-ink-faint">Empty</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Ledger({ entries, contacts, today, onNew, onPay }: { entries: MoneyEntry[]; contacts: Contact[]; today: string; onNew: () => void; onPay: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'active' | 'passive' | 'expense' | 'unpaid'>('all');
  const shown = entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'expense') return e.direction === 'expense';
    if (filter === 'unpaid') return e.direction === 'income' && e.status !== 'cancelled' && balanceDue(e) > 0;
    return e.direction === 'income' && (e.stream ?? 'active') === filter;
  });
  const byMonth = new Map<string, MoneyEntry[]>();
  for (const e of shown) byMonth.set(e.date.slice(0, 7), [...(byMonth.get(e.date.slice(0, 7)) ?? []), e]);
  const name = (id?: string | null) => contacts.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-6">
      <SegmentedControl aria-label="Filter" value={filter} onChange={setFilter} size="sm"
        items={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'passive', label: 'Passive' }, { value: 'expense', label: 'Expenses' }, { value: 'unpaid', label: 'Unpaid' }]} />
      {shown.length === 0 ? <EmptyState title="No entries" action={<Button variant="primary" onClick={onNew}>Record income</Button>} /> : null}
      {[...byMonth.entries()].map(([m, list]) => (
        <InsetGroup key={m} header={new Date(`${m}-01T00:00`).toLocaleString(undefined, { month: 'long', year: 'numeric' })}>
          {list.map((e) => (
            <Row key={e.id}
              title={e.description || e.category}
              subtitle={(
                <>
                  {[formatDateKeyShort(e.date), e.category, e.direction === 'income' ? (e.stream === 'passive' ? 'Passive' : 'Active') : null, name(e.contactId), e.hours ? `${e.hours} h` : null, e.status !== 'paid' ? (isOverdue(e, today) ? 'Overdue' : isPartiallyPaid(e) ? 'Part-paid' : e.status) : null].filter(Boolean).join(' · ')}
                  {e.status !== 'paid' && e.status !== 'cancelled' && e.direction === 'income' ? <PaidMeter entry={e} /> : null}
                </>
              )}
              onClick={e.payments?.length || (e.status !== 'paid' && e.status !== 'cancelled') ? () => onPay(e.id) : undefined}
              trailing={(
                <>
                  {e.direction === 'income' && e.status !== 'paid' && e.status !== 'cancelled' ? (
                    <>
                      <Button size="xs" variant="subtle" onClick={(ev) => { ev.stopPropagation(); onPay(e.id); }}>Payment</Button>
                      <Button size="xs" onClick={(ev) => { ev.stopPropagation(); void markPaid(e.id); }}>Paid</Button>
                    </>
                  ) : null}
                  <span className={cn('tabular', e.direction === 'income' ? (e.status === 'paid' ? 'text-positive' : 'text-ink-muted') : 'text-ink')}>
                    {e.direction === 'income' ? '+' : '−'}{money(e.amount, e.currency)}
                  </span>
                  <IconButton label="Delete entry" size="xs" variant="ghost" onClick={(ev) => { ev.stopPropagation(); void deleteMoney(e.id); }}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </>
              )} />
          ))}
        </InsetGroup>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MoneySheet({ direction, currency, contacts, onClose }: { direction: 'income' | 'expense'; currency: string; contacts: Contact[]; onClose: () => void }) {
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(direction === 'income' ? INCOME_CATEGORIES[0]! : EXPENSE_CATEGORIES[0]!);
  const [stream, setStream] = useState<'active' | 'passive'>('active');
  const [status, setStatus] = useState<MoneyStatus>('paid');
  const [date, setDate] = useState(todayKey());
  const [dueDate, setDueDate] = useState('');
  const [contactId, setContactId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [hours, setHours] = useState('');
  const valid = Number(amount) > 0;

  const save = async () => {
    await addMoney({
      direction, amount: Number(amount), currency, description: description.trim(), category, date,
      stream: direction === 'income' ? stream : undefined, status: direction === 'income' ? status : 'paid',
      dueDate: status === 'invoiced' ? dueDate || null : null, contactId: contactId || null, projectId: projectId || null,
      hours: Number(hours) > 0 ? Number(hours) : undefined,
    });
    toast.success(direction === 'income' ? 'Income recorded' : 'Expense recorded');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={direction === 'income' ? 'Record income' : 'Record expense'} size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => void save()}>Save</Button></div>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${currency})`} required><Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={direction === 'income' ? 'Landing page for Acme' : 'Domain renewal'} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {(direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          {direction === 'income' ? (
            <Field label="Stream" hint="Active = paid for your time. Passive = earns without it.">
              <SegmentedControl aria-label="Stream" fullWidth value={stream} onChange={setStream} items={[{ value: 'active', label: 'Active' }, { value: 'passive', label: 'Passive' }]} />
            </Field>
          ) : null}
        </div>
        {direction === 'income' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as MoneyStatus)}>
                <option value="paid">Paid</option><option value="invoiced">Invoiced</option><option value="expected">Expected</option>
              </Select>
            </Field>
            {status === 'invoiced' ? <Field label="Due"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field> : null}
            {stream === 'active' ? <Field label="Hours billed"><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} /></Field> : null}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client"><Select value={contactId} onChange={(e) => setContactId(e.target.value)}><option value="">None</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Project"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
        </div>
      </div>
    </Modal>
  );
}

function ContactSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [service, setService] = useState('');
  const [source, setSource] = useState('');
  const [email, setEmail] = useState('');
  const [deal, setDeal] = useState('');
  const [followUp, setFollowUp] = useState(addDaysToKey(todayKey(), 2));
  const save = async () => {
    await createContact({
      name, company: company || undefined, service: service || undefined, source: source || undefined, email: email || undefined,
      dealValue: Number(deal) > 0 ? Number(deal) : undefined, nextFollowUp: followUp || null,
    });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="New lead" size="md"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>Add</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Service"><Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Website, app, security audit…" /></Field>
        <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Referral, LinkedIn, Upwork…" /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Deal value"><Input inputMode="decimal" value={deal} onChange={(e) => setDeal(e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
        <Field label="Follow up on"><Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ContactDetail({ contact, entries, currency, onClose }: { contact: Contact | undefined; entries: MoneyEntry[]; currency: string; onClose: () => void }) {
  const [kind, setKind] = useState<ContactInteraction['kind']>('message');
  const [summary, setSummary] = useState('');
  const [followUp, setFollowUp] = useState('');
  if (!contact) return null;
  const paid = entries.filter((e) => e.contactId === contact.id && e.direction === 'income' && e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  return (
    <Modal open onClose={onClose} title={contact.name} description={[contact.company, contact.service].filter(Boolean).join(' · ')} size="lg"
      footer={<div className="flex w-full justify-between"><Button variant="ghost" className="text-critical" onClick={() => void deleteContact(contact.id).then(onClose)}>Delete</Button><Button variant="primary" onClick={onClose}>Done</Button></div>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Stage">
            <Select value={contact.stage} onChange={(e) => void setContactStage(contact.id, e.target.value as ContactStage)}>
              {(Object.keys(STAGE_LABEL) as ContactStage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Deal value"><Input inputMode="decimal" defaultValue={contact.dealValue ?? ''} onBlur={(e) => void updateContact(contact.id, { dealValue: Number(e.target.value) || undefined })} /></Field>
          <Field label="Next follow-up"><Input type="date" value={contact.nextFollowUp ?? ''} onChange={(e) => void updateContact(contact.id, { nextFollowUp: e.target.value || null })} /></Field>
        </div>
        {(contact.stage === 'won' || contact.stage === 'client') ? <ClientProjectRow contact={contact} /> : null}
        <div className="grid grid-cols-2 gap-3">
          <MetricTile label="Paid to date" value={money(paid, currency)} tone="positive" />
          <MetricTile label="Touchpoints" value={contact.interactions.length} />
        </div>
        <form className="space-y-2" onSubmit={(e) => {
          e.preventDefault();
          if (!summary.trim()) return;
          void logInteraction(contact.id, kind, summary.trim(), followUp || undefined).then(() => { setSummary(''); setFollowUp(''); });
        }}>
          <div className="flex gap-2">
            <Select aria-label="Type" className="w-32" value={kind} onChange={(e) => setKind(e.target.value as ContactInteraction['kind'])}>
              {(['message', 'email', 'call', 'meeting', 'proposal', 'note'] as const).map((k) => <option key={k} value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>)}
            </Select>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened?" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] text-ink-muted">Follow up</span>
            <Input type="date" className="w-40" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!summary.trim()}>Log</Button>
          </div>
        </form>
        <InsetGroup header="Timeline">
          {contact.interactions.length === 0 ? <Row title={<span className="text-ink-muted">No activity yet.</span>} /> : contact.interactions.map((i) => (
            <Row key={i.id} title={i.summary} subtitle={`${i.kind} · ${new Date(i.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`} />
          ))}
        </InsetGroup>
        <Field label="Notes"><Textarea rows={3} defaultValue={contact.notes ?? ''} onBlur={(e) => void updateContact(contact.id, { notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** Won deal → client project (Workflow 2). The project's goal joins Tasks, Auto Plan and XP. */
function ClientProjectRow({ contact }: { contact: Contact }) {
  const projects = useLiveQuery(() => db.projects.where('clientId').equals(contact.id).toArray(), [contact.id]) ?? [];
  const navigate = useNavigate();
  if (projects.length) {
    return (
      <InsetGroup header="Projects">
        {projects.map((p) => <Row key={p.id} chevron onClick={() => navigate(`/projects/${p.id}`)} title={p.title} subtitle={p.status} />)}
      </InsetGroup>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3">
      <span className="text-[0.9375rem] text-accent-ink">Deal won — set up the delivery project?</span>
      <Button variant="primary" size="sm" onClick={async () => {
        if (contact.stage === 'won') await setContactStage(contact.id, 'client');
        const p = await createProject({
          title: `${contact.company || contact.name}${contact.service ? ` — ${contact.service}` : ''}`, kind: 'client', status: 'active',
          clientId: contact.id, milestones: ['Discovery & scope', 'First delivery', 'Revisions', 'Final handover', 'Invoice sent'],
          deliverables: ['Signed scope', 'Final files', 'Invoice'],
        });
        navigate(`/projects/${p.id}`);
      }}>Create project</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Partial payments                                                    */
/* ------------------------------------------------------------------ */

/** Thin paid-of-total meter shown under unpaid entries. */
function PaidMeter({ entry, prefix }: { entry: MoneyEntry; prefix?: string }) {
  const paid = paidSoFar(entry);
  const pct = entry.amount ? Math.min(100, (paid / entry.amount) * 100) : 0;
  return (
    <span className="mt-1 flex items-center gap-2">
      {prefix ? <span className="shrink-0">{prefix}</span> : null}
      <span className="relative h-1 w-24 overflow-hidden rounded-full bg-ink/10" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-positive transition-[width] duration-700 ease-calm" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular shrink-0 text-[0.6875rem]">{paid > 0 ? `${money(paid, entry.currency)} of ${money(entry.amount, entry.currency)}` : 'Nothing received'}</span>
    </span>
  );
}

/**
 * Record a partial payment against an entry: amount (defaults to what is
 * still owed), date, method, note. Lists earlier instalments with undo.
 */
function PaymentSheet({ entry, onClose }: { entry: MoneyEntry | undefined; onClose: () => void }) {
  const owed = entry ? balanceDue(entry) : 0;
  const [amount, setAmount] = useState(() => (owed ? String(owed) : ''));
  const [date, setDate] = useState(todayKey());
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!entry) return null;
  const paid = paidSoFar(entry);
  const pct = entry.amount ? Math.min(100, (paid / entry.amount) * 100) : 0;
  const n = Number(amount);
  const invalid = !(n > 0) || n > owed + 0.005;

  const save = async () => {
    setBusy(true);
    try {
      // The recorded instalment raises its own "Payment received" notification.
      await recordPayment(entry.id, { amount: n, date, method, note });
      onClose();
    } catch (e) {
      toast.error('Could not record payment', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Record a payment" description={entry.description || entry.category} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={invalid || busy || owed <= 0} onClick={() => void save()}>Record {n > 0 ? money(n, entry.currency) : ''}</Button></>}>
      <div className="mb-5">
        <div className="flex items-baseline justify-between">
          <span className="t-num text-[1.5rem] font-semibold text-ink">{money(paid, entry.currency)}</span>
          <span className="t-num text-[0.8125rem] text-ink-muted">of {money(entry.amount, entry.currency)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Paid so far">
          <div className="h-full rounded-full bg-positive transition-[width] duration-700 ease-calm" style={{ width: `${pct}%` }} />
        </div>
        <div className="t-meta mt-1.5">{owed > 0 ? `${money(owed, entry.currency)} still owed` : 'Fully paid'}</div>
      </div>

      {owed > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" error={n > owed + 0.005 ? `Max ${money(owed, entry.currency)}` : undefined}>
              <Input type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <Field label="Received on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Quick amounts">
            {[0.25, 0.5, 1].map((f) => (
              <button key={f} type="button" onClick={() => setAmount(String(Math.round(owed * f * 100) / 100))}
                className="pressable h-7 rounded-full bg-ink/[0.06] px-3 text-[0.75rem] font-medium text-ink-muted hover:text-ink">
                {f === 1 ? 'Full balance' : `${f * 100}%`}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method"><Input value={method} placeholder="UPI, bank, cash…" onChange={(e) => setMethod(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} placeholder="Advance, milestone 1…" onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </div>
      ) : null}

      {entry.payments?.length ? (
        <div className="mt-5">
          <div className="t-eyebrow mb-2">Instalments</div>
          <ol className="relative space-y-2 border-l border-line pl-4">
            {entry.payments.map((p) => (
              <li key={p.id} className="relative flex items-center gap-3">
                <span className="absolute -left-[21px] h-2.5 w-2.5 rounded-full bg-positive ring-4 ring-surface-overlay" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="t-num text-[0.875rem] font-medium text-ink">{money(p.amount, entry.currency)}</div>
                  <div className="t-meta truncate">{[formatDateKeyShort(p.date), p.method, p.note].filter(Boolean).join(' · ')}</div>
                </div>
                <IconButton label="Remove instalment" size="xs" variant="ghost" onClick={() => void deletePayment(entry.id, p.id)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Modal>
  );
}
