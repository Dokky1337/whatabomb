export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 800;
}

/** Trigger haptic feedback if supported. Duration in ms. */
export function haptic(pattern: number | number[] = 15): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Silently ignore - haptics not available
  }
}
