/**
 * Matches the plain-language way people actually ask to keep going:
 * "continue", "resume", "keep going", "carry on" — with or without more
 * words after it ("continue on the UI", "continue write code"). This is
 * what makes typing "continue" resume the actual unfinished task instead
 * of Task Factory building a brand-new DAG from scratch and re-deriving
 * requirements/design it already has — see `orchestrator/master-
 * orchestrator.ts`'s `resume()`.
 */
export function isContinueTrigger(taskText: string): boolean {
  return /^(continue|resume|keep going|carry on)\b/i.test(taskText.trim());
}
