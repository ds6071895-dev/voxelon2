import * as THREE from 'three';
import type { EncounterSnapshot } from './vault_encounter';

/** Arena-scale presentation for awakening, transformations and the final blow.
 * Transparent effects stay near the boss; the player's escape routes stay clear. */
export class BossStageEffects {
  private readonly root=new THREE.Group();
  private readonly motes: THREE.InstancedMesh;
  private readonly wave: THREE.Mesh<THREE.TorusGeometry,THREE.MeshBasicMaterial>;
  private readonly shell: THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>;
  private readonly pose=new THREE.Object3D();
  private phase=0;
  private status='';
  private id='';
  private transitionAt=-100;

  constructor(parent: THREE.Group) {
    this.root.name='boss-stage'; parent.add(this.root);
    this.motes=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,
        blending:THREE.AdditiveBlending,depthWrite:false}),96);
    this.motes.frustumCulled=false;
    this.motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wave=new THREE.Mesh(new THREE.TorusGeometry(1,0.035,10,96),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.4,
        blending:THREE.AdditiveBlending,depthWrite:false}));
    this.wave.rotation.x=-Math.PI/2;
    this.shell=new THREE.Mesh(new THREE.SphereGeometry(1,40,24),new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{color:{value:new THREE.Color()},strength:{value:0}},
      vertexShader:`varying vec3 normalV; varying vec3 eyeV;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
          normalV=normalize(normalMatrix*normal);eyeV=normalize(-p.xyz);
          gl_Position=projectionMatrix*p;}`,
      fragmentShader:`uniform vec3 color; uniform float strength;
        varying vec3 normalV; varying vec3 eyeV;
        void main(){float rim=pow(1.0-abs(dot(normalize(normalV),normalize(eyeV))),2.5);
          gl_FragColor=vec4(color,(0.035+rim*0.45)*strength);}`,
    }));
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,
      vertexShader:`varying vec2 coord;void main(){coord=uv*2.0-1.0;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 coord;void main(){float a=1.0-smoothstep(0.0,1.0,length(coord));
        gl_FragColor=vec4(0.015,0.01,0.025,a*0.38);}`,
    }));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=0.025;
    this.root.add(shadow,this.motes,this.wave,this.shell);
  }

  update(s: EncounterSnapshot,color: number,reduced: boolean): void {
    const alive=s.status==='intro' || s.status==='active' || s.status==='victory';
    this.root.visible=alive;
    if (!alive) return;
    if (this.id!==s.encounterId) {this.id=s.encounterId;this.phase=0;this.status='';}
    if (this.phase!==s.phase || this.status!==s.status) {
      if (s.status==='intro' || s.status==='victory' || this.phase!==s.phase) this.transitionAt=s.time;
      this.phase=s.phase; this.status=s.status;
    }
    const age=Math.max(0,s.time-this.transitionAt),victory=s.status==='victory';
    const burst=age<3.4 ? Math.sin(Math.min(1,age/3.4)*Math.PI) : 0;
    const motionTime=reduced ? 0 : s.time;
    const height=s.kind==='mire_queen' ? 1.2 : s.kind==='ember_colossus' ? 2.3 : 3;
    this.root.position.set(s.boss.position.x,s.boss.position.y,s.boss.position.z);
    const tint=victory ? 0xffdf95 : color;
    const material=this.motes.material as THREE.MeshBasicMaterial;
    material.color.set(tint); material.opacity=reduced ? 0.2 : 0.35+burst*0.25;
    this.motes.count=reduced ? 16 : 48+s.phase*16;
    for (let i=0;i<this.motes.count;i++) {
      const u=i/this.motes.count,a=i*2.399963+motionTime*(0.12+s.phase*0.025);
      const rise=(u*7+motionTime*(victory ? 0.55 : 0.25))%5;
      const radius=1.5+Math.sin(i*17)*0.5+(reduced ? 0 : burst*2.5*u);
      this.pose.position.set(Math.cos(a)*radius,rise,Math.sin(a)*radius);
      const size=0.025+(i%5)*0.009;
      this.pose.scale.set(size,size*(s.family==='ember' ? 2.8 : 1),size);
      this.pose.updateMatrix(); this.motes.setMatrixAt(i,this.pose.matrix);
    }
    this.motes.instanceMatrix.needsUpdate=true;
    this.shell.visible=burst>0 && !reduced;
    this.shell.position.y=height;
    this.shell.scale.setScalar(1.2+burst*(victory ? 2.1 : 1.2));
    this.shell.material.uniforms.color.value.set(tint);
    this.shell.material.uniforms.strength.value=burst*0.7;
    this.wave.visible=age<2.4 && !reduced;
    this.wave.position.y=0.06;
    this.wave.scale.setScalar(1+age*3.2);
    this.wave.material.color.set(tint);
    this.wave.material.opacity=Math.max(0,1-age/2.4)*0.32;
  }

  hide(): void {this.root.visible=false;this.id='';}
}
