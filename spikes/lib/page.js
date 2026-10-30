// Page-side helpers shared by the stepped-engine spikes (served as /lib/page.js).

export const spike = window.spike
export const report = (obj) => spike.report(obj)
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function watchCsp() {
  window.addEventListener('securitypolicyviolation', (e) =>
    report({ type: 'csp', directive: e.effectiveDirective, blockedURI: e.blockedURI }),
  )
}

export async function loadData() {
  const { files: manifest } = await (await fetch('data/manifest.json')).json()
  return Promise.all(
    manifest.map(async ({ index, vpath }) => {
      const response = await fetch(`data/${index}`)
      if (!response.ok) throw new Error(`data/${index} (${vpath}): HTTP ${response.status}`)
      return { vpath, bytes: new Uint8Array(await response.arrayBuffer()) }
    }),
  )
}
