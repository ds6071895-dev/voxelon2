interface SavedComfort { reducedMotion: boolean; photosensitivitySafe: boolean; cameraShake: number }

/** Saved settings keep their serialization; OS motion preference is effective presentation only. */
export class Comfort {
  /** The OS preference, kept from change events: `matches` re-evaluates the
   *  query on every read, and this is read several times a frame. */
  private osReduced: boolean;
  constructor(private readonly saved: SavedComfort,
    motion: Pick<MediaQueryList, 'matches'> & Partial<Pick<MediaQueryList, 'addEventListener'>> = window.matchMedia('(prefers-reduced-motion: reduce)')) {
    this.osReduced = motion.matches;
    motion.addEventListener?.('change', () => { this.osReduced = motion.matches; });
  }
  get reducedMotion(): boolean { return this.saved.reducedMotion || this.osReduced; }
  get photosensitivitySafe(): boolean { return this.saved.photosensitivitySafe; }
  get cameraShake(): number { return this.saved.cameraShake; }
  syncBody(): void {
    document.body.classList.toggle('reduced-motion', this.reducedMotion);
    document.body.classList.toggle('photosensitivity-safe', this.photosensitivitySafe);
  }
}
