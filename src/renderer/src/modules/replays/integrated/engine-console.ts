const CAPACITY = 500

let ring: string[] = []

/** Both stdout and stderr of the engine land here; the oldest line is dropped past the capacity. */
export function pushLine(text: string): void {
  ring.push(text)
  if (ring.length > CAPACITY) ring = ring.slice(ring.length - CAPACITY)
}

export function consoleLines(): string[] {
  return [...ring]
}

export function clearConsole(): void {
  ring = []
}
