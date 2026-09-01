export const THREAD_SCROLL_BOTTOM_THRESHOLD_PX = 96;

export function isNearThreadScrollBottom({
  scrollTop,
  clientHeight,
  scrollHeight,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return (
    scrollHeight - scrollTop - clientHeight <= THREAD_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

export function scrollThreadToLatest(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop">,
): void {
  element.scrollTop = element.scrollHeight;
}
