// 결정적 가짜 타이머 — setTimeout/setInterval/performance.now를 가상 시계로 대체.
// 라운드 타이머(초 단위)와 모션 판정(ms 단위)을 실시간 대기 없이 시뮬레이션한다.

export function installFakeClock(target = globalThis) {
  let now = 0;
  let seq = 0;
  const timers = new Map(); // id -> {due, fn, interval|null}

  function fireDue(until) {
    for (;;) {
      let bestId = null, best = null;
      for (const [id, tm] of timers) {
        if (tm.due <= until && (!best || tm.due < best.due || (tm.due === best.due && id < bestId))) {
          best = tm; bestId = id;
        }
      }
      if (!best) break;
      now = Math.max(now, best.due);
      if (best.interval != null) best.due += Math.max(1, best.interval);
      else timers.delete(bestId);
      best.fn();
    }
    now = Math.max(now, until);
  }

  const clock = {
    get now() { return now; },
    // 동기 타이머만 처리하며 ms만큼 진행
    advance(ms) { fireDue(now + ms); },
    // await 지점(sleep 등)이 있는 코드용: 작은 스텝으로 진행하며 마이크로태스크 소진
    async advanceAsync(ms, step = 20) {
      const end = now + ms;
      while (now < end) {
        fireDue(Math.min(now + step, end));
        await flushMicrotasks();
      }
    },
  };

  target.setTimeout = (fn, ms = 0, ...a) => {
    const id = ++seq;
    timers.set(id, { due: now + Number(ms || 0), interval: null, fn: () => fn(...a) });
    return id;
  };
  target.setInterval = (fn, ms = 0, ...a) => {
    const id = ++seq;
    timers.set(id, { due: now + Number(ms || 0), interval: Number(ms || 0), fn: () => fn(...a) });
    return id;
  };
  target.clearTimeout = id => { timers.delete(id); };
  target.clearInterval = id => { timers.delete(id); };
  target.requestAnimationFrame = fn => target.setTimeout(() => fn(now), 16);
  target.cancelAnimationFrame = id => timers.delete(id);
  Object.defineProperty(target, 'performance', {
    value: { now: () => now }, configurable: true, writable: true,
  });
  return clock;
}

export const flushMicrotasks = () => new Promise(r => setImmediate(r));
