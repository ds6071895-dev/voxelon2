import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBossModel, type Mob } from '../src/mobs';
import type { Atlas } from '../src/textures';
import { VaultEncounterVisuals } from '../src/vault_visuals';
import { BOSS_DEFINITIONS, VaultEncounter, hazardContains,
  type EncounterHazard, type HazardShape } from '../src/vault_encounter';
import type { VaultBossKind } from '../src/vaults';

for (const kind of Object.keys(BOSS_DEFINITIONS) as VaultBossKind[]) {
  const group=new THREE.Group();
  const mob={model:{group,head:null,legs:[]},bossParts:[],bossMaterials:[]} as unknown as Mob;
  buildBossModel(mob,kind,{} as Atlas);
  let triangles=0, textured=0;
  group.traverse(object=>{
    if (!(object instanceof THREE.Mesh)) return;
    const geometry=object.geometry as THREE.BufferGeometry;
    triangles+=(geometry.index?.count ?? geometry.attributes.position.count)/3;
    for (const value of geometry.attributes.position.array) assert.ok(Number.isFinite(value));
    const material=object.material as THREE.MeshMatcapMaterial;
    if (material.isMeshMatcapMaterial) {
      assert.ok(material.map && material.bumpMap && material.matcap,`${kind}: surface has color, relief and lighting`);
      assert.ok(geometry.attributes.uv,`${kind}: textured surface has UVs`);
      textured++;
    }
  });
  assert.ok(textured>20 && triangles>9000,`${kind}: detailed rig is present`);
  const bounds=new THREE.Box3().setFromObject(group);
  assert.ok(bounds.min.y>-0.15 && bounds.max.y<3.4,`${kind}: model fits the lair height`);
  assert.ok(bounds.getSize(new THREE.Vector3()).length()<6,`${kind}: no stray geometry`);
  console.log(`PASS ${kind}: ${Math.round(triangles)} triangles, ${textured} textured pieces, finite bounds`);
}

const encounter=new VaultEncounter({encounterId:'visual-test',seed:1,tier:1,
  kind:'crystal_seer',family:'crystal',center:{x:0,y:0,z:0},
  bounds:{minX:-20,minY:0,minZ:-20,maxX:20,maxY:10,maxZ:20},
  sockets:[],cameraAnchors:[],startTime:0});
const snapshot=encounter.snapshot(); snapshot.status='active'; snapshot.time=1;
const scene=new THREE.Scene(), visuals=new VaultEncounterVisuals(scene);
const ray=new THREE.Raycaster();
// Interior/exterior points exercise every quadrant and arbitrary lane angles.
for (const shape of ['line','cone','quadrant','ring','circle','rain'] as HazardShape[]) {
  for (let quadrant=0;quadrant<4;quadrant++) {
    const angle=quadrant*Math.PI/2+0.37;
    const h: EncounterHazard={id:quadrant,shape,origin:{x:2,y:0,z:-3},
      target:{x:2+Math.cos(angle),y:0,z:-3+Math.sin(angle)},radius:4,width:1,
      angle:Math.PI/3,telegraphAt:0,executeAt:2,expiresAt:2.4,damage:5,
      attack:'test',hitParticipants:[]};
    snapshot.hazards=[h]; visuals.update(snapshot); scene.updateMatrixWorld(true);
    const marker=scene.getObjectByName('boss-telegraph-0')!;
    for (let i=0;i<64;i++) {
      const a=i*2.399963,r=0.25+(i%8)*0.8;
      const point={x:h.origin.x+Math.cos(a)*r,y:0,z:h.origin.z+Math.sin(a)*r};
      ray.set(new THREE.Vector3(point.x,5,point.z),new THREE.Vector3(0,-1,0));
      const visible=ray.intersectObject(marker,false).length>0;
      assert.equal(visible,hazardContains(h,point),`${shape}/${quadrant}: visible marker matches damage at ${i}`);
    }
  }
  console.log(`PASS ${shape}: visual footprint matches authoritative damage in every direction`);
}

visuals.hide();
snapshot.hazards=[{...snapshot.hazards[0],id:99,shape:'line',executeAt:1.2,expiresAt:1.5}];
snapshot.time=1.3; visuals.update(snapshot);
const effects=scene.getObjectByName('boss-attack-effects')!;
assert.ok(effects.children.some(c=>c.visible),'attack creates a 3D effect');
snapshot.hazards=[]; snapshot.time=1.6; visuals.update(snapshot);
assert.ok(effects.children.some(c=>c.visible),'aftermath survives snapshot hazard removal');
snapshot.time=3; visuals.update(snapshot);
assert.ok(effects.children.every(c=>!c.visible),'aftermath expires');
visuals.update(null);
assert.equal(scene.getObjectByName('vault-encounter-visuals')!.visible,false,'leaving clears all visuals');
console.log('PASS attack effects spawn, linger, expire and clear on encounter exit');
