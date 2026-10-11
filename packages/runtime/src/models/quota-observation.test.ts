import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutopilotStateStore, getProvider } from '@beyonder/compute';
import { AutopilotQuotaSource } from './quota.js';

describe('live provider quota observations', () => {
  it('uses Groq response rate headers as volatile quota state without treating missing headers as zero', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'beyonder-quota-')), 'state.json');
    const source = new AutopilotQuotaSource(path);
    expect((await source.get('groq', 'openai/gpt-oss-120b')).requestQuotaRemaining).toBe('unknown');
    source.observe('groq', 'openai/gpt-oss-120b', new Headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '60s' }));
    const observed = await source.get('groq', 'openai/gpt-oss-120b');
    expect(observed.requestQuotaRemaining).toBe(0);
    expect(Date.parse(observed.resetAt)).toBeGreaterThan(Date.now());
    expect((await source.get('groq', 'openai/gpt-oss-20b')).requestQuotaRemaining).toBe('unknown');
  });
  it('uses one inventory snapshot for ranking and reads updated quota before execution', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'beyonder-quota-snapshot-')), 'state.json');
    const store = new AutopilotStateStore(path);
    const source = new AutopilotQuotaSource(path);
    const snapshot = await store.read();
    await store.update(getProvider('groq')!, 'READY', { validation: { status: 'validated', rateLimitHeaders: { 'x-ratelimit-remaining-requests': '7' } } });
    expect(source.getFromState('groq', 'openai/gpt-oss-120b', snapshot).requestQuotaRemaining).toBe('unknown');
    expect((await source.get('groq', 'openai/gpt-oss-120b')).requestQuotaRemaining).toBe(7);
  });
});
