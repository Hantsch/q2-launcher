import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(
  new URL(
    '../../engine/patches/0009-web-integrated-canvas-host-keys-size-and-exports.patch',
    import.meta.url,
  ),
  'utf8',
).replace(/\r\n/g, '\n')

const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
const has = (lines, re) => lines.some((l) => re.test(l))

describe('integrated canvas host engine patch', () => {
  it('the engine targets the launcher canvas element', () => {
    expect(has(added, /#define TARGET\s+"#q2l-engine-canvas"/)).toBe(true)
    expect(has(removed, /#define TARGET\s+"canvas"/)).toBe(true)
  })

  it('the engine takes keys only from its canvas and never locks the pointer', () => {
    expect(has(added, /emscripten_set_keydown_callback\s*\(TARGET,/)).toBe(true)
    expect(has(added, /emscripten_set_keyup_callback\s*\(TARGET,/)).toBe(true)
    expect(has(removed, /set_key(down|up)_callback.*EMSCRIPTEN_EVENT_TARGET_WINDOW/)).toBe(true)
    expect(has(added, /set_key(down|up)_callback.*EMSCRIPTEN_EVENT_TARGET_WINDOW/)).toBe(false)
    expect(has(removed, /emscripten_request_pointerlock/)).toBe(true)
    expect(has(added, /emscripten_request_pointerlock/)).toBe(false)
    // Context lines are the code that remains: no request may survive there either.
    const kept = patch.split('\n').filter((l) => l.startsWith(' '))
    expect(has(kept, /emscripten_request_pointerlock/)).toBe(false)
  })

  it('the engine never sizes the canvas and the host resizes through q2l_resize', () => {
    expect(has(removed, /emscripten_set_canvas_element_size/)).toBe(true)
    expect(has(added, /emscripten_set_canvas_element_size/)).toBe(false)
    expect(patch).toMatch(
      /\+EMSCRIPTEN_KEEPALIVE void q2l_resize\(void\)\n\+\{\n\+ {4}mode_changed\(\);/,
    )
  })

  it('the console export queues text on the command buffer', () => {
    expect(patch).toMatch(
      /\+EMSCRIPTEN_KEEPALIVE void q2l_console\(const char \*text\)\n\+\{\n\+ {4}Cbuf_AddText\(&cmd_buffer, text\);/,
    )
  })

  it('the link flags export the host entry points', () => {
    const fns = added.find((l) => l.includes('-sEXPORTED_FUNCTIONS='))
    expect(fns).toMatch(/_q2l_resize/)
    expect(fns).toMatch(/_q2l_console/)
    const methods = added.find((l) => l.includes('-sEXPORTED_RUNTIME_METHODS='))
    for (const m of ['pauseMainLoop', 'resumeMainLoop', 'ccall']) expect(methods).toContain(m)
  })
})
