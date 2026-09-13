// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFocusPassword, hasFocusPassword, MIN_FOCUS_PASSWORD_LENGTH, setFocusPassword,
  validateFocusPassword, verifyFocusPassword,
} from '@/services/focusLockService';

describe('focusLockService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports no password set on a fresh install', async () => {
    expect(await hasFocusPassword()).toBe(false);
  });

  it('rejects a password shorter than the minimum length', async () => {
    const result = await setFocusPassword('abc');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(await hasFocusPassword()).toBe(false);
  });

  it('validateFocusPassword mirrors the same rule used by setFocusPassword', () => {
    expect(validateFocusPassword('a'.repeat(MIN_FOCUS_PASSWORD_LENGTH - 1))).toBeTruthy();
    expect(validateFocusPassword('a'.repeat(MIN_FOCUS_PASSWORD_LENGTH))).toBeNull();
  });

  it('sets a password and verifies the correct password', async () => {
    const result = await setFocusPassword('correct-horse');
    expect(result.ok).toBe(true);
    expect(await hasFocusPassword()).toBe(true);
    expect(await verifyFocusPassword('correct-horse')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    await setFocusPassword('correct-horse');
    expect(await verifyFocusPassword('wrong-password')).toBe(false);
  });

  it('verifying with no password set ever returns false, never throws', async () => {
    expect(await verifyFocusPassword('anything')).toBe(false);
  });

  it('never stores the plaintext password anywhere in the persisted value', async () => {
    await setFocusPassword('super-secret-plaintext');
    const raw = localStorage.getItem('lifeos.focusLock.v1');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('super-secret-plaintext');
  });

  it('changing the password invalidates the old one', async () => {
    await setFocusPassword('first-password');
    await setFocusPassword('second-password');
    expect(await verifyFocusPassword('first-password')).toBe(false);
    expect(await verifyFocusPassword('second-password')).toBe(true);
  });

  it('re-setting the same password produces a different stored hash (fresh salt)', async () => {
    await setFocusPassword('same-password');
    const first = localStorage.getItem('lifeos.focusLock.v1');
    await setFocusPassword('same-password');
    const second = localStorage.getItem('lifeos.focusLock.v1');
    expect(first).not.toEqual(second);
    expect(await verifyFocusPassword('same-password')).toBe(true);
  });

  it('clearFocusPassword removes the password entirely', async () => {
    await setFocusPassword('to-be-cleared');
    expect(await hasFocusPassword()).toBe(true);
    await clearFocusPassword();
    expect(await hasFocusPassword()).toBe(false);
    expect(await verifyFocusPassword('to-be-cleared')).toBe(false);
  });

  it('clearing when nothing is set is a safe no-op', async () => {
    await clearFocusPassword();
    expect(await hasFocusPassword()).toBe(false);
  });
});
