import { describe, it, expect, vi } from 'vitest';
import { requestPersistentStorage } from './persist';

describe('requestPersistentStorage', () => {
  it('reports unsupported when the platform has no StorageManager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
  });

  it('reports unsupported when persist() is missing', async () => {
    expect(await requestPersistentStorage({ persisted: async () => false })).toBe('unsupported');
  });

  it('does not re-prompt when already persisted', async () => {
    const persist = vi.fn(async () => true);
    const result = await requestPersistentStorage({ persisted: async () => true, persist });
    expect(result).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests and reports persisted when the browser grants it', async () => {
    const persist = vi.fn(async () => true);
    const result = await requestPersistentStorage({ persisted: async () => false, persist });
    expect(result).toBe('persisted');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('reports denied when the browser declines', async () => {
    const result = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => false,
    });
    expect(result).toBe('denied');
  });

  it('requests even when persisted() is absent (older Storage API)', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persist })).toBe('persisted');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('never throws; a rejecting API resolves to denied', async () => {
    const result = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('boom');
      },
    });
    expect(result).toBe('denied');
  });
});
