// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:30:15.625Z | xcoder:subtask code-st-8f12c6
/**
 * Single-use approval inbox shared by the daemon and the CLI verbs.
 * Approvals are keyed by decisionId and deleted on read, so a replayed id
 * cannot authorise a second block.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApprovalVerdict } from './approval-gate.js';

interface InboxEntry {
  verdict: ApprovalVerdict;
  decidedAt: string;
}

async function readAll(inboxPath: string): Promise<Record<string, InboxEntry>> {
  try {
    const text = await readFile(inboxPath, 'utf8');
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, InboxEntry>;
  } catch {
    return {};
  }
  return {};
}

/** Record an operator verdict (called by the CLI verbs). */
export async function recordVerdict(
  inboxPath: string,
  decisionId: string,
  verdict: 'granted' | 'denied',
): Promise<void> {
  const all = await readAll(inboxPath);
  all[decisionId] = { verdict, decidedAt: new Date().toISOString() };
  const target = path.resolve(inboxPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target + '.tmp', JSON.stringify(all), 'utf8');
  await rename(target + '.tmp', target);
}

/** Read-and-delete: an approval is single use. */
export async function consumeVerdict(inboxPath: string, decisionId: string): Promise<ApprovalVerdict | null> {
  const all = await readAll(inboxPath);
  const entry = all[decisionId];
  if (!entry) return null;
  delete all[decisionId];
  try {
    const target = path.resolve(inboxPath);
    await writeFile(target + '.tmp', JSON.stringify(all), 'utf8');
    await rename(target + '.tmp', target);
  } catch {
    await unlink(inboxPath).catch(() => {});
  }
  return entry.verdict;
}
