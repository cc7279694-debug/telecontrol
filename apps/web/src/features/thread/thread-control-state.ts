export type ThreadControlState = "idle" | "running" | "unknown";

export function isThreadComposerDisabled({
  online,
  pending,
  readOnly,
  state,
}: {
  online: boolean;
  pending: boolean;
  readOnly: boolean;
  state: ThreadControlState;
}): boolean {
  return !online || pending || (readOnly && state === "running");
}
