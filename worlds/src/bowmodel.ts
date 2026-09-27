import * as THREE from 'three';

// Shared solid geometry; each copy has its own moving limbs and string.
const box = new THREE.BoxGeometry(1, 1, 1);
const arrowhead = new THREE.ConeGeometry(.028, .085, 4);
// Baked face shading keeps the solid edges readable in the unlit held pass.
for (const geometry of [box, arrowhead]) {
  const normals = geometry.getAttribute('normal');
  const colors: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const shade = .78 + normals.getY(i) * .14 + normals.getX(i) * .08;
    colors.push(shade, shade, shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}
const wood = new THREE.MeshBasicMaterial({ color: 0x855333, vertexColors: true });
const edge = new THREE.MeshBasicMaterial({ color: 0xd4ad70, vertexColors: true });
const leather = new THREE.MeshBasicMaterial({ color: 0x342b30, vertexColors: true });
const steel = new THREE.MeshBasicMaterial({ color: 0xc8e1ec, vertexColors: true });
const cord = new THREE.MeshBasicMaterial({ color: 0xf3e3b8, vertexColors: true });
const feather = new THREE.MeshBasicMaterial({ color: 0x69bfd1, vertexColors: true });
const up = new THREE.Vector3(0, 1, 0);
const delta = new THREE.Vector3();

function part(parent: THREE.Object3D, name: string, mat: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(box, mat);
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

/** A laminated recurve, facing -Z, with the grip at the origin. */
export function createBowModel(): THREE.Group {
  const root = new THREE.Group();
  part(root, 'grip', leather, 0, 0, 0, .075, .20, .09);
  for (let i = -2; i <= 2; i++)
    part(root, 'wrap', edge, 0, i * .033, .047, .079, .009, .012);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      part(root, `limb${side}:${i}`, wood, 0, 0, 0, 1, 1, 1);
      part(root, `edge${side}:${i}`, edge, 0, 0, 0, 1, 1, 1);
    }
    part(root, `tip${side}`, steel, 0, 0, 0, .055, .045, .055);
    part(root, `string${side}`, cord, 0, 0, 0, 1, 1, 1);
  }
  const arrow = new THREE.Group();
  arrow.name = 'arrow';
  part(arrow, 'shaft', edge, .055, 0, -.38, .012, .012, .76);
  const head = new THREE.Mesh(arrowhead, steel);
  head.rotation.x = -Math.PI / 2;
  head.position.set(.055, 0, -.80);
  arrow.add(head);
  part(arrow, 'fletching', feather, .055, 0, -.07, .055, .008, .11);
  part(arrow, 'fletching2', feather, .055, 0, -.07, .008, .055, .11);
  root.add(arrow);
  const nock = new THREE.Object3D();
  nock.name = 'nock';
  root.add(nock);
  poseBowDraw(root, 0);
  return root;
}

export function poseBowDraw(root: THREE.Object3D, power: number, release = 0, time = 0): void {
  const p = THREE.MathUtils.clamp(power, 0, 1);
  const nock = new THREE.Vector3(.055, .11, .12 + p * .38 + Math.sin(time * 85) * release * .035);
  root.getObjectByName('nock')!.position.copy(nock);
  for (const side of [-1, 1]) {
    const points = [
      new THREE.Vector3(0, side * .09, 0),
      new THREE.Vector3(0, side * .23, -.045 + p * .025),
      new THREE.Vector3(0, side * (.39 - p * .025), -.015 + p * .08),
      new THREE.Vector3(0, side * (.52 - p * .055), .08 + p * .13),
      new THREE.Vector3(0, side * (.58 - p * .065), .04 + p * .17),
    ];
    for (let i = 0; i < 4; i++) {
      segment(root.getObjectByName(`limb${side}:${i}`)!, points[i], points[i + 1], .062 - i * .008, .042);
      const trim = root.getObjectByName(`edge${side}:${i}`)!;
      segment(trim, points[i], points[i + 1], .066 - i * .008, .008);
      trim.position.z -= .022;
    }
    root.getObjectByName(`tip${side}`)!.position.copy(points[4]);
    segment(root.getObjectByName(`string${side}`)!, points[4], nock, .006, .006);
  }
  const arrow = root.getObjectByName('arrow')!;
  arrow.position.y = nock.y;
  arrow.position.z = nock.z;
  arrow.visible = release < .15;
}

export function poseBowModel(root: THREE.Object3D, view: 'firstPerson' | 'avatar' | 'drop'): void {
  if (view === 'firstPerson') {
    root.scale.setScalar(.82);
    root.rotation.set(0, -.12, -.15);
  } else if (view === 'avatar') {
    root.position.set(0, -.48, -.2);
    root.rotation.set(-.3, 0, -.12);
  } else root.scale.setScalar(.45);
}
