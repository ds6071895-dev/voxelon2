// java.util.Random, bit for bit (48-bit LCG), so arenas the plugin built from
// a seed come out block-identical here.

const MULT = 0x5DEECE66Dn, ADD = 0xBn, MASK = (1n << 48n) - 1n;

export class JavaRandom {
  private seed: bigint;
  private gaussian: number | null = null;
  constructor(seed: number | bigint) { this.seed = (BigInt.asIntN(64, BigInt(seed)) ^ MULT) & MASK; }
  private next(bits: number): number {
    this.seed = (this.seed * MULT + ADD) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number, val: number;
    do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 0x7fffffff);
    return val;
  }
  nextDouble(): number { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; }
  nextBoolean(): boolean { return this.next(1) !== 0; }
  nextFloat(): number { return this.next(24) / 16777216; }
  clone(): JavaRandom { const r=new JavaRandom(0);r.seed=this.seed;r.gaussian=this.gaussian;return r; }
  nextGaussian(): number {
    if (this.gaussian !== null) { const v=this.gaussian; this.gaussian=null; return v; }
    let x:number,y:number,s:number;
    do { x=2*this.nextDouble()-1; y=2*this.nextDouble()-1; s=x*x+y*y; } while(s>=1||s===0);
    const scale=Math.sqrt(-2*Math.log(s)/s); this.gaussian=y*scale; return x*scale;
  }
  nextLong(): bigint { return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))); }
}
