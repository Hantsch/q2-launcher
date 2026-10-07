/** Anything that can report whether its pending writes reached the disk. */
export interface Settleable {
  settle(): Promise<{ ok: boolean }>
}

export interface SettleReport {
  label: string
  ok: boolean
}

/**
 * Every persisted store registers here so shutdown can wait for all of them and learn which one
 * failed. `settleAll` is the only thing shutdown awaits, so it must never reject.
 */
export class PersistenceRegistry {
  private readonly stores: { label: string; store: Settleable }[] = []

  register(label: string, store: Settleable): void {
    this.stores.push({ label, store })
  }

  async settleAll(): Promise<SettleReport[]> {
    return Promise.all(
      this.stores.map(async ({ label, store }) => {
        try {
          const { ok } = await store.settle()
          return { label, ok }
        } catch {
          return { label, ok: false }
        }
      }),
    )
  }
}
