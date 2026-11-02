// Arena geometry ported from the AutoBox Party Games builders.
import { Deco, E, N, S, W, step } from '../vanilla/deco';
import { house, well, STYLE, noise } from './buildings';
import type { ArenaDef } from './arena';
const mod = (x: number, n: number) => ((x % n) + n) % n;
void [E,N,S,W,step,house,well,STYLE,noise,mod];

export const LAVACLIMB_ARENA: ArenaDef = (() => {
const SUMMIT=44,CORE=4,CRATER=13;
    function build(d: Deco): void {
        // Crater floor.
        d.disc(0, -1, 0, CRATER + 1.5, 'basalt');
        d.disc(0, -2, 0, CRATER + 1.5, 'blackstone');
        // The spire.
        for (let y = -1; y < SUMMIT; y++) {
            for (let x = -CORE; x <= CORE; x++) {
                for (let z = -CORE; z <= CORE; z++) {
                    if (Deco.inDisc(x, z, CORE - 0.5)) {
                        let vein = Math.sin(x * 1.3 + y * 0.45) * Math.cos(z * 1.1 - y * 0.3);
                        d.set(x, y, z, vein > 0.85 ? 'magma_block' : (x + y + z) % 5 == 0 ? 'basalt' : 'blackstone');
                    }
                }
            }
        }
        // Summit with the bell.
        d.disc(0, SUMMIT, 0, 5, 'polished_blackstone_bricks');
        d.ring(0, SUMMIT, 0, 5, 5, 'gilded_blackstone');
        d.disc(0, SUMMIT - 1, 0, 4, 'polished_blackstone');
        d.set(0, SUMMIT + 1, 0, 'gold_block');
        d.data(0, SUMMIT + 2, 0, "bell[attachment=floor,facing=north,powered=false]");
        for (const p of [[3, 3], [-3, 3], [3, -3], [-3, -3]]) {
            d.lampPost(p[0], SUMMIT + 1, p[1], 1, 'nether_brick_fence', true);
        }
        rim(d);
    }

    function rim(d: Deco): void {
        for (let x = -30; x <= 30; x++) {
            for (let z = -30; z <= 30; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r < CRATER + 1.5 || r > 30.5) {
                    continue;
                }
                let angle = Math.atan2(z, x);
                let top = Math.round(50 - Math.max(0, r - 16.5) * 2.6 + Math.sin(angle * 4) * 2);
                let inner = r < CRATER + 3.5;
                let bottom = inner ? -4 : top - 3;
                for (let y = bottom; y <= top; y++) {
                    let n = Math.sin(x * 0.7 + y * 0.31) + Math.cos(z * 0.6 - y * 0.27);
                    let m = y == top ? (r > 25 ? 'tuff' : 'blackstone')
                            : n > 1.3 ? 'magma_block' : n > 0.6 ? 'basalt' : n < -1.2 ? 'tuff' : 'blackstone';
                    if (m == 'basalt') {
                        d.log(x, y, z, m, "y");
                    } else {
                        d.set(x, y, z, m);
                    }
                }
            }
        }
        d.underside(0, -4, 0, 30, 9, 'blackstone', 'basalt', 'tuff');
        // Lava falls down the inner wall and smoke from the rim.
        for (let i = 0; i < 5; i++) {
            let a = Math.PI * 2 * i / 5 + 0.3;
            let x = Math.round(Math.cos(a) * (CRATER + 2)), z = Math.round(Math.sin(a) * (CRATER + 2));
            for (let y = 0; y <= 46; y++) {
                d.data(x, y, z, "lava[level=0]");
            }
        }
        for (let i = 0; i < 8; i++) {
            let a = Math.PI * 2 * i / 8;
            let x = Math.round(Math.cos(a) * 18), z = Math.round(Math.sin(a) * 18);
            let top = Math.round(50 - Math.max(0, Math.sqrt(x * x + z * z) - 16.5) * 2.6 + Math.sin(Math.atan2(z, x) * 4) * 2);
            d.campfire(x, top + 1, z);
        }
    }


return { id: 'lava_climb', build };
})();
