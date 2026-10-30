import { describe, expect, it } from 'vitest'
import { checkSymbols, configReport, orderPatches, parseArgs, readUpstream } from './lib.mjs'

const SHA = 'a'.repeat(40)

const dump = (extra = '') => `
Import[2]:
 - func[0] sig=1 <env.emscripten_resize_heap> <- env.emscripten_resize_heap
 - func[1] sig=2 <env.js_log> <- env.js_log
Function[3]:
 - func[2] sig=3 <main>
 - func[3] sig=3 <Com_LPrintf>
 - func[4] sig=3 <CL_Init>${extra}
Export[1]:
 - func[2] <main> -> "main"
`

describe('engine build helpers', () => {
  it('reads the upstream repo and a full commit', () => {
    expect(readUpstream(`https://example.org/q2pro.git\n${SHA}\n`)).toEqual({
      repo: 'https://example.org/q2pro.git',
      commit: SHA,
    })
  })

  it('rejects a short commit or a missing line', () => {
    expect(() => readUpstream(`https://example.org/q2pro.git\n${SHA.slice(1)}`)).toThrow(/40-hex/)
    expect(() => readUpstream('https://example.org/q2pro.git')).toThrow(/missing commit/)
    expect(() => readUpstream('')).toThrow(/missing repo/)
  })

  it('patches apply in their numbered order', () => {
    expect(orderPatches(['0010-b.patch', '0002-a.patch', '0100-c.patch'])).toEqual([
      '0002-a.patch',
      '0010-b.patch',
      '0100-c.patch',
    ])
  })

  it('a malformed patch name is rejected', () => {
    expect(() => orderPatches(['1-short.patch'])).toThrow(/malformed/)
    expect(() => orderPatches(['0001-a.diff'])).toThrow(/malformed/)
    expect(() => orderPatches(['0001-a.patch', '0001-b.patch'])).toThrow(/duplicate/)
  })

  it('--opt accepts O0, O1, O2 and rejects anything else', () => {
    expect(parseArgs([]).opt).toBe('O2')
    for (const o of ['O0', 'O1', 'O2']) expect(parseArgs([`--opt=${o}`]).opt).toBe(o)
    expect(() => parseArgs(['--opt=O3'])).toThrow()
    expect(parseArgs(['--check-config', '--patches-dir=p'])).toMatchObject({
      checkConfig: true,
      patchesDir: 'p',
    })
  })

  it('the config report lists disabled features and every target', () => {
    const lines = configReport(
      [
        { name: 'libcurl', value: 'disabled' },
        { name: 'openal', value: 'disabled' },
        { name: 'optimization', value: '2' },
      ],
      [{ name: 'q2pro' }, { name: 'q2proded' }],
    )
    expect(lines).toContain('libcurl=disabled')
    expect(lines).toContain('openal=disabled')
    expect(lines).toContain('optimization=2')
    expect(lines).toContain('sdl2=unset')
    expect(lines.filter((l) => l.startsWith('target: '))).toEqual([
      'target: q2pro',
      'target: q2proded',
    ])
  })

  it('a forbidden import name fails the check', () => {
    const r = checkSymbols(dump('\n - func[5] sig=3 <env.curl_easy_init> <- env.curl_easy_init'))
    expect(r.ok).toBe(false)
    expect(r.forbidden).toContain('curl_easy_init')
  })

  it('a patch name with whitespace is rejected', () => {
    expect(() => orderPatches(['0001-a b.patch'])).toThrow(/malformed/)
  })

  it('a forbidden symbol fails the check', () => {
    const r = checkSymbols(
      dump('\n - func[5] sig=3 <GetGameAPI>\n - func[6] sig=3 <curl_easy_init>'),
    )
    expect(r.ok).toBe(false)
    expect(r.forbidden).toEqual(['GetGameAPI', 'curl_easy_init'])
  })

  it('listen-server code in the client passes, the dedicated terminal console fails', () => {
    expect(
      checkSymbols(dump('\n - func[5] sig=3 <SV_InitGameProgs>\n - func[6] sig=3 <SV_Init>')).ok,
    ).toBe(true)
    expect(checkSymbols(dump('\n - func[5] sig=3 <Sys_RunConsole>')).forbidden).toEqual([
      'Sys_RunConsole',
    ])
  })

  it('output without the required names fails the check', () => {
    expect(checkSymbols('')).toMatchObject({
      ok: false,
      missingRequired: ['main', 'Com_LPrintf', 'CL_Init'],
    })
    const r = checkSymbols(dump().replace('<CL_Init>', '<other>'))
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toEqual(['CL_Init'])
  })
})
