/** Fake millisecond clock. The simulator never reads wall time. */

export function createClock() {
  let time = 0;
  return {
    now() {
      return time;
    },
    set(next) {
      time = next;
    },
  };
}
