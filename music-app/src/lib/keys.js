/**
 * Enter-to-submit that does not break IME typing.
 *
 * Input methods (IMEs) — Japanese, Chinese and Korean, and the transliteration
 * IMEs used to type Tamil or Hindi — use Enter to confirm the word being
 * composed, and that keydown still reports `key === 'Enter'`. A bare check
 * would search for, or save a playlist as, the half-typed word.
 *
 * `isComposing` flags that keydown directly. `keyCode === 229` covers Safari,
 * which delivers `compositionend` before the confirming keydown (WebKit bug
 * 165004), so `isComposing` already reads false there. The 229 test only runs
 * once the key is known to be Enter, so virtual keyboards that report 229 for
 * ordinary letters are unaffected.
 *
 * Guidance: `npx -y modern-web-guidance@latest retrieve "ime-safe-enter-submit"`.
 *
 * Accepts a React synthetic event or a native KeyboardEvent.
 */
export function isSubmitEnter(event) {
  if (event.key !== 'Enter') return false
  const native = event.nativeEvent ?? event
  return !(native.isComposing || event.keyCode === 229)
}
