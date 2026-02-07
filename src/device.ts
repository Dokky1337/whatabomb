export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 800;
}

/** Trigger haptic feedback if supported (Android only — iOS has no Vibration API).
 * Pattern: number for single vibration, or [vibrate, pause, vibrate, ...] in ms.
 * Note: Very short durations (<20ms) may not be felt on some devices. */
export function haptic(pattern: number | number[] = 30): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Silently ignore - haptics not available
  }
}
