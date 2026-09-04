// THE HOARD — a faction's treasury as a thing standing in the world.
//
// Built the same way as the flag poles (flagmodels.ts): pure PRESENTATION over
// positions that treasury.ts derives from `flagHome()`. Nothing here is a block
// and nothing here is a chest — no edit-log entry, no container hookup, nothing
// that could be mined, moved, or opened through the generic chest path. A
// server-owned faction asset should never depend on the state of one voxel.
//
// THE POINT IS THAT YOU CAN COUNT IT FROM THE RIDGELINE. The levy does not
// vanish into a menu: it stands on a RING OF PEDESTALS around the banner, one
// per slice of the hoard, each carrying the actual item model of what is banked
// there (the same mini-block the world drops use, so a pile of cobalt reads as
// cobalt from thirty blocks out). The strongbox still sits beside the pole as
// the ledger you open; the ring is the part the enemy comes for.
//
// It reports itself at a glance:
//   · pedestals light up and stack higher as the treasury fills
//   · the faction's colour burns through the seam and the ring beacons
//   · the whole site pulses red and the pedestal shields drop while a war
//     window is open and it can actually be forced
//   · a fresh raid leaves the ring scorched and smoking for a few seconds

import * as THREE from 'three';
import { flagHome } from './flags';
import { ITEMS, type ItemStack } from './items';
import { itemGeometry } from './itementity';
import type { Atlas } from './textures';
import {
  TREASURY_OFFSET_X, TREASURY_OFFSET_Z, TREASURY_PEDESTALS, TREASURY_RING_RADIUS,
  pedestalLocation, treasuryLocation, treasuryInReach,
} from './treasury';
import { FACTIONS, factionColor } from './teams';

/** Footprint of the strongbox, in blocks. */
const BOX_W = 1.5, BOX_D = 1.1, BODY_H = 0.62, LID_H = 0.26;
/** Item count at which the fill indicator reads full (a packed 27-slot box). */
const FULL_AT = 27 * 64;
/** How far the lid lifts when the box is stuffed. */
const LID_LIFT = 0.34;
/** Height of a pedestal column, and how far the hoard floats above it. */
const PED_H = 0.72, PED_W = 0.62;
/** Seconds a raid scar smoulders on the ring. */
const SCAR_TIME = 8;

/** One pedestal in the ring: the plinth, the item model floating over it, and
 *  the shield that seals it outside a war. */
interface Pedestal {
  group: THREE.Group;
  /** Spins and bobs; holds the item model for whatever is banked here. */
  cradle: THREE.Group;
  /** The item mesh currently on the cradle, and which id built it. */
  item: THREE.Mesh | null;
  itemId: number;
  /** The stacked "bars" under the item — height reads as quantity. */
  bars: THREE.Mesh[];
  /** Faction-coloured shield dome: solid when sealed, gone during a war. */
  shieldMat: THREE.MeshBasicMaterial;
  shield: THREE.Mesh;
  /** Vertical beacon shaft, brighter the fuller this slice is. */
  beamMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  /** 0..1 how loaded this pedestal is, eased so a raid drains it visibly. */
  load: number;
  target: number;
  phase: number;
  /** World-space ground height under this pedestal, probed once on build. The
   *  ring is fixed for the seed, so re-probing the terrain every frame buys
   *  nothing but a lookup per pedestal per frame. */
  groundY: number;
}

