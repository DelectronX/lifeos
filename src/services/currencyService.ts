import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { todayKey } from '@/lib/date';
import type { CurrencyTransaction, ID, XPTransaction } from '@/types';

/**
 * Reward currency — a ledger DISTINCT from XP.
 *
 * XP drives levels and progression; currency is what redeemable rewards cost.
 * Currency is minted from banked XP at `xp.rewardCurrencyPerXP` (data, set in
 * Settings → Scheduling config), so it can only ever come from real, deduped,
 * capped XP events. Every row has a unique dedupe key:
 *   mint:<xpTransactionId>   — one mint per XP transaction, ever
 *   redeem:<earningId>       — one debit per redemption
 * Revoking the XP for an undone event also revokes the currency it minted.
 */

export async function currencyBalance(): Promise<number> {
  const rows = await db.currency.toArray();
  return rows.reduce((s, r) => s + r.amount, 0);
}

async function syncProfile(): Promise<number> {
  const balance = await currencyBalance();
  const profile = await db.profile.get('profile');
  if (profile && profile.rewardBalance !== balance) {
    await db.profile.update('profile', { rewardBalance: balance, updatedAt: Date.now() });
  }
  return balance;
}

async function addRow(row: Omit<CurrencyTransaction, 'id' | 'createdAt' | 'updatedAt' | 'balanceAfter'>): Promise<CurrencyTransaction | null> {
  if (await db.currency.where('dedupeKey').equals(row.dedupeKey).first()) return null;
  const balanceAfter = (await currencyBalance()) + row.amount;
  const tx: CurrencyTransaction = {
    ...row,
    id: newId('cur'),
    createdAt: row.at,
    updatedAt: row.at,
    balanceAfter,
  };
  try {
    await db.currency.add(tx);
  } catch {
    return null; // lost a race on the unique key — already recorded
  }
  await syncProfile();
  return tx;
}

/** Mints currency for one banked XP transaction. No-op when the ratio is 0. */
export async function mintForXP(tx: XPTransaction, ratio: number): Promise<number> {
  if (!(ratio > 0) || tx.amount <= 0) return 0;
  const amount = Math.floor(tx.amount * ratio);
  if (amount <= 0) return 0;
  const row = await addRow({
    at: tx.at,
    date: tx.date,
    amount,
    reason: 'xp_earned',
    description: tx.description,
    sourceType: 'xp',
    sourceId: tx.id,
    dedupeKey: `mint:${tx.id}`,
  });
  return row?.amount ?? 0;
}

/** Removes currency minted by XP transactions that were revoked. */
export async function revokeMintsFor(xpTransactionIds: readonly ID[]): Promise<number> {
  if (xpTransactionIds.length === 0) return 0;
  const keys = xpTransactionIds.map((id) => `mint:${id}`);
  const rows = await db.currency.where('dedupeKey').anyOf(keys).toArray();
  if (rows.length === 0) return 0;
  await db.currency.bulkDelete(rows.map((r) => r.id));
  await syncProfile();
  return rows.reduce((s, r) => s + r.amount, 0);
}

export interface SpendOutcome {
  ok: boolean;
  balance: number;
  message: string;
}

/** Debits currency for a redemption. Refuses when the balance is short. */
export async function spend(
  amount: number,
  dedupeKey: string,
  description: string,
  sourceId: ID | null,
  at = Date.now(),
): Promise<SpendOutcome> {
  const balance = await currencyBalance();
  if (!(amount > 0)) return { ok: false, balance, message: 'This reward has no price set.' };
  if (balance < amount) {
    return { ok: false, balance, message: `Needs ${amount}, you have ${balance}.` };
  }
  const row = await addRow({
    at, date: todayKey(at), amount: -amount, reason: 'reward_redeemed', description,
    sourceType: 'reward_earning', sourceId, dedupeKey,
  });
  if (!row) return { ok: false, balance, message: 'Already redeemed.' };
  return { ok: true, balance: row.balanceAfter, message: `Spent ${amount}. Balance ${row.balanceAfter}.` };
}

/** Refunds a redemption (undo). */
export async function refund(dedupeKey: string): Promise<number> {
  const row = await db.currency.where('dedupeKey').equals(dedupeKey).first();
  if (!row) return 0;
  await db.currency.delete(row.id);
  await syncProfile();
  return -row.amount;
}

export async function recentCurrency(limit = 50): Promise<CurrencyTransaction[]> {
  return db.currency.orderBy('at').reverse().limit(limit).toArray();
}
