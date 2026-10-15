import assert from 'node:assert/strict';
import { WorldReadiness } from '../src/client/world_readiness';
import { Screens } from '../src/client/screens';
import { Comfort } from '../src/client/comfort';
import { PickerSession } from '../src/client/picker_session';
import type { Input } from '../src/input';

/** Focused lifecycle fixtures; exported for the aggregate harness or an in-memory runner. */
export function runClientCompositionTests(): number {
  let checks = 0;
  const test = (fn: () => void): void => { fn(); checks++; };
  test(() => {
    let callback: (() => void) | null = null, ready = 0, hidden = 0, complete = false, loaded = false;
    const calls: number[][] = [];
    const gate = new WorldReadiness({
      update: (...args) => { calls.push(args); return complete; }, updateVenue: () => complete, isLoaded: () => loaded,
    }, () => ready++, () => hidden++, { setInterval: fn => { callback = fn; return 1; }, clearInterval: () => { callback = null; } });
    gate.enter('pg', { x: 8, y: 64, z: 12 }, 0);
    callback!(); assert.deepEqual(calls.pop(), [8, 12, 30, 4]); assert.equal(ready, 0);
    complete = true; callback!(); assert.equal(ready, 0, 'background readiness also requires a loaded spawn');
    loaded = true; callback!(); assert.equal(ready, 1); assert.equal(hidden, 1); assert.equal(callback, null);
    gate.update(1); assert.equal(ready, 1, 'frame cannot send a second ready');
    gate.enter('pg', { x: 8, y: 64, z: 12 }, 2); gate.update(2);
    assert.equal(ready, 2, 'same-world round entry gets its own ready latch');
    assert.deepEqual(calls.pop(), [8, 12, 20, 2]);
    gate.reset(); assert.equal(gate.pendingTeleport, null); assert.equal(callback, null);
  });
  test(() => {
    let ready = 0, venueCalls = 0, callback: (() => void) | null = null, complete = false;
    const gate = new WorldReadiness({ update: () => { throw new Error('Bedwars must stream the venue'); },
      updateVenue: budget => { venueCalls += budget; return complete; }, isLoaded: () => true,
    }, () => ready++, () => {}, { setInterval: fn => { callback = fn; return 1; }, clearInterval: () => { callback = null; } });
    gate.enter('bw', { x: 0, y: 97, z: 0 }, 0); gate.update(4.01);
    assert.equal(gate.pendingTeleport, null, 'physics fallback releases a stuck teleport');
    assert.equal(ready, 0, 'timeout is not a ready acknowledgement'); assert.notEqual(callback, null);
    complete = true; callback!(); assert.equal(ready, 1); assert.equal(venueCalls, 50);
    gate.reset(); assert.equal(callback, null);
  });
  test(() => {
    const saved = { reducedMotion: false, photosensitivitySafe: false, cameraShake: .4 }, os = Object.assign(new EventTarget(), { matches: true });
    const comfort = new Comfort(saved, os);
    assert.equal(comfort.reducedMotion, true); assert.equal(saved.reducedMotion, false, 'effective OS preference never rewrites storage');
    os.matches = false; os.dispatchEvent(new Event('change')); assert.equal(comfort.reducedMotion, false, 'OS preference follows change events');
    saved.reducedMotion = true; assert.equal(comfort.reducedMotion, true);
    saved.photosensitivitySafe = true; assert.equal(comfort.photosensitivitySafe, true);
  });
  test(() => screenFixture());
  return checks;
}

class ElementFixture extends EventTarget {
  style = { display: '' };
  textContent = '';
  private classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
  querySelector(): ElementFixture { return new ElementFixture(); }
}

export async function runClientPickerTests(): Promise<number> {
  let dialog = false, pointerEligible = true, chosen = 0;
  let resolveOld: (value: number | null) => void = () => {};
  let resolveNew: (value: number | null) => void = () => {};
  const picker = new PickerSession<number>(() => { pointerEligible = !picker.open; });
  const show = (signal: AbortSignal, save: (resolve: (value: number | null) => void) => void): Promise<number | null> => {
    dialog = true;
    signal.addEventListener('abort', () => { dialog = false; }, { once: true });
    return new Promise(resolve => save(resolve));
  };
  picker.choose(signal => show(signal, resolve => { resolveOld = resolve; }), () => chosen++);
  assert.equal(pointerEligible, false); assert.equal(dialog, true);
  picker.hide(); // onRsState: hiding ends, host can no longer choose the seeker.
  assert.equal(dialog, false); assert.equal(picker.open, false); assert.equal(pointerEligible, true);
  picker.choose(signal => show(signal, resolve => { resolveNew = resolve; }), () => chosen++);
  resolveOld(7); await Promise.resolve();
  assert.equal(picker.open, true, 'aborted old promise cannot clear a newer sheet'); assert.equal(chosen, 0);
  resolveNew(8); await Promise.resolve();
  assert.equal(picker.open, false); assert.equal(pointerEligible, true); assert.equal(chosen, 1);
  return 1;
}
function screenFixture(): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = new EventTarget() as EventTarget & { body: ElementFixture; getElementById(): ElementFixture };
  doc.body = new ElementFixture(); doc.getElementById = () => new ElementFixture();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  try {
    let suspended = 0, released = 0;
    const input = { locked: false, lockPending: false, releaseButtons: () => released++,
      lock() { this.locked = true; doc.dispatchEvent(new Event('pointerlockchange')); },
      unlock() { this.locked = false; doc.dispatchEvent(new Event('pointerlockchange')); } };
    const pause = new ElementFixture(), screens = new Screens(input as unknown as Input, pause as unknown as HTMLElement, () => suspended++);
    let open = false, reopened = false;
    screens.register({ get open() { return open; }, hide() {
      open = false;
      if (!screens.transitioning) { reopened = true; screens.restorePause(); }
    } });
    screens.enterMatch(); assert.equal(input.locked, true);
    input.unlock(); // Browser Escape: Input's listener has already cleared the lock.
    assert.equal(screens.state, 'paused'); assert.equal(pause.style.display, 'flex');
    screens.resumePlay(); assert.equal(input.locked, true);
    screens.enterPause(); assert.equal(screens.state, 'paused'); assert.equal(pause.style.display, 'flex');
    screens.showOverlay(() => { open = true; }); assert.equal(pause.style.display, 'none'); assert.equal(input.locked, false);
    open = false; screens.restorePause(); assert.equal(pause.style.display, 'flex', 'closing Controls restores Pause');
    screens.showOverlay(() => { open = true; }); screens.menu();
    assert.equal(reopened, false, 'network teardown cannot reopen HUD settings'); assert.equal(screens.state, 'title');
    assert.equal(open, false); assert.equal(input.locked, false); assert.equal(pause.style.display, 'none');
    screens.openTitleSettings(); screens.showOverlay(() => { open = true; }); open = false; screens.restorePause();
    assert.equal(pause.style.display, 'flex', 'title Settings also restores after a child sheet');
    screens.prepareTransition(); screens.enterMatch(); screens.results(); screens.menu();
    assert.equal(screens.state, 'title'); assert.equal(input.locked, false); assert.ok(suspended > 0 && released > 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document');
  }
}
