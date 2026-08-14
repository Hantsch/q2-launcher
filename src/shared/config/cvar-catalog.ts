/**
 * Cvar catalog for the Player and Graphics panels.
 *
 * Ported verbatim (numbers, ranges, `source:` citations) from the external
 * q2-config-manager project (`src/core/settings.ts`, `PLAYER_SETTINGS` /
 * `GRAPHICS_SETTINGS`). Array membership mirrors upstream exactly: the
 * `network` cvars (`rate`, `cl_maxfps`, `cl_async`) live in `PLAYER_CVARS`
 * because upstream's `PLAYER_SETTINGS` array contained them, and the `sound`
 * cvars (`s_volume`, `s_khz`) live in `GRAPHICS_CVARS` because upstream's
 * `GRAPHICS_SETTINGS` array contained them — the `group` field on each
 * `CvarDef` still reflects its true group.
 *
 * All prose (label, description, warning, note, value-note meaning, choice
 * label) has been replaced by i18n key fields; the English text lives in
 * `src/renderer/src/i18n/locales/en.json` under `config.cvar.*`.
 */

import type { CvarDef } from './cvar-facts'

export const PLAYER_CVARS: CvarDef[] = [
  {
    name: 'name',
    labelKey: 'config.cvar.name.label',
    kind: 'text',
    group: 'player',
    descriptionKey: 'config.cvar.name.description',
    default: 'player',
    common: true,
  },
  {
    name: 'skin',
    labelKey: 'config.cvar.skin.label',
    kind: 'choice',
    group: 'player',
    descriptionKey: 'config.cvar.skin.description',
    default: 'male/grunt',
    common: true,
    choices: [
      { value: 'male/grunt', labelKey: 'config.cvar.skin.choice.male_grunt' },
      { value: 'male/cipher', labelKey: 'config.cvar.skin.choice.male_cipher' },
      { value: 'male/claymore', labelKey: 'config.cvar.skin.choice.male_claymore' },
      { value: 'male/flak', labelKey: 'config.cvar.skin.choice.male_flak' },
      { value: 'male/howitzer', labelKey: 'config.cvar.skin.choice.male_howitzer' },
      { value: 'male/nightops', labelKey: 'config.cvar.skin.choice.male_nightops' },
      { value: 'male/pointman', labelKey: 'config.cvar.skin.choice.male_pointman' },
      { value: 'male/psycho', labelKey: 'config.cvar.skin.choice.male_psycho' },
      { value: 'male/rampage', labelKey: 'config.cvar.skin.choice.male_rampage' },
      { value: 'male/recon', labelKey: 'config.cvar.skin.choice.male_recon' },
      { value: 'male/scout', labelKey: 'config.cvar.skin.choice.male_scout' },
      { value: 'male/sniper', labelKey: 'config.cvar.skin.choice.male_sniper' },
      { value: 'male/viper', labelKey: 'config.cvar.skin.choice.male_viper' },
      { value: 'female/athena', labelKey: 'config.cvar.skin.choice.female_athena' },
      { value: 'female/brianna', labelKey: 'config.cvar.skin.choice.female_brianna' },
      { value: 'female/cobalt', labelKey: 'config.cvar.skin.choice.female_cobalt' },
      { value: 'female/ensign', labelKey: 'config.cvar.skin.choice.female_ensign' },
      { value: 'female/jezebel', labelKey: 'config.cvar.skin.choice.female_jezebel' },
      { value: 'female/jungle', labelKey: 'config.cvar.skin.choice.female_jungle' },
      { value: 'female/lotus', labelKey: 'config.cvar.skin.choice.female_lotus' },
      { value: 'female/stiletto', labelKey: 'config.cvar.skin.choice.female_stiletto' },
      { value: 'female/venus', labelKey: 'config.cvar.skin.choice.female_venus' },
      { value: 'cyborg/oni911', labelKey: 'config.cvar.skin.choice.cyborg_oni911' },
      { value: 'cyborg/ps9000', labelKey: 'config.cvar.skin.choice.cyborg_ps9000' },
      { value: 'cyborg/tyr574', labelKey: 'config.cvar.skin.choice.cyborg_tyr574' },
    ],
  },
  {
    name: 'fov',
    labelKey: 'config.cvar.fov.label',
    kind: 'slider',
    group: 'player',
    descriptionKey: 'config.cvar.fov.description',
    default: '100',
    min: 60,
    max: 140,
    step: 1,
    common: true,
    byEngine: {
      vanilla: {
        engineDefault: '90',
        source: 'vanilla client/cl_main.c: Cvar_Get("fov", "90", CVAR_USERINFO|CVAR_ARCHIVE)',
      },
      r1q2: { engineDefault: '90', source: 'r1q2 client/cl_main.c: Cvar_Get("fov", "90", ...)' },
      q2pro: { engineDefault: '90', source: 'q2pro src/client/main.c: Cvar_Get("fov", "90", ...)' },
    },
  },
  {
    name: 'sensitivity',
    labelKey: 'config.cvar.sensitivity.label',
    kind: 'slider',
    group: 'player',
    descriptionKey: 'config.cvar.sensitivity.description',
    default: '4',
    min: 0.5,
    max: 30,
    step: 0.5,
    common: true,
    byEngine: {
      vanilla: { engineDefault: '3' },
      r1q2: { engineDefault: '3' },
      q2pro: { engineDefault: '3' },
    },
  },
  {
    name: 'm_pitch',
    labelKey: 'config.cvar.m_pitch.label',
    kind: 'choice',
    group: 'player',
    descriptionKey: 'config.cvar.m_pitch.description',
    default: '0.022',
    choices: [
      { value: '0.022', labelKey: 'config.cvar.m_pitch.choice.0_022' },
      { value: '-0.022', labelKey: 'config.cvar.m_pitch.choice._0_022' },
    ],
  },
  {
    name: 'freelook',
    labelKey: 'config.cvar.freelook.label',
    kind: 'toggle',
    group: 'player',
    descriptionKey: 'config.cvar.freelook.description',
    default: '1',
    common: true,
    byEngine: {
      vanilla: {
        engineDefault: '0',
        noteKey: 'config.cvar.freelook.byEngine.vanilla.note',
        source: 'vanilla client/cl_input.c: Cvar_Get("freelook", "0", CVAR_ARCHIVE)',
      },
      r1q2: { engineDefault: '1', source: 'r1q2 client/cl_input.c: Cvar_Get("freelook", "1", CVAR_ARCHIVE)' },
      q2pro: { engineDefault: '1', source: 'q2pro src/client/input.c: Cvar_Get("freelook", "1", CVAR_ARCHIVE)' },
    },
  },
  {
    name: 'cl_run',
    labelKey: 'config.cvar.cl_run.label',
    kind: 'toggle',
    group: 'player',
    descriptionKey: 'config.cvar.cl_run.description',
    default: '1',
    common: true,
    byEngine: {
      vanilla: {
        engineDefault: '0',
        source: 'vanilla client/cl_input.c: Cvar_Get("cl_run", "0", CVAR_ARCHIVE)',
      },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1' },
    },
  },
  {
    name: 'hand',
    labelKey: 'config.cvar.hand.label',
    kind: 'choice',
    group: 'player',
    descriptionKey: 'config.cvar.hand.description',
    default: '2',
    common: true,
    warningKey: 'config.cvar.hand.warning',
    choices: [
      { value: '0', labelKey: 'config.cvar.hand.choice.0' },
      { value: '1', labelKey: 'config.cvar.hand.choice.1' },
      { value: '2', labelKey: 'config.cvar.hand.choice.2' },
    ],
  },
  {
    name: 'crosshair',
    labelKey: 'config.cvar.crosshair.label',
    kind: 'choice',
    group: 'player',
    descriptionKey: 'config.cvar.crosshair.description',
    default: '1',
    common: true,
    choices: [
      { value: '0', labelKey: 'config.cvar.crosshair.choice.0' },
      { value: '1', labelKey: 'config.cvar.crosshair.choice.1' },
      { value: '2', labelKey: 'config.cvar.crosshair.choice.2' },
      { value: '3', labelKey: 'config.cvar.crosshair.choice.3' },
    ],
  },
  {
    name: 'ch_scale',
    labelKey: 'config.cvar.ch_scale.label',
    kind: 'slider',
    group: 'player',
    descriptionKey: 'config.cvar.ch_scale.description',
    default: '1',
    min: 0.5,
    max: 4,
    step: 0.1,
    byEngine: {
      vanilla: { absent: true },
      r1q2: { absent: true },
      q2pro: {
        engineDefault: '1',
        noteKey: 'config.cvar.ch_scale.byEngine.q2pro.note',
        source: 'q2pro src/client/screen.c: Cvar_Get("ch_scale", "1", ...)',
      },
    },
  },
  {
    name: 'msg',
    labelKey: 'config.cvar.msg.label',
    kind: 'choice',
    group: 'player',
    descriptionKey: 'config.cvar.msg.description',
    default: '0',
    choices: [
      { value: '0', labelKey: 'config.cvar.msg.choice.0' },
      { value: '1', labelKey: 'config.cvar.msg.choice.1' },
      { value: '2', labelKey: 'config.cvar.msg.choice.2' },
      { value: '3', labelKey: 'config.cvar.msg.choice.3' },
    ],
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1' },
    },
  },
  {
    name: 'rate',
    labelKey: 'config.cvar.rate.label',
    kind: 'number',
    group: 'network',
    descriptionKey: 'config.cvar.rate.description',
    default: '25000',
    min: 1000,
    max: 100000,
    step: 1000,
    byEngine: {
      vanilla: { engineDefault: '25000', source: 'vanilla client/cl_main.c: Cvar_Get("rate", "25000", ...)' },
      r1q2: { engineDefault: '15000', source: 'r1q2 client/cl_main.c: Cvar_Get("rate", "15000", ...)' },
      q2pro: { engineDefault: '15000', source: 'q2pro src/client/main.c: Cvar_Get("rate", "15000", ...)' },
    },
  },
  {
    name: 'cl_maxfps',
    labelKey: 'config.cvar.cl_maxfps.label',
    kind: 'number',
    group: 'network',
    descriptionKey: 'config.cvar.cl_maxfps.description',
    default: '125',
    // 0 is meaningful on Q2PRO, so the control has to allow it; the engine
    // clamps live in byEngine.
    min: 0,
    max: 1000,
    step: 5,
    common: true,
    byEngine: {
      vanilla: {
        engineDefault: '90',
        noteKey: 'config.cvar.cl_maxfps.byEngine.vanilla.note',
        source: 'vanilla client/cl_main.c: Cvar_Get("cl_maxfps", "90", 0)',
      },
      r1q2: {
        engineDefault: '60',
        min: 5,
        clamps: true,
        valueNotes: [
          {
            value: '0',
            level: 'error',
            messageKey: 'config.cvar.cl_maxfps.byEngine.r1q2.valueNote.0',
          },
        ],
        noteKey: 'config.cvar.cl_maxfps.byEngine.r1q2.note',
        source:
          'r1q2 client/cl_main.c:3547 (default "60", CVAR_ARCHIVE), :3291-3294 (_maxfps_changed clamps < 5 to 5), :3135-3136 (warning above 100), server/sv_main.c:2669 (flood kick)',
      },
      q2pro: {
        engineDefault: '62',
        min: 10,
        max: 125,
        clamps: true,
        valueNotes: [
          {
            value: '0',
            level: 'info',
            messageKey: 'config.cvar.cl_maxfps.byEngine.q2pro.valueNote.0',
          },
        ],
        noteKey: 'config.cvar.cl_maxfps.byEngine.q2pro.note',
        source:
          'q2pro src/client/main.c:2741 (default "62"), :3127-3128 (MIN_PHYS_HZ 10 / MAX_PHYS_HZ 125), :3208 and :3217 (fps_to_clamped_msec)',
      },
    },
  },
  {
    name: 'cl_async',
    labelKey: 'config.cvar.cl_async.label',
    kind: 'choice',
    group: 'network',
    descriptionKey: 'config.cvar.cl_async.description',
    default: '1',
    choices: [
      { value: '0', labelKey: 'config.cvar.cl_async.choice.0' },
      { value: '1', labelKey: 'config.cvar.cl_async.choice.1' },
    ],
    byEngine: {
      vanilla: {
        absent: true,
        source: 'vanilla 3.20 renders and sends in lockstep; no such cvar exists',
      },
      r1q2: {
        engineDefault: '1',
        noteKey: 'config.cvar.cl_async.byEngine.r1q2.note',
        source: 'r1q2 client/cl_main.c:3550 (default "1"), :3296-3303 (mirroring), :3306-3311 (_async_changed)',
      },
      q2pro: {
        engineDefault: '1',
        extraChoices: [{ value: '2', labelKey: 'config.cvar.cl_async.choice.2' }],
        noteKey: 'config.cvar.cl_async.byEngine.q2pro.note',
        source: 'q2pro src/client/main.c:2743 (default "1"), :3209-3211 (cl_async > 1 selects ASYNC_VIDEO)',
      },
    },
  },
]

