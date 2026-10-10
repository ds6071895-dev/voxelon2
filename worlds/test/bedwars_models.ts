import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBedwarsModels } from '../src/bedwars_models';
import { bwMap } from '../src/bedwars_map';
import { itemGeometrySolid } from '../src/item_geometry';
import { Item } from '../src/items';
import type { Atlas } from '../src/textures';

export function runBedwarsModelTests(): void {
  const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  // Only the canvas read port is needed by borrowed ingot geometry in Node.
  const canvas = { width: 672, getContext: () => ({ getImageData: () => ({ data: pixels }) }) } as unknown as HTMLCanvasElement;
  const atlas: Atlas = { canvas, texture: new THREE.CanvasTexture(canvas), uvRect: () => [0, 0, 1, 1] };
  const borrowed = itemGeometrySolid(atlas, Item.IronIngot, .42, .06);
  const gold = itemGeometrySolid(atlas, Item.GoldIngot, .42, .06);
  let borrowedDisposals = 0, atlasDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  atlas.texture.addEventListener('dispose', () => atlasDisposals++);
  const original = THREE.BufferGeometry.prototype.dispose;
  const originalClone = THREE.BufferGeometry.prototype.clone;
  const sources = new Set<THREE.BufferGeometry>();
  const disposed = new Map<THREE.BufferGeometry, number>();
  THREE.BufferGeometry.prototype.dispose = function (): void {
    disposed.set(this, (disposed.get(this) ?? 0) + 1); original.call(this);
  };
  THREE.BufferGeometry.prototype.clone = function () { sources.add(this); return originalClone.call(this) as typeof this; };
  try {
    for (const id of [0, 1]) for (let iteration = 0; iteration < 3; iteration++) {
      const before = disposed.size, model = createBedwarsModels(bwMap(id), 4, atlas);
      assert(disposed.size > before, 'construction/baking releases source primitives');
      const visible = new Set<THREE.BufferGeometry>();
      model.group.traverse(object => { if (object instanceof THREE.Mesh) visible.add(object.geometry); });
      for (const source of sources) if (!visible.has(source)) assert.equal(disposed.get(source), 1, 'baked source primitives are released at construction completion');
      for (const geometry of visible) assert.equal(disposed.get(geometry) ?? 0, 0, 'live batches, animated and borrowed geometry remain valid');
      model.update(0);
      const zero: number[] = []; model.group.traverse(object => { zero.push(object.position.y); });
      for (let frame = 0; frame < 500; frame++) model.update(0);
      const repeat: number[] = []; model.group.traverse(object => { repeat.push(object.position.y); });
      assert.deepEqual(repeat, zero, 'reduced-motion constant clock cannot accumulate offsets');
      model.update(5); model.update(0);
      const rewind: number[] = []; model.group.traverse(object => { rewind.push(object.position.y); });
      assert.deepEqual(rewind, zero, 'animation pose depends only on the current clock');
      model.dispose(); const after = disposed.size; model.dispose(); assert.equal(disposed.size, after);
      for (const geometry of visible) if (geometry !== borrowed && geometry !== gold) assert.equal(disposed.get(geometry), 1);
    }
    assert.equal(borrowedDisposals, 0); assert.equal(disposed.get(gold) ?? 0, 0); assert.equal(atlasDisposals, 0);
    assert.equal(itemGeometrySolid(atlas, Item.IronIngot, .42, .06), borrowed);
    console.log('Bedwars models: repeated garden/frost disposal and clock-idempotent animation passed.');
  } finally { THREE.BufferGeometry.prototype.dispose = original; THREE.BufferGeometry.prototype.clone = originalClone; atlas.texture.dispose(); }
}
