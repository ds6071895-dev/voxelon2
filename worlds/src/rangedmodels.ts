import * as THREE from 'three';

// Solid crossbow and trident models for the hand (first person and avatars),
// built like bowmodel.ts: unit boxes with baked face shading, each copy with
// its own moving parts. Both face -Z with the grip at the origin.

const box = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(.5, 1, 4);
for (const geometry of [box, cone]) {
  const normals = geometry.getAttribute('normal');
  const colors: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const shade = .78 + normals.getY(i) * .14 + normals.getX(i) * .08;
    colors.push(shade, shade, shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}
const mat = (color: number) => new THREE.MeshBasicMaterial({ color, vertexColors: true });
const wood = mat(0x7a4b2c), woodLight = mat(0xa8774a), iron = mat(0xb9c4cc), dark = mat(0x3b3438);
const cord = mat(0xf3e3b8), feather = mat(0xe8ecef);
const prong = mat(0x4fb7ad), prongLight = mat(0x9ce6da), shaftMat = mat(0x2f716e), gold = mat(0xe0b44a);
const up = new THREE.Vector3(0, 1, 0);
const delta = new THREE.Vector3();

function part(parent: THREE.Object3D, name: string, m: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number, geo: THREE.BufferGeometry = box): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  parent.add(mesh);
  return mesh;
}
function segment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number): void {
  delta.subVectors(b, a);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.set(width, delta.length(), depth);
  mesh.quaternion.setFromUnitVectors(up, delta.normalize());
}

/** A crossbow: stock along -Z, limbs across X at the front, a bolt on top when loaded. */
export function createCrossbowModel(): THREE.Group {
  const root = new THREE.Group();
  part(root, 'stock', wood, 0, 0, -.12, .07, .07, .62);
  part(root, 'butt', wood, 0, -.035, .2, .08, .11, .1);
  part(root, 'grip', dark, 0, -.09, .08, .055, .12, .06);
  part(root, 'trigger', iron, 0, -.06, .0, .015, .05, .02);
  part(root, 'rail', woodLight, 0, .04, -.16, .03, .012, .5);
  part(root, 'stirrup', iron, 0, 0, -.45, .11, .02, .03);
  part(root, 'nut', iron, 0, .045, .02, .04, .03, .03);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) part(root, `limb${side}:${i}`, i ? woodLight : wood, 0, 0, 0, 1, 1, 1);
    part(root, `tip${side}`, iron, 0, 0, 0, .03, .03, .03);
    part(root, `string${side}`, cord, 0, 0, 0, 1, 1, 1);
  }
  const bolt = new THREE.Group();
  bolt.name = 'bolt';
  part(bolt, 'shaft', woodLight, 0, 0, -.2, .014, .014, .42);
  part(bolt, 'head', iron, 0, 0, -.44, .035, .07, .035, cone).rotation.x = -Math.PI / 2;
  part(bolt, 'fletch', feather, 0, 0, -.03, .045, .008, .07);
  root.add(bolt);
  const rocket = new THREE.Group();
  rocket.name = 'rocket';
  part(rocket, 'tube', mat(0xc23a3a), 0, 0, -.2, .045, .045, .3);
  part(rocket, 'cap', gold, 0, 0, -.38, .05, .07, .05, cone).rotation.x = -Math.PI / 2;
  root.add(rocket);
  root.add(Object.assign(new THREE.Object3D(), { name: 'nockPoint' }));
  poseCrossbow(root, 0, null);
  return root;
}

/** charge 0..1 pulls the string back to the nut; `loaded` shows the bolt or rocket. */
export function poseCrossbow(root: THREE.Object3D, charge: number, loaded: 'arrow' | 'rocket' | null): void {
  const c = THREE.MathUtils.clamp(loaded ? 1 : charge, 0, 1);
  const z0 = -.43;
  const nock = new THREE.Vector3(0, .05, z0 + .08 + c * .37);
  root.getObjectByName('nockPoint')!.position.copy(nock);
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(side * .04, .02, z0),
      new THREE.Vector3(side * (.19 - c * .015), .03, z0 + .02 + c * .04),
      new THREE.Vector3(side * (.3 - c * .04), .04, z0 + .07 + c * .1),
    ];
    for (let i = 0; i < 2; i++) segment(root.getObjectByName(`limb${side}:${i}`)!, pts[i], pts[i + 1], .045 - i * .01, .03);
    root.getObjectByName(`tip${side}`)!.position.copy(pts[2]);
    segment(root.getObjectByName(`string${side}`)!, pts[2], nock, .006, .006);
  }
  const bolt = root.getObjectByName('bolt')!, rocket = root.getObjectByName('rocket')!;
  bolt.visible = loaded === 'arrow' || (!loaded && c > .35);
  rocket.visible = loaded === 'rocket';
  bolt.position.set(0, .06, nock.z - .02 + (loaded ? 0 : (1 - c) * .1));
  rocket.position.set(0, .075, nock.z);
}

/** A trident: shaft along -Z, three prongs at the far end, grip near the middle. */
export function createTridentModel(): THREE.Group {
  const root = new THREE.Group();
  part(root, 'shaft', shaftMat, 0, 0, -.2, .045, .045, 1.15);
  part(root, 'grip', dark, 0, 0, .02, .056, .056, .2);
  part(root, 'pommel', prongLight, 0, 0, .39, .05, .05, .05);
  part(root, 'collar', gold, 0, 0, -.73, .07, .07, .04);
  part(root, 'cross', prong, 0, 0, -.79, .26, .04, .04);
  for (const x of [-.12, 0, .12]) {
    const len = x === 0 ? .26 : .19;
    part(root, `prong${x}`, prong, x, 0, -.81 - len / 2, .035, .035, len);
    part(root, `barb${x}`, prongLight, x, 0, -.81 - len - .03, .05, .07, .05, cone).rotation.x = -Math.PI / 2;
  }
  return root;
}

export function poseRangedModel(root: THREE.Object3D, kind: 'crossbow' | 'trident', view: 'firstPerson' | 'avatar'): void {
  if (view === 'firstPerson') {
    if (kind === 'crossbow') { root.scale.setScalar(.85); root.rotation.set(.06, -.06, -.06); root.position.set(-.03, .05, -.06); }
    else { root.scale.setScalar(.95); root.rotation.set(.12, -.22, -.08); root.position.set(-.02, .1, -.14); }
  } else if (kind === 'crossbow') {
    root.position.set(0, -.52, -.1); root.rotation.set(-.15, 0, 0); root.scale.setScalar(.85);
  } else {
    root.position.set(0, -.55, -.05); root.rotation.set(-.35, 0, 0); root.scale.setScalar(.9);
  }
}