export const GRAPHICS_CVARS: CvarDef[] = [
  {
    name: 'vid_fullscreen',
    labelKey: 'config.cvar.vid_fullscreen.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.vid_fullscreen.description',
    default: '1',
    common: true,
    byEngine: {
      vanilla: { engineDefault: '0' },
      r1q2: { engineDefault: '0' },
      q2pro: { engineDefault: '0' },
    },
  },
  {
    name: 'vid_gamma',
    labelKey: 'config.cvar.vid_gamma.label',
    kind: 'slider',
    group: 'graphics',
    descriptionKey: 'config.cvar.vid_gamma.description',
    default: '0.8',
    min: 0.3,
    max: 1.5,
    step: 0.05,
    common: true,
    byEngine: {
      vanilla: {
        engineDefault: '1',
        source: 'vanilla win32/vid_dll.c and unix ports: Cvar_Get("vid_gamma", "1", CVAR_ARCHIVE)',
      },
      r1q2: { engineDefault: '1.0', source: 'r1q2 ref_gl/gl_rmain.c:1442' },
      q2pro: {
        engineDefault: '1',
        noteKey: 'config.cvar.vid_gamma.byEngine.q2pro.note',
        source: 'q2pro src/refresh/texture.c:1278 (registration), :1283-1288 (CVAR_FILES unless QVF_GAMMARAMP)',
      },
    },
  },
  {
    name: 'gl_modulate',
    labelKey: 'config.cvar.gl_modulate.label',
    kind: 'slider',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_modulate.description',
    default: '2',
    min: 1,
    max: 10,
    step: 0.5,
    common: true,
    byEngine: {
      vanilla: { engineDefault: '1', source: 'vanilla ref_gl/gl_rmain.c: Cvar_Get("gl_modulate", "1", 0)' },
      r1q2: {
        engineDefault: '2',
        noteKey: 'config.cvar.gl_modulate.byEngine.r1q2.note',
        source: 'r1q2 ref_gl/gl_rmain.c:1351 (default "2", CVAR_ARCHIVE)',
      },
      q2pro: {
        engineDefault: '1',
        noteKey: 'config.cvar.gl_modulate.byEngine.q2pro.note',
        source:
          'q2pro src/refresh/main.c:1017-1018 (modulate * modulate_world), src/client/main.c:1676-1680 (CVAR_CHEAT on gloom)',
      },
    },
  },
  {
    name: 'gl_picmip',
    labelKey: 'config.cvar.gl_picmip.label',
    kind: 'slider',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_picmip.description',
    default: '0',
    min: 0,
    max: 10,
    step: 1,
    common: true,
    byEngine: {
      q2pro: {
        engineDefault: '0',
        noteKey: 'config.cvar.gl_picmip.byEngine.q2pro.note',
        source: 'q2pro src/refresh/texture.c:1271 (CVAR_FILES)',
      },
    },
  },
  {
    name: 'gl_texturemode',
    labelKey: 'config.cvar.gl_texturemode.label',
    kind: 'choice',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_texturemode.description',
    default: 'GL_LINEAR_MIPMAP_LINEAR',
    choices: [
      { value: 'GL_NEAREST', labelKey: 'config.cvar.gl_texturemode.choice.gl_nearest' },
      { value: 'GL_LINEAR', labelKey: 'config.cvar.gl_texturemode.choice.gl_linear' },
      { value: 'GL_NEAREST_MIPMAP_NEAREST', labelKey: 'config.cvar.gl_texturemode.choice.gl_nearest_mipmap_nearest' },
      { value: 'GL_LINEAR_MIPMAP_NEAREST', labelKey: 'config.cvar.gl_texturemode.choice.gl_linear_mipmap_nearest' },
      { value: 'GL_NEAREST_MIPMAP_LINEAR', labelKey: 'config.cvar.gl_texturemode.choice.gl_nearest_mipmap_linear' },
      { value: 'GL_LINEAR_MIPMAP_LINEAR', labelKey: 'config.cvar.gl_texturemode.choice.gl_linear_mipmap_linear' },
    ],
    byEngine: {
      vanilla: {
        engineDefault: 'GL_LINEAR_MIPMAP_NEAREST',
        source: 'vanilla ref_gl/gl_rmain.c: Cvar_Get("gl_texturemode", "GL_LINEAR_MIPMAP_NEAREST", CVAR_ARCHIVE)',
      },
      r1q2: { engineDefault: 'GL_LINEAR_MIPMAP_LINEAR', source: 'r1q2 ref_gl/gl_rmain.c:1373' },
      q2pro: {
        engineDefault: 'GL_LINEAR_MIPMAP_LINEAR',
        extraChoices: [{ value: 'MAG_NEAREST', labelKey: 'config.cvar.gl_texturemode.choice.mag_nearest' }],
        noteKey: 'config.cvar.gl_texturemode.byEngine.q2pro.note',
        source: 'q2pro src/refresh/texture.c:66-74 (filterModes table), :1263 (registration)',
      },
    },
  },
  {
    name: 'cl_gun',
    labelKey: 'config.cvar.cl_gun.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.cl_gun.description',
    default: '0',
    common: true,
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1' },
    },
  },
  {
    name: 'cl_blend',
    labelKey: 'config.cvar.cl_blend.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.cl_blend.description',
    default: '0',
    common: true,
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1' },
    },
  },
  {
    name: 'gl_polyblend',
    labelKey: 'config.cvar.gl_polyblend.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_polyblend.description',
    default: '0',
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1' },
    },
  },
  {
    name: 'gl_shadows',
    labelKey: 'config.cvar.gl_shadows.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_shadows.description',
    default: '0',
  },
  {
    name: 'gl_dynamic',
    labelKey: 'config.cvar.gl_dynamic.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_dynamic.description',
    default: '0',
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: {
        engineDefault: '1',
        noteKey: 'config.cvar.gl_dynamic.byEngine.q2pro.note',
        source: 'q2pro src/refresh/main.c:806 (gl_dynamic->integer != 1), src/refresh/surf.c:450 (build_style_map)',
      },
    },
  },
  {
    name: 'gl_swapinterval',
    labelKey: 'config.cvar.gl_swapinterval.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.gl_swapinterval.description',
    default: '0',
    common: true,
    byEngine: {
      vanilla: { engineDefault: '1' },
      r1q2: { engineDefault: '1' },
      q2pro: { engineDefault: '1', source: 'q2pro src/refresh/main.c:1111 (default "1", CVAR_ARCHIVE)' },
    },
  },
  {
    name: 'cl_noskins',
    labelKey: 'config.cvar.cl_noskins.label',
    kind: 'toggle',
    group: 'graphics',
    descriptionKey: 'config.cvar.cl_noskins.description',
    default: '0',
  },
  {
    name: 'r_maxfps',
    labelKey: 'config.cvar.r_maxfps.label',
    kind: 'number',
    group: 'graphics',
    descriptionKey: 'config.cvar.r_maxfps.description',
    default: '125',
    // 0 has to be enterable because it is the Q2PRO default and means
    // "unlimited" there. On R1Q2 the very same value is a trap; see
    // byEngine.
    min: 0,
    max: 1000,
    step: 5,
    byEngine: {
      vanilla: {
        absent: true,
        source: 'vanilla 3.20 has only cl_maxfps; no separate render cap exists',
      },
      r1q2: {
        engineDefault: '1000',
        min: 5,
        max: 1000,
        clamps: true,
        valueNotes: [
          {
            value: '0',
            level: 'error',
            messageKey: 'config.cvar.r_maxfps.byEngine.r1q2.valueNote.0',
          },
        ],
        noteKey: 'config.cvar.r_maxfps.byEngine.r1q2.note',
        source:
          'r1q2 client/cl_main.c:3544 (default "1000"), :3291-3294 (_maxfps_changed clamps < 5 to 5), :4181 (render gate 1000/r_maxfps->intvalue)',
      },
      q2pro: {
        engineDefault: '0',
        min: 10,
        max: 1000,
        clamps: true,
        valueNotes: [
          {
            value: '0',
            level: 'info',
            messageKey: 'config.cvar.r_maxfps.byEngine.q2pro.valueNote.0',
          },
        ],
        source:
          'q2pro src/client/main.c:2745 (default "0"), :3161-3167 (value 0 returns fps_to_msec(max)), :3130 (MAX_REF_HZ 1000), :3212 (used only when cl_async > 0)',
      },
    },
  },
  {
    name: 'con_alpha',
    labelKey: 'config.cvar.con_alpha.label',
    kind: 'slider',
    group: 'graphics',
    descriptionKey: 'config.cvar.con_alpha.description',
    default: '1',
    min: 0,
    max: 1,
    step: 0.05,
    byEngine: {
      vanilla: { absent: true, source: 'no console alpha cvar in 3.20' },
      r1q2: { absent: true, source: 'no console alpha cvar in r1q2' },
      q2pro: {
        engineDefault: '1',
        min: 0,
        max: 1,
        clamps: true,
        noteKey: 'config.cvar.con_alpha.byEngine.q2pro.note',
        source: 'q2pro src/client/console.c:461 (default "1"), :827-829 (clamped 0..1, only while ca_active)',
      },
    },
  },
  {
    name: 's_volume',
    labelKey: 'config.cvar.s_volume.label',
    kind: 'slider',
    group: 'sound',
    descriptionKey: 'config.cvar.s_volume.description',
    default: '0.7',
    min: 0,
    max: 1,
    step: 0.05,
    common: true,
    byEngine: {
      vanilla: { engineDefault: '0.7' },
      r1q2: { engineDefault: '0.5' },
      q2pro: { engineDefault: '0.7' },
    },
  },
  {
    name: 's_khz',
    labelKey: 'config.cvar.s_khz.label',
    kind: 'choice',
    group: 'sound',
    descriptionKey: 'config.cvar.s_khz.description',
    default: '44',
    choices: [
      { value: '11', labelKey: 'config.cvar.s_khz.choice.11' },
      { value: '22', labelKey: 'config.cvar.s_khz.choice.22' },
      { value: '44', labelKey: 'config.cvar.s_khz.choice.44' },
    ],
    byEngine: {
      vanilla: { engineDefault: '11', source: 'vanilla client/snd_dma.c: Cvar_Get("s_khz", "11", CVAR_ARCHIVE)' },
      r1q2: { engineDefault: '22' },
      q2pro: { engineDefault: '44' },
    },
  },
]

export const ALL_CVARS: CvarDef[] = [...PLAYER_CVARS, ...GRAPHICS_CVARS]

const BY_NAME = new Map(ALL_CVARS.map((c) => [c.name.toLowerCase(), c]))

export function findCvar(name: string): CvarDef | undefined {
  return BY_NAME.get(name.toLowerCase())
}
