/** The block-data view used by physics. Both streamed worlds and CPU bot
 *  shims implement it without depending on terrain meshes or a renderer. */
export interface PhysicsWorld {
  getBlock(wx: number, wy: number, wz: number): number;
  /** Optional for finite CPU worlds. Real streamed worlds provide this so
   *  collision retains its existing unloaded-column guard. */
  isLoaded?(wx: number, wz: number): boolean;
}
