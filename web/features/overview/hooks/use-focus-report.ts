'use client';

import { useEffect } from 'react';

/** The stream the page holds while in focus, which the web app's server follows on the gateway's API for the browser. */
export const FOCUS_PATH = '/overview/focus';

/**
 * Tells the gateway while the page is in focus (wake a person, W6): it holds
 * the focus stream open while the window has focus and the page shows, and
 * closes it when either ends. While a page of the person is in focus, what
 * arrives is shown there and no wake goes out; an open page not in focus
 * changes nothing. A lost connection no longer counts as in focus.
 */
export function useFocusReport(fleetId: string): void {
  useEffect(() => {
    let focus: EventSource | undefined;
    const report = () => {
      const isInFocus = document.visibilityState === 'visible' && document.hasFocus();
      if (isInFocus && focus === undefined) {
        focus = new EventSource(`${FOCUS_PATH}?fleet=${encodeURIComponent(fleetId)}`);
      } else if (!isInFocus && focus !== undefined) {
        focus.close();
        focus = undefined;
      }
    };
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
      focus?.close();
    };
  }, [fleetId]);
}
