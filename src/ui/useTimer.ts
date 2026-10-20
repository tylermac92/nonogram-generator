import { useEffect, useState, useSyncExternalStore } from 'react';

const onVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};

/** Milliseconds counted while `active` and the tab is visible, and a setter for restoring or resetting. */
export function useTimer(initial: number, active: boolean) {
  const visible = useSyncExternalStore(
    onVisibility,
    () => document.visibilityState === 'visible',
  );
  const [elapsed, setElapsed] = useState(initial);
  const running = active && visible;

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const step = now - last; // read now: the updater runs later
      setElapsed((e) => e + step);
      last = now;
    };
    const id = setInterval(tick, 250); // a quarter second, so no second is skipped on screen
    return () => {
      clearInterval(id);
      tick(); // count up to the moment it paused
    };
  }, [running]);

  return [elapsed, setElapsed] as const;
}

/** m:ss, or h:mm:ss from an hour. */
export function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const [h, m] = [Math.floor(s / 3600), Math.floor(s / 60) % 60];
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
