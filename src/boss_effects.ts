import * as THREE from 'three';
import { bossSurface, bossGlow } from './boss_surface';
import type { EncounterHazard, EncounterSnapshot } from './vault_encounter';

const COLORS = { crypt: 0xb38bff, mire: 0x55edb3, ember: 0xff792d,
  crystal: 0x80ddff, gilded: 0xffd477 };
const unit = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const debris = {
  crypt: new THREE.CapsuleGeometry(0.12,0.7,4,12),
  mire: new THREE.SphereGeometry(0.26,16,12),
  ember: new THREE.IcosahedronGeometry(0.3,1),
  crystal: new THREE.OctahedronGeometry(0.32),
  gilded: new THREE.CylinderGeometry(0.22,0.22,0.15,16),
};
const ember = new THREE.SphereGeometry(1,12,8);
const ring = new THREE.TorusGeometry(1,0.018,8,80);
const orb = new THREE.SphereGeometry(1,24,16);
const noise = (n: number): number => { const x = Math.sin(n*127.1+31.7)*43758.5453; return x-Math.floor(x); };

interface Effect {
  root: THREE.Group;
  solids: THREE.InstancedMesh;
  sparks: THREE.InstancedMesh;
  shock: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  hazard: EncounterHazard | null;
}

/** Visual-only aftermath survives snapshot removal. Damage still comes solely
 * from the encounter runtime. Fixed pools keep draw calls and memory bounded. */
export class BossAttackEffects {
  readonly root = new THREE.Group();
  private readonly effects: Effect[] = [];
  private encounterId = '';
  private lastSnapshot = -1;
  private receivedAt = 0;

  constructor(parent: THREE.Group) {
    this.root.name = 'boss-attack-effects';
    parent.add(this.root);
    for (let i=0;i<24;i++) {
      const root = new THREE.Group();
      const solids = new THREE.InstancedMesh(debris.ember,bossSurface(0xffffff),28);
      const sparks = new THREE.InstancedMesh(ember,bossGlow(0xffffff,0.65),28);
      // These instances move far beyond their initial unit geometry.
      solids.frustumCulled = sparks.frustumCulled = false;
      solids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const material = () => new THREE.MeshBasicMaterial({color:0xffffff,
        transparent:true,opacity:0.6,depthWrite:false,blending:THREE.AdditiveBlending});
      const shock = new THREE.Mesh(ring,material()); shock.rotation.x=-Math.PI/2;
      const core = new THREE.Mesh(orb,bossGlow(0xffffff));
      root.add(solids,sparks,shock,core); root.visible=false; this.root.add(root);
      this.effects.push({root,solids,sparks,shock,core,hazard:null});
    }
  }

