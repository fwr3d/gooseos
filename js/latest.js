// Wrap an async redraw so overlapping calls never run at the same time:
// extra calls while one is running collapse into one more run with fresh data.
// This stops an older, slower redraw from landing after a newer one.
export function latest(fn) {
  let running = false, again = false;
  return async function (...args) {
    if (running) { again = true; return; }
    running = true;
    try { do { again = false; await fn(...args); } while (again); }
    finally { running = false; }
  };
}
