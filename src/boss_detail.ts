import * as THREE from 'three';
import type { VaultBossKind } from './vaults';

/** Sculpted secondary forms attach to the existing animation pivots. */
export function detailBoss(
  root: THREE.Group, kind: VaultBossKind,
  armor: THREE.Material, trim: THREE.Material, glow: THREE.Material,
): void {
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry,
    material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const ellipsoid = (parent: THREE.Object3D, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, material = trim): THREE.Mesh => {
    const m = mesh(parent, new THREE.SphereGeometry(1, 24, 16), material, x, y, z);
    m.scale.set(sx, sy, sz); return m;
  };
  const curve = (parent: THREE.Object3D, points: number[][], radius: number,
    material = trim): void => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    mesh(parent, new THREE.TubeGeometry(path, 24, radius, 8, false), material, 0, 0, 0);
  };
  const horn = (parent: THREE.Object3D, points: number[][], radius: number): void => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const frames = path.computeFrenetFrames(24, false);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const p = path.getPointAt(i / 24), r = radius * (1 - i / 24) + 0.003;
      for (let j = 0; j <= 12; j++) {
        const a = j / 12 * Math.PI * 2;
        const v = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r)
          .addScaledVector(frames.binormals[i], Math.sin(a) * r);
        positions.push(v.x, v.y, v.z);
        uvs.push(j / 12, i / 24);
        if (i < 24 && j < 12) {
          const k = i * 13 + j;
          indices.push(k, k + 13, k + 1, k + 1, k + 13, k + 14);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    mesh(parent, geo, trim, 0, 0, 0);
  };
  const parts = (role: string): THREE.Object3D[] =>
    root.children.filter(p => p.userData.role === role);
  const replace = (object: THREE.Object3D, geometry: THREE.BufferGeometry): void => {
    const m = object as THREE.Mesh; m.geometry.dispose(); m.geometry = geometry;
  };
  const petal = (length: number, width: number): THREE.BufferGeometry => {
    const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let i=0;i<=20;i++) for (let j=0;j<=8;j++) {
      const t=i/20, s=j/4-1;
      vertices.push((t-0.5)*length, Math.sin(t*Math.PI)*0.12*(1-s*s),
        s*Math.pow(Math.sin(t*Math.PI),0.7)*width);
      uv.push(t,j/8);
      if (i<20 && j<8) { const k=i*9+j; indices.push(k,k+1,k+9,k+1,k+10,k+9); }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  };
  if (kind === 'bone_warden') {
    // A fluted, draped mantle gives the gravekeeper a continuous silhouette.
    const mantle = root.children.find(p => p instanceof THREE.Mesh &&
      p.geometry instanceof THREE.CylinderGeometry && Math.abs(p.position.y-1.42)<0.01);
    if (mantle) {
      const geometry = new THREE.CylinderGeometry(0.36,0.66,1.05,80,20,true);
      const p=geometry.attributes.position;
      for (let i=0;i<p.count;i++) {
        const y=p.getY(i),a=Math.atan2(p.getZ(i),p.getX(i));
        const fold=1+Math.cos(a*12)*0.045+Math.sin(a*7+y*2)*0.025;
        p.setXYZ(i,p.getX(i)*fold,y+Math.cos(a*6)*0.025,p.getZ(i)*fold);
      }
      geometry.computeVertexNormals(); replace(mantle,geometry);
    }
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      const y = 1.48 + i * 0.13;
      curve(root, [[0,y,0.23],[s*0.26,y+0.04,0.3],[s*0.38,y+0.1,0],
        [s*0.23,y+0.13,-0.18]], 0.035);
    }
    for (const s of [-1, 1]) {
      ellipsoid(root,s*0.51,2.1,0,0.28,0.17,0.26,armor);
      horn(root,[[s*0.49,2.14,0],[s*0.7,2.37,-0.04],[s*0.74,2.52,-0.12]],0.1);
    }
    for (const head of parts('lantern')) {
      ellipsoid(head,0,0,0.11,0.21,0.24,0.16);
      for (const s of [-1, 1]) {
        ellipsoid(head,s*0.095,0.025,0.246,0.069,0.059,0.036,armor);
        ellipsoid(head,s*0.095,0.025,0.273,0.034,0.025,0.015,glow);
      }
      for (let i = 0; i < 6; i++) ellipsoid(head,(i-2.5)*0.045,-0.17,0.24,0.019,0.048,0.03);
      for (const s of [-1,1]) {
        curve(head,[[s*0.03,0.1,0.25],[s*0.11,0.12,0.27],[s*0.18,0.07,0.23]],0.027);
        horn(head,[[s*0.17,0.2,0],[s*0.25,0.48,-0.04],[s*0.2,0.7,0.04]],0.055);
      }
    }
    for (const arm of parts('fist')) for (let i=0;i<4;i++) {
      horn(arm,[[(i-1.5)*0.055,-0.91,0.1],[(i-1.5)*0.06,-1.08,0.14],
        [(i-1.5)*0.045,-1.12,0.22]],0.027);
    }
    for (const chain of parts('chain')) {
      chain.children.forEach((p, i) => {
        const m = p as THREE.Mesh; m.geometry.dispose();
        m.geometry = new THREE.TorusGeometry(0.065,0.019,8,20);
        m.rotation.y = i % 2 * Math.PI / 2;
      });
    }
  } else if (kind === 'mire_queen') {
    for (let row = 0; row < 7; row++) for (let col = -3; col <= 3; col++) {
      const x = col * 0.2, z = 0.5 - row * 0.27;
      const p = ellipsoid(root,x,0.79 + Math.sqrt(Math.max(0,1-x*x))*0.14,z,
        0.14,0.055,0.2,row % 3 === 0 ? trim : armor);
      p.rotation.z = -col * 0.14;
    }
    for (const fin of parts('fin')) {
      replace(fin,petal(1.05,0.25));
      for (let i = 0; i < 3; i++) {
        curve(fin,[[-0.4,0,0],[-0.1,0.08,(i-1)*0.1],[0.43,0,(i-1)*0.12]],0.018,glow);
      }
    }
    for (const crown of parts('crown')) {
      replace(crown,new THREE.LatheGeometry([
        new THREE.Vector2(0,-0.39),new THREE.Vector2(0.1,-0.27),
        new THREE.Vector2(0.17,-0.06),new THREE.Vector2(0.12,0.17),
        new THREE.Vector2(0.025,0.34),new THREE.Vector2(0,0.39),
      ],32));
      crown.scale.z=0.42;
    }
    for (const head of parts('maw')) for (const s of [-1,1]) {
      ellipsoid(head,s*0.35,0.07,0.1,0.22,0.23,0.34,armor);
      horn(head,[[s*0.29,-0.12,0.4],[s*0.32,-0.39,0.48],[s*0.24,-0.47,0.51]],0.055);
      curve(head,[[s*0.4,0,0.3],[s*0.66,-0.02,0.5],[s*0.85,0.14,0.35]],0.025,glow);
    }
  } else if (kind === 'ember_colossus') {
    for (const flame of parts('flame')) {
      const geometry=new THREE.LatheGeometry([
        new THREE.Vector2(0,-0.33),new THREE.Vector2(0.23,-0.25),
        new THREE.Vector2(0.25,-0.12),new THREE.Vector2(0.16,0.04),
        new THREE.Vector2(0.11,0.14),new THREE.Vector2(0.045,0.27),new THREE.Vector2(0,0.42),
      ],40);
      const p=geometry.attributes.position;
      for (let i=0;i<p.count;i++) p.setX(i,p.getX(i)+Math.sin(p.getY(i)*8)*0.06);
      geometry.computeVertexNormals(); replace(flame,geometry);
    }
    for (const s of [-1,1]) for (let i = 0; i < 5; i++) {
      const z = 0.85-i*0.38;
      const plate = ellipsoid(root,s*0.86,1.42,z,0.44,0.22,0.32, i%2 ? armor : trim);
      plate.rotation.z = s*-0.5;
      curve(root,[[s*0.54,1.7,z],[s*0.9,1.54,z+0.05],[s*1.12,1.25,z+0.1]],0.022,glow);
    }
    for (const head of parts('caldera_head')) for (const s of [-1,1]) {
      horn(head,[[s*0.35,0.22,0],[s*0.61,0.5,0.06],[s*0.69,0.67,0.35],
        [s*0.57,0.7,0.52]],0.16);
      for (let i = 0; i < 3; i++) ellipsoid(head,s*(0.08+i*0.12),-0.23,0.34,0.047,0.09,0.04);
    }
    mesh(root,new THREE.TorusGeometry(0.42,0.08,16,64),glow,0,1.98,0.05).rotation.x=Math.PI/2;
  } else if (kind === 'crystal_seer') {
    // Nested astronomical rings and many overlapping crystal feathers.
    for (let i = 0; i < 3; i++) {
      const ring = mesh(root,new THREE.TorusGeometry(0.72+i*0.1,0.022,10,80),
        i===1 ? glow : trim,0,1.5,0);
      ring.rotation.set(i*0.7,0.5+i*0.8,0.4);
    }
    for (const wing of parts('wing')) {
      const s = Number(wing.userData.index);
      for (let i = 0; i < 8; i++) {
        const feather = mesh(wing,new THREE.CylinderGeometry(0,0.085,0.78-i*0.045,6),
          i%3===0 ? glow : trim,s*(0.28+i*0.115),0.1-i*0.08,0.08);
        feather.rotation.z = s*(-0.95+i*0.075);
      }
    }
    ellipsoid(root,0,1.56,0.54,0.09,0.135,0.025,armor);
    ellipsoid(root,-0.025,1.61,0.57,0.022,0.035,0.01,glow);
  } else {
    for (let i=0;i<5;i++) {
      const y=1.55+i*0.13;
      const collar=mesh(root,new THREE.TorusGeometry(0.22,0.04,10,32),trim,0,y,0);
      collar.rotation.x=Math.PI/2;
    }
    for (const s of [-1,1]) {
      curve(root,[[s*0.4,1.5,-0.24],[s*0.42,1.9,-0.23],[s*0.2,2.25,-0.1]],0.05,armor);
      ellipsoid(root,s*0.22,1.73,0.18,0.11,0.31,0.11,trim);
      curve(root,[[s*0.45,1.38,0.32],[s*0.25,1.75,0.38],[0,1.86,0.28]],0.023,glow);
    }
    for (const gear of parts('gear')) {
      for (let i = 0; i < 16; i++) {
        const a = i*Math.PI/8;
        const tooth = mesh(gear,new THREE.BoxGeometry(0.07,0.09,0.09),trim,
          Math.sin(a)*0.29,Math.cos(a)*0.29,0);
        tooth.rotation.z=-a;
      }
      for (let i = 0; i < 4; i++) {
        const spoke=mesh(gear,new THREE.CylinderGeometry(0.022,0.022,0.49,12),trim,0,0,0);
        spoke.rotation.z=i*Math.PI/4;
      }
      ellipsoid(gear,0,0,0.025,0.085,0.085,0.08,glow);
    }
    for (const arm of parts('tool')) {
      ellipsoid(arm,0,0,0,0.18,0.18,0.18);
      for (const s of [-1,1]) curve(arm,[[s*0.13,0.05,0],[s*0.16,0.1,-0.5],
        [s*0.1,0,-0.92]],0.035,s>0 ? glow : armor);
    }
    for (let i = 0; i < 18; i++) {
      const a = i*Math.PI/9;
      ellipsoid(root,Math.sin(a)*0.64,1.4,Math.cos(a)*0.64,0.045,0.045,0.045);
    }
  }
}