  update(snapshot: EncounterSnapshot, reducedMotion: boolean): void {
    if (this.encounterId !== snapshot.encounterId || snapshot.time < this.lastSnapshot) {
      this.clear(); this.encounterId = snapshot.encounterId;
    }
    const now = performance.now()/1000;
    if (snapshot.time !== this.lastSnapshot) {
      this.lastSnapshot=snapshot.time; this.receivedAt=now;
    }
    const time = snapshot.time + Math.min(0.12,Math.max(0,now-this.receivedAt));
    const playing = snapshot.status==='active' || snapshot.status==='intro';
    this.root.visible=playing;
    if (!playing) { this.clear(); return; }
    for (const h of snapshot.hazards) {
      const existing = this.effects.find(e=>e.hazard?.id===h.id);
      const slot = existing ?? this.effects.find(e=>!e.hazard || time>e.hazard.expiresAt+0.85);
      if (slot) slot.hazard=h;
    }
    const color=COLORS[snapshot.family];
    for (const e of this.effects) {
      const h=e.hazard;
      e.root.visible=!!h && time<=h.expiresAt+0.85;
      if (!h || !e.root.visible) { e.hazard=null; continue; }
      const age=time-h.executeAt;
      const charge=THREE.MathUtils.clamp((time-h.telegraphAt)/Math.max(0.01,h.executeAt-h.telegraphAt),0,1);
      const live=age>=0;
      const fade=live ? Math.max(0,1-Math.max(0,time-h.expiresAt)/0.85) : 1;
      const target=h.target ?? {x:h.origin.x+1,z:h.origin.z};
      const heading=Math.atan2(target.z-h.origin.z,target.x-h.origin.x);
      e.root.position.set(h.origin.x,h.origin.y+0.08,h.origin.z);
      e.solids.geometry=debris[snapshot.family];
      (e.solids.material as THREE.MeshMatcapMaterial).color.set(
        snapshot.family==='crypt' ? 0xe5d8b8 : snapshot.family==='ember' ? 0x76615a : color);
      const sparkMat=e.sparks.material as THREE.MeshBasicMaterial;
      sparkMat.color.set(color); sparkMat.opacity=(reducedMotion ? 0.2 : 0.52)*fade;
      e.shock.material.color.set(color); e.core.material.color.set(color);
      e.shock.visible=h.shape!=='line' && h.shape!=='cone' && h.shape!=='quadrant';
      const shockRadius=h.shape==='ring' ? h.radius : h.radius*(live ? Math.min(1.12,0.2+age*3) : 1.15-charge*0.15);
      e.shock.scale.setScalar(Math.max(0.1,shockRadius));
      e.shock.material.opacity=(live ? 0.65 : 0.22)*fade;
      // An overhead projectile descends to the impact mark during the warning.
      e.core.visible=!live && h.shape!=='ring';
      e.core.position.set(0,h.shape==='rain' || h.shape==='circle' ? 1.1+(1-charge)*5 : 1.1,0);
      e.core.scale.setScalar(0.12+charge*0.28);
      e.core.material.opacity=reducedMotion ? 0.35 : 0.25+charge*0.35;
      const count=reducedMotion ? 10 : 28;
      e.solids.count=e.sparks.count=count;
      for (let i=0;i<count;i++) {
        const seed=h.id*53+i, u=(i+0.5)/count, random=noise(seed);
        let a=u*Math.PI*2, radius=h.radius*Math.sqrt(noise(seed+2));
        let x=0,z=0;
        if (h.shape==='line') {
          const along=u*h.radius, side=(random-0.5)*h.width*0.85;
          x=Math.cos(heading)*along-Math.sin(heading)*side;
          z=Math.sin(heading)*along+Math.cos(heading)*side;
        } else {
          if (h.shape==='ring') radius=h.radius+(random-0.5)*h.width*1.7;
          if (h.shape==='cone') a=heading+(u-0.5)*h.angle;
          if (h.shape==='quadrant') a=(h.id&3)*Math.PI/2+u*Math.PI/2;
          x=Math.cos(a)*radius; z=Math.sin(a)*radius;
        }
        const flight=reducedMotion ? 0 : Math.max(0,age);
        const height=live ? Math.max(0.06,Math.sin(Math.min(1,flight/1.1)*Math.PI)*(0.8+random*1.4))
          : h.shape==='rain' ? (1-charge)*(3+random*3)+0.3 : 0.03;
        unit.position.set(x,height,z);
        unit.rotation.set(random*2,random*6+flight*(random-0.5)*3,random*3);
        const scale=live ? fade*(0.45+random*0.8) : h.shape==='rain' ? 0.35 : 0.04+charge*0.15;
        const spike=snapshot.family==='crypt' || snapshot.family==='crystal';
        unit.scale.set(scale,scale*(spike ? 1.8 : 1),scale);
        unit.updateMatrix(); e.solids.setMatrixAt(i,unit.matrix);
        unit.position.y+=live ? 0.1+flight*(1+random) : 0.1;
        const sparkSize=(live ? 0.07+random*0.16 : 0.035+charge*0.045)*fade;
        unit.scale.set(sparkSize,sparkSize*(snapshot.family==='ember' ? 3 : 1),sparkSize);
        unit.updateMatrix(); e.sparks.setMatrixAt(i,unit.matrix);
      }
      e.solids.instanceMatrix.needsUpdate=e.sparks.instanceMatrix.needsUpdate=true;
      // Crystal/gilded lanes resolve as a physical energy lance with a round
      // cross section, while the other families erupt along the same footprint.
      if (live && h.shape==='line' && (snapshot.family==='crystal' || snapshot.family==='gilded')) {
        e.core.visible=true;
        e.core.position.set(Math.cos(heading)*h.radius/2,0.55,Math.sin(heading)*h.radius/2);
        direction.set(Math.cos(heading),0,Math.sin(heading));
        e.core.quaternion.setFromUnitVectors(up,direction);
        e.core.scale.set(Math.max(0.08,h.width*0.2),h.radius/2,Math.max(0.08,h.width*0.2));
        e.core.material.opacity=0.52*fade;
      } else e.core.quaternion.identity();
    }
  }

  clear(): void {
    for (const e of this.effects) { e.hazard=null; e.root.visible=false; }
    this.lastSnapshot=-1;
  }
}
