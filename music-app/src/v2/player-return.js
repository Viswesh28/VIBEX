// UI routing only: never issues play, pause, seek, or queue replacement commands.
// Consume each authoritative launch/return once, including returns with an empty queue.
export function createPlayerReturnGate() {
  let handled = "";
  return {
    consume({ token, ready, visible, current, blocked = false }) {
      if (!ready || !visible || !token || token === handled) return false;
      handled = token;
      return !!current && !blocked;
    },
  };
}

// Browser-preview lifecycle. Android sends activity-level requests instead, allowing it
// to distinguish leaving the app from returning from a document picker/permission dialog.
export function watchBrowserReturns(onReturn, doc = document, win = window) {
  let hidden = doc.hidden,
    picker = false,
    resetTimer;
  const clicked = (event) => {
    if (event.target?.matches?.('input[type="file"]')) picker = true;
  };
  const resetPickerSoon = () => {
    win.clearTimeout(resetTimer);
    resetTimer = win.setTimeout(() => {
      picker = false;
    }, 500);
  };
  const visibility = () => {
    if (doc.hidden) {
      hidden = true;
      return;
    }
    if (hidden) {
      hidden = false;
      if (!picker) onReturn();
    }
    resetPickerSoon();
  };
  doc.addEventListener("click", clicked, true);
  doc.addEventListener("change", resetPickerSoon, true);
  doc.addEventListener("cancel", resetPickerSoon, true);
  doc.addEventListener("visibilitychange", visibility);
  win.addEventListener("focus", resetPickerSoon);
  return () => {
    win.clearTimeout(resetTimer);
    doc.removeEventListener("click", clicked, true);
    doc.removeEventListener("change", resetPickerSoon, true);
    doc.removeEventListener("cancel", resetPickerSoon, true);
    doc.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("focus", resetPickerSoon);
  };
}
