// Refreshes the GeoIP database the launcher ships: downloads DB-IP's "IP to Country Lite" mmdb
// for the current month (the previous month when DB-IP has not published it yet), gunzips it to
// `resources/geoip/dbip-country-lite.mmdb` and records its month and sha256 in `source.json`.
// `electron-builder.yml` packages `resources/geoip` as `extraResources`; the files are committed.
//
// Run by hand: `node scripts/update-geoip.mjs` (or `npm run update:geoip`).
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const GEOIP_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'resources', 'geoip')

function monthString(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function download(month) {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const now = new Date()
const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
let month = monthString(now)
let gzipped = await download(month)
if (gzipped === null) {
  month = monthString(previous)
  gzipped = await download(month)
}
if (gzipped === null) throw new Error('DB-IP publishes neither the current nor the previous month')

const mmdb = gunzipSync(gzipped)
const sha256 = createHash('sha256').update(mmdb).digest('hex')

mkdirSync(GEOIP_DIR, { recursive: true })
const target = join(GEOIP_DIR, 'dbip-country-lite.mmdb')
writeFileSync(`${target}.tmp`, mmdb)
renameSync(`${target}.tmp`, target)
writeFileSync(join(GEOIP_DIR, 'source.json'), `${JSON.stringify({ month, sha256 }, null, 2)}\n`)
console.log(`dbip-country-lite ${month}: ${mmdb.length} bytes, sha256 ${sha256}`)
