interface SavedComfort { reducedMotion: boolean; photosensitivitySafe: boolean; cameraShake: number }

/** Saved settings keep their serialization; OS motion preference is effective presentation only. */
export class Comfort {
  constructor(private readonly saved: SavedComfort,
    private readonly motion: Pick<MediaQueryList, 'matches'> = window.matchMedia('(prefers-reduced-motion: reduce)')) {}
  get reducedMotion(): boolean { return this.saved.reducedMotion || this.motion.matches; }
  get photosensitivitySafe(): boolean { return this.saved.photosensitivitySafe; }
  get cameraShake(): number { return this.saved.cameraShake; }
  syncBody(): void {
    document.body.classList.toggle('reduced-motion', this.reducedMotion);
    document.body.classList.toggle('photosensitivity-safe', this.photosensitivitySafe);
  }
}