interface Site {
  group: THREE.Group;
  lid: THREE.Group;
  /** The glowing seam under the lid: brightness tracks how full the box is. */
  seamMat: THREE.MeshBasicMaterial;
  /** The war-time alarm ring around the plinth. */
  alarm: THREE.Mesh;
  alarmMat: THREE.MeshBasicMaterial;
  /** The ring of hoard pedestals around the flag pole. */
  pedestals: Pedestal[];
  /** Seconds left on the "just robbed" scar, 0 when clean. */
  scar: number;
  scarMat: THREE.MeshBasicMaterial;
  scarRing: THREE.Mesh;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export class TreasuryModels {
  private readonly scene: THREE.Scene;
  private readonly atlas: Atlas;
  /** One shared textured material for every item model on every ring. */
  private readonly itemMat: THREE.MeshBasicMaterial;
  private readonly sites = new Map<number, Site>();
  /** Item count per faction, from the politics sync. Drives the fill glow. */
  private counts: Record<number, number> = {};
  /** YOUR faction's actual contents, so your own ring shows the real items
   *  rather than the generic bullion every other faction gets. The enemy only
   *  ever publishes a COUNT, and the ring must never leak more than the wire. */
  private ownFaction = -1;
  private ownSlots: (ItemStack | null)[] = [];
  /** What each pedestal of each faction is carrying, recomputed only when the
   *  numbers behind it change. `update` runs sixty times a second and this is a
   *  sort over a 27-slot chest — it has no business happening per frame. */
  private slices = new Map<number, { id: number; load: number }[]>();
  private warActive = false;
  private t = 0;
  private groundAt: (x: number, z: number) => number = () => 64;

  constructor(scene: THREE.Scene, atlas: Atlas) {
    this.scene = scene;
    this.atlas = atlas;
    this.itemMat = new THREE.MeshBasicMaterial({
      map: atlas.texture, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide,
    });
  }

  setGroundProbe(fn: (x: number, z: number) => number): void { this.groundAt = fn; }

  /** Adopt the latest per-faction item counts. */
  setCounts(counts: Record<number, number>): void {
    this.counts = { ...counts };
    this.slices.clear();
  }

  /** Adopt YOUR faction's real contents. Everyone else's ring stays generic. */
  setOwnContents(faction: number, slots: (ItemStack | null)[]): void {
    this.ownFaction = faction;
    this.ownSlots = slots;
    this.slices.clear();
  }

  /** A hoard can only be forced while a war window is open — the models say so,
   *  so nobody has to read a rulebook to find that out. */
  setWarActive(active: boolean): void { this.warActive = active; }

  /** Somebody just robbed this faction: scorch the ring for a few seconds. */
  markRaided(faction: number): void {
    const site = this.sites.get(faction);
    if (site) site.scar = SCAR_TIME;
  }

  /** The faction whose hoard the player is standing in, or null.
   *
   *  Delegates to the PURE `treasuryInReach` rather than re-deriving the test,
   *  so the prompt on screen and the server's own check can never disagree
   *  about whether you are close enough. */
  inReach(x: number, z: number): number | null {
    return treasuryInReach(x, z);
  }

  /** World-space centre of a strongbox, for aim tests and effects. */
  centre(faction: number): THREE.Vector3 {
    const loc = treasuryLocation(faction);
    return new THREE.Vector3(
      loc.x + 0.5, this.groundAt(loc.x, loc.z) + 0.7, loc.z + 0.5);
  }

  /**
   * Is the player looking at this faction's hoard?
   *
   * TWO answers, because the two things you can do with a hoard want different
   * targets. Opening YOUR OWN ledger is a deliberate act at the strongbox, so
   * `wide` is off and only the box counts — otherwise a five-block bubble round
   * your own flag would swallow every right-click you make at your own base and
   * you could not place a block anywhere near the banner. STRIPPING an enemy
   * ring is the opposite: the loot is spread across eight pedestals you can see
   * all of, so any of them counts, and walking up to the near side and looking
   * at the nearest pile does what it looks like it should.
   */
  lookingAt(
    faction: number, eye: THREE.Vector3, dir: THREE.Vector3, cos: number, wide: boolean
  ): boolean {
    const hit = (p: THREE.Vector3): boolean => {
      const to = p.sub(eye);
      if (to.lengthSq() < 1e-6) return true;
      return dir.dot(to.normalize()) >= cos;
    };
    if (hit(this.centre(faction))) return true;
    if (!wide) return false;
    for (let i = 0; i < TREASURY_PEDESTALS; i++) {
      const loc = pedestalLocation(faction, i);
      if (hit(new THREE.Vector3(
        loc.x, this.groundAt(Math.floor(loc.x), Math.floor(loc.z)) + PED_H + 0.4, loc.z))) {
        return true;
      }
    }
    return false;
  }

  private build(faction: number): Site {
    const color = new THREE.Color(factionColor(faction));
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const geo = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g; };
    const mat = <T extends THREE.Material>(m: T): T => { materials.push(m); return m; };

    // --- the strongbox, beside the pole -------------------------------------
    // The whole site is anchored on the flag pole, so everything in here is
    // placed in FLAG-LOCAL space and `update` only has to move one group.
    const box = new THREE.Group();
    box.position.set(TREASURY_OFFSET_X, 0, TREASURY_OFFSET_Z);

    // Plinth: the box sits on a stone pad so it never reads as half-sunk in
    // whatever terrain happens to be under the flag.
    const plinth = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.55, 0.2, BOX_D + 0.55)),
      mat(new THREE.MeshBasicMaterial({ color: 0x2b2e35 }))
    );
    plinth.position.y = 0.1;
    box.add(plinth);

    const trim = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.3, 0.07, BOX_D + 0.3)),
      mat(new THREE.MeshBasicMaterial({ color }))
    );
    trim.position.y = 0.22;
    box.add(trim);

    // Body.
    const body = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W, BODY_H, BOX_D)),
      mat(new THREE.MeshBasicMaterial({ color: 0x59422a }))
    );
    body.position.y = 0.25 + BODY_H / 2;
    box.add(body);

    // Iron banding, so it reads as a strongbox rather than a crate.
    for (const dx of [-BOX_W * 0.3, BOX_W * 0.3]) {
      const band = new THREE.Mesh(
        geo(new THREE.BoxGeometry(0.14, BODY_H + 0.02, BOX_D + 0.02)),
        mat(new THREE.MeshBasicMaterial({ color: 0x3a3f47 }))
      );
      band.position.set(dx, 0.25 + BODY_H / 2, 0);
      box.add(band);
    }

    // The seam: a thin glowing slab between body and lid. Its brightness is the
    // fill gauge, readable from across the base.
    const seamMat = mat(new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    const seam = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.04, 0.06, BOX_D + 0.04)), seamMat
    );
    seam.position.y = 0.25 + BODY_H;
    box.add(seam);

    // Lid, in its own group so it can hinge open without moving the body.
    const lid = new THREE.Group();
    lid.position.y = 0.25 + BODY_H;
    const lidMesh = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.06, LID_H, BOX_D + 0.06)),
      mat(new THREE.MeshBasicMaterial({ color: 0x6a5031 }))
    );
    lidMesh.position.y = LID_H / 2;
    lid.add(lidMesh);
    const lock = new THREE.Mesh(
      geo(new THREE.BoxGeometry(0.22, 0.24, 0.1)),
      mat(new THREE.MeshBasicMaterial({ color: 0xd8b64a }))
    );
    lock.position.set(0, LID_H / 2 - 0.04, BOX_D / 2 + 0.05);
    lid.add(lock);
    box.add(lid);

    // War alarm: a flat ring on the plinth that only appears once the box can
    // actually be forced.
    const alarmMat = mat(new THREE.MeshBasicMaterial({
      color: 0xff3b28, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const alarm = new THREE.Mesh(
      geo(new THREE.RingGeometry(BOX_W * 0.72, BOX_W * 0.95, 28)), alarmMat
    );
    alarm.rotation.x = -Math.PI / 2;
    alarm.position.y = 0.21;
    alarm.visible = false;
    box.add(alarm);
    group.add(box);

    // --- the ring of pedestals ----------------------------------------------
    // A raid scar under the whole ring, so a robbery leaves a mark on the site
    // rather than only a line in the inbox.
    const scarMat = mat(new THREE.MeshBasicMaterial({
      color: 0xff5a2a, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const scarRing = new THREE.Mesh(
      geo(new THREE.RingGeometry(
        TREASURY_RING_RADIUS - 0.9, TREASURY_RING_RADIUS + 0.9, 40)), scarMat
    );
    scarRing.rotation.x = -Math.PI / 2;
    scarRing.position.y = 0.06;
    scarRing.visible = false;
    group.add(scarRing);

    const pedestals: Pedestal[] = [];
    for (let i = 0; i < TREASURY_PEDESTALS; i++) {
      // Flag-local: `pedestalLocation` gives the world spot, so subtracting the
      // pole leaves exactly the ring offset. It carries the half-step that keeps
      // the ring clear of the strongbox — the offset is not repeated here.
      const ped = new THREE.Group();
      const home = flagHome(faction), at = pedestalLocation(faction, i);
      ped.position.set(at.x - home.x, 0, at.z - home.z);

      // Stone column with a faction-coloured cap: reads as deliberate treasury
      // furniture rather than a stack of blocks somebody left out.
      const column = new THREE.Mesh(
        geo(new THREE.BoxGeometry(PED_W, PED_H, PED_W)),
        mat(new THREE.MeshBasicMaterial({ color: 0x35383f }))
      );
      column.position.y = PED_H / 2;
      ped.add(column);
      const cap = new THREE.Mesh(
        geo(new THREE.BoxGeometry(PED_W + 0.16, 0.09, PED_W + 0.16)),
        mat(new THREE.MeshBasicMaterial({ color }))
      );
      cap.position.y = PED_H + 0.045;
      ped.add(cap);

      // Bullion bars stacked on the cap. How many are visible is the quantity
      // gauge — a pedestal you can read from a distance without a HUD.
      const bars: THREE.Mesh[] = [];
      for (let b = 0; b < 4; b++) {
        const bar = new THREE.Mesh(
          geo(new THREE.BoxGeometry(0.42 - b * 0.06, 0.08, 0.3 - b * 0.04)),
          mat(new THREE.MeshBasicMaterial({ color: 0xd8b64a }))
        );
        bar.position.set(0, PED_H + 0.13 + b * 0.085, 0);
        bar.rotation.y = b * 0.24;
        bar.visible = false;
        ped.add(bar);
        bars.push(bar);
      }

      // The item model floats above the bars, spinning like a world drop so it
      // is obviously LOOT and not scenery.
      const cradle = new THREE.Group();
      cradle.position.y = PED_H + 0.62;
      ped.add(cradle);

      // Beacon shaft: how much this slice is carrying, visible over terrain.
      const beamMat = mat(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide,
      }));
      const beam = new THREE.Mesh(
        geo(new THREE.CylinderGeometry(0.13, 0.2, 3.4, 10, 1, true)), beamMat
      );
      beam.position.y = PED_H + 1.9;
      beam.visible = false;
      ped.add(beam);

      // Shield dome: the seal. Solid outside a war, gone once the hoard can be
      // forced — so "can I rob this right now" is answered by looking at it.
      const shieldMat = mat(new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.22, depthWrite: false,
        side: THREE.DoubleSide, wireframe: true,
      }));
      const shield = new THREE.Mesh(
        geo(new THREE.SphereGeometry(0.95, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2)),
        shieldMat
      );
      // Low enough that the dome closes over the tallest load a pedestal can
      // carry — a seal with the loot poking out of it is not a seal.
      shield.position.y = PED_H + 0.02;
      ped.add(shield);

      group.add(ped);
      pedestals.push({
        group: ped, cradle, item: null, itemId: -1, bars, shieldMat, shield,
        beamMat, beam, load: 0, target: 0, phase: (i / TREASURY_PEDESTALS) * Math.PI * 2,
        groundY: this.groundAt(Math.floor(at.x), Math.floor(at.z)),
      });
    }

    this.scene.add(group);
    return {
      group, lid, seamMat, alarm, alarmMat, pedestals,
      scar: 0, scarMat, scarRing, materials, geometries,
    };
  }

  /**
   * What each pedestal in a faction's ring is carrying.
   *
   * For YOUR faction that is the real thing: the treasury's own stacks, biggest
   * first, so the ring is a readable inventory you can walk around. For anyone
   * else the wire only ever carries a COUNT, so their ring shows generic bullion
   * — the enemy learns how RICH you are, which is the point of a visible hoard,
   * and not what you are holding, which is nobody's business until they take it.
   */
  private slicesOf(faction: number): { id: number; load: number }[] {
    const cached = this.slices.get(faction);
    if (cached) return cached;
    const n = TREASURY_PEDESTALS;
    const out: { id: number; load: number }[] = [];
    if (faction === this.ownFaction && this.ownSlots.length) {
      const stacks = this.ownSlots
        .filter((s): s is ItemStack => !!s && !!ITEMS[s.id])
        .sort((a, b) => b.count - a.count);
      for (let i = 0; i < n; i++) {
        const stack = stacks[i];
        if (!stack) { out.push({ id: -1, load: 0 }); continue; }
        const max = Math.max(1, ITEMS[stack.id].maxStack);
        // A single item still gets a visible pile: a pedestal carrying one
        // diamond should read as "there is a diamond there", not as bare stone.
        out.push({ id: stack.id, load: Math.max(0.12, Math.min(1, stack.count / max)) });
      }
    } else {
      // Generic: spread the published count across the ring, front pedestals
      // filling first so a poor faction shows one small pile, not eight specks.
      const total = this.counts[faction] ?? 0;
      const perPed = FULL_AT / n;
      for (let i = 0; i < n; i++) {
        out.push({ id: -1, load: Math.max(0, Math.min(1, (total - i * perPed) / perPed)) });
      }
    }
    this.slices.set(faction, out);
    return out;
  }

  /** Swap the item model on a pedestal, disposing nothing shared. */
  private setPedestalItem(ped: Pedestal, id: number): void {
    if (ped.itemId === id) return;
    ped.itemId = id;
    if (ped.item) { ped.cradle.remove(ped.item); ped.item = null; }
    if (id < 0 || !ITEMS[id]) return;
    // `itemGeometry` caches per item id and is shared with the world's drops,
    // so it is never disposed here — the cache outlives every hoard.
    const mesh = new THREE.Mesh(itemGeometry(this.atlas, id), this.itemMat);
    mesh.scale.setScalar(2.2);
    ped.cradle.add(mesh);
    ped.item = mesh;
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of FACTIONS) {
      let site = this.sites.get(f.id);
      if (!site) { site = this.build(f.id); this.sites.set(f.id, site); }

      // The whole site is anchored on the flag pole; the strongbox and the
      // pedestals carry their own offsets from it.
      const home = flagHome(f.id);
      site.group.position.set(
        home.x + 0.5, this.groundAt(home.x, home.z), home.z + 0.5);

      // Fill: the lid creeps open and the seam brightens as the box loads up.
      const fill = Math.max(0, Math.min(1, (this.counts[f.id] ?? 0) / FULL_AT));
      site.lid.position.y = 0.25 + BODY_H + LID_LIFT * fill;
      site.lid.rotation.x = -0.22 * fill;
      // A faint breath on the seam so a full box looks alive rather than lit.
      site.seamMat.opacity = 0.28 + fill * 0.5 + Math.sin(this.t * 1.6) * 0.05 * fill;

      site.alarm.visible = this.warActive;
      site.alarmMat.opacity = this.warActive
        ? 0.3 + 0.28 * (0.5 + 0.5 * Math.sin(this.t * 4.2)) : 0;

      // The raid scar fades on its own.
      if (site.scar > 0) {
        site.scar = Math.max(0, site.scar - dt);
        const k = site.scar / SCAR_TIME;
        site.scarRing.visible = true;
        site.scarMat.opacity = 0.42 * k * (0.6 + 0.4 * Math.sin(this.t * 9));
      } else if (site.scarRing.visible) {
        site.scarRing.visible = false;
        site.scarMat.opacity = 0;
      }

      this.updateRing(f.id, site, dt);
    }
  }

  /** Pose one faction's ring: contents, quantity gauges, seals and beacons. */
  private updateRing(faction: number, site: Site, dt: number): void {
    const slices = this.slicesOf(faction);
    site.pedestals.forEach((ped, i) => {
      const slice = slices[i];
      this.setPedestalItem(ped, slice.id);
      // Ease toward the true load so a raid DRAINS the ring in front of you
      // instead of teleporting it to a new height.
      ped.target = slice.load;
      ped.load += (ped.target - ped.load) * Math.min(1, dt * 3.2);
      const load = ped.load;

      // Keep the pedestal standing on its own patch of ground rather than on
      // the flag pad's, or half the ring floats on a slope. `groundY` is probed
      // once when the site is built: the ring is fixed for the seed and the
      // terrain under it is generated, not edited, so re-probing it sixty times
      // a second would return the same number sixty times a second.
      ped.group.position.y = ped.groundY - site.group.position.y;

      // Quantity: how many bars are stacked, and how high the loot floats.
      const bars = Math.round(load * ped.bars.length);
      ped.bars.forEach((bar, b) => { bar.visible = b < bars; });
      const bob = Math.sin(this.t * 1.7 + ped.phase) * 0.055;
      ped.cradle.position.y = PED_H + 0.34 + bars * 0.085 + 0.2 * load + bob;
      ped.cradle.rotation.y = this.t * 0.85 + ped.phase;
      ped.cradle.visible = load > 0.02;

      // Beacon: only the loaded pedestals throw a shaft, so the ring reads as a
      // bar chart of the hoard from a distance.
      ped.beam.visible = load > 0.05;
      ped.beamMat.opacity = load > 0.05
        ? 0.05 + 0.16 * load + 0.03 * Math.sin(this.t * 2.1 + ped.phase) : 0;

      // The seal. During a war it drops entirely — the hoard is open, and that
      // is visible from across the valley.
      ped.shield.visible = !this.warActive && load > 0.02;
      ped.shieldMat.opacity = this.warActive
        ? 0 : 0.1 + 0.14 * (0.5 + 0.5 * Math.sin(this.t * 1.2 + ped.phase));
    });
  }

  dispose(): void {
    for (const site of this.sites.values()) {
      this.scene.remove(site.group);
      for (const g of site.geometries) g.dispose();
      for (const m of site.materials) m.dispose();
    }
    this.sites.clear();
    this.itemMat.dispose();
  }
}
