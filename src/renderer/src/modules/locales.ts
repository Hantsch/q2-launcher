import config from './config/locale/en.json'
import downloads from './downloads/locale/en.json'
import home from './home/locale/en.json'
import mods from './mods/locale/en.json'
import replays from './replays/locale/en.json'
import servers from './servers/locale/en.json'

/** Every module's English strings; merged with the shell file in `i18n/bundle.ts`. */
export const MODULE_LOCALES_EN = [config, downloads, home, mods, replays, servers] as const
