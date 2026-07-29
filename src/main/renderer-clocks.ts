interface Clock {
  readonly offsetUs: number;
}

export interface TranslatedRendererTime {
  readonly synchronized: boolean;
  readonly timestampUs: number;
}

export class RendererClocks<Owner extends object> {
  private readonly byOwner = new WeakMap<Owner, Clock>();

  synchronize(owner: Owner, offsetUs: number): void {
    this.byOwner.set(owner, { offsetUs });
  }

  translate(
    owner: Owner,
    rendererTimestampUs: number,
    fallbackTimestampUs: number,
  ): TranslatedRendererTime {
    const clock = this.byOwner.get(owner);
    if (!clock) {
      return {
        synchronized: false,
        timestampUs: fallbackTimestampUs,
      };
    }
    return {
      synchronized: true,
      timestampUs: Math.max(
        0,
        Math.round(rendererTimestampUs + clock.offsetUs),
      ),
    };
  }
}
