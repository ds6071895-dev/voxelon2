import { Inventory } from '../src/inventory';
import { Block } from '../src/blocks';
import { Item, ITEMS } from '../src/items';
import { DEFAULT_KEYBINDS, heldBind, matchesBind, sanitizeKeybinds } from '../src/keybinds';
import { GameAudio } from '../src/audio';
import { Group, PerspectiveCamera } from 'three';

/** Invalid network/storage inputs and the shared physical modifier contract. */
export function runClientCleanupTests(): number {
  let checks = 0;
  const check = (ok: boolean, message: string): void => {
    checks++;
    if (!ok) throw new Error(`Client cleanup: ${message}`);
  };
  const inv = new Inventory();
  inv.restore([
    { id: Block.OakPlanks, count: 0.5 },
    { id: Item.BurstRifle, count: 1, loaded: 1000 },
    { id: Item.BurstRifle, count: 1, loaded: -2 },
    { id: Block.OakPlanks, count: 32, loaded: 8 },
    { id: Item.Bullet, count: 64 },
    { id: Item.BurstRifle, count: 1, loaded: 7 },
    { id: Item.BurstRifle, count: 1 },
    { id: Item.BridgeBow, count: 1, loaded: 2 },
    { id: Item.Medkit, count: 3 },
  ], Number.NaN);
  check(inv.slots[0] === null, 'a positive fraction that floors to zero is empty');
  check(inv.slots[1]?.loaded === ITEMS[Item.BurstRifle].gun!.mag, 'magazine is capped at registry capacity');
  check(inv.slots[2]?.loaded === 0, 'negative magazine becomes empty');
  check(inv.slots[3]?.loaded === undefined && inv.slots[3]?.count === 32, 'blocks cannot carry magazine metadata');
  check(inv.slots[4]?.count === 64, 'valid full ammo stack survives');
  check(inv.slots[5]?.loaded === 7, 'valid partial magazine survives');
  check(inv.slots[6]?.loaded === undefined, 'omitted magazine retains the full-magazine convention');
  check(inv.slots[7]?.loaded === undefined, 'server-simulated bow is not a gun');
  check(inv.slots[8]?.count === 3 && inv.selected === 0, 'valid consumables survive invalid selection');
  inv.restore([{ id: Item.Bullet, count: Infinity }, { id: -1, count: 1 }, null], 9);
  check(inv.slots.every(s => s === null), 'invalid slots and prior trailing slots are cleared');
  check(inv.selected === 0, 'integer selection still wraps through the hotbar');

  const binds = sanitizeKeybinds({ forward: null, sneak: 'ShiftRight', reload: '<script>', view: 'X'.repeat(25) });
  check(binds.forward === DEFAULT_KEYBINDS.forward && binds.reload === DEFAULT_KEYBINDS.reload
    && binds.view === DEFAULT_KEYBINDS.view, 'malformed stored codes use defaults');
  check(binds.sneak === 'ShiftRight', 'valid stored modifier side is retained');
  for (const [left, right] of [['ShiftLeft', 'ShiftRight'], ['ControlLeft', 'ControlRight'], ['AltLeft', 'AltRight']]) {
    check(matchesBind(left, right) && matchesBind(right, left), `${left} modifier equivalence is symmetric`);
    check(heldBind(new Set([right]), left) && heldBind(new Set([left]), right), `${left} physical telemetry agrees`);
  }
  check(!matchesBind('KeyA', 'KeyD') && !heldBind(new Set(['ShiftLeft']), 'ControlRight'), 'unrelated keys never match');
  check(matchesBind('KeyR', 'KeyR') && heldBind(new Set(['KeyR']), 'KeyR'), 'ordinary exact-code binding survives extraction');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  } });
  try {
    type AudioProbe = { effectsVolume: number; ctx: { listener: Record<string, { value: number }> } | null };
    const audio = new GameAudio();
    const probe = audio as unknown as AudioProbe;
    check(probe.effectsVolume === .8, 'an absent legacy volume key does not silently mute effects');
    stored.set('voxelon.audio.effects', '0');
    check((new GameAudio() as unknown as AudioProbe).effectsVolume === 0, 'an explicitly saved mute remains muted');
    const listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(key => [key, { value: 0 }]));
    probe.ctx = { listener };
    const rig = new Group(); rig.position.set(10, 4, 3); rig.rotation.y = Math.PI / 2;
    const camera = new PerspectiveCamera(); camera.position.set(1, 2, 0); rig.add(camera);
    audio.updateListener(camera);
    check(Math.abs(listener.positionX.value - 10) < 1e-6 && listener.positionY.value === 6 && Math.abs(listener.positionZ.value - 2) < 1e-6,
      'a parented camera publishes world-space listener position');
    check(Math.abs(listener.forwardX.value + 1) < 1e-6 && Math.abs(listener.forwardZ.value) < 1e-6,
      'a parented camera publishes world-space listener direction');
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
  return checks;
}
