/**
 * The one adapter from an already-folded config source to `restoreProfileParts`'s input. Both the
 * multi-file import and the single canonical-file read fold their own way and then come here, so the
 * field mapping cannot drift between them.
 */

import type { ConfigProfile } from '../../modules/config'
import type {
  RestoreCommentLine,
  RestoreProfilePartsInput,
  RestoreProfilePartsResult,
} from './profile-restore'

/** The profile fields a config file carries and `restoreProfileParts` recovers - everything a
 * read-back adopts from the text itself. */
export type RestoredProfileFields = Required<
  Pick<ConfigProfile, 'cvars' | 'binds' | 'actions' | 'categories' | 'cvarSections' | 'layers'>
>

/** `cvars`/`binds` come from the fold, not from the restore, which only reconstructs the rest. */
export function restoredToProfileFields(
  cvars: Record<string, string>,
  binds: Record<string, string>,
  restored: Pick<RestoreProfilePartsResult, 'actions' | 'categories' | 'cvarSections' | 'layers'>,
): RestoredProfileFields {
  return {
    cvars,
    binds,
    actions: restored.actions,
    categories: restored.categories,
    cvarSections: restored.cvarSections,
    layers: restored.layers,
  }
}

export interface RestoreEntrySource {
  aliases: Iterable<{
    name: string
    body: string
    line: number
    comment: string
    codeWidth: number
    file?: string
  }>
  binds: Iterable<{ key: string; command: string; line: number; comment: string; file?: string }>
  cvars: Iterable<{
    name: string
    value: string
    line: number
    comment: string
    file?: string
    /** First occurrence, when it differs in meaning from `file`/`line` (last assignment wins). */
    firstFile?: string
    firstLine?: number
  }>
}

export interface RestoreInputOptions {
  comments: readonly { text: string; line: number; file?: string }[]
  layerAliases?: readonly string[]
  newId: () => string
}

/** An entry's own `file` wins over `file`, which is only the fallback for single-file sources. */
export function toRestoreInput(
  file: string,
  folded: RestoreEntrySource,
  options: RestoreInputOptions,
): RestoreProfilePartsInput {
  const input: RestoreProfilePartsInput = {
    aliases: [...folded.aliases].map((alias) => ({
      name: alias.name,
      body: alias.body,
      file: alias.file ?? file,
      line: alias.line,
      comment: alias.comment,
      codeWidth: alias.codeWidth,
    })),
    binds: [...folded.binds].map((bind) => ({
      key: bind.key,
      command: bind.command,
      file: bind.file ?? file,
      line: bind.line,
      comment: bind.comment,
    })),
    cvars: [...folded.cvars].map((cvar) => ({
      name: cvar.name,
      value: cvar.value,
      file: cvar.file ?? file,
      line: cvar.line,
      comment: cvar.comment,
      ...(cvar.firstFile !== undefined && cvar.firstLine !== undefined
        ? { firstFile: cvar.firstFile, firstLine: cvar.firstLine }
        : {}),
    })),
    comments: options.comments.map((comment): RestoreCommentLine => ({
      text: comment.text,
      file: comment.file ?? file,
      line: comment.line,
    })),
    newId: options.newId,
  }
  if (options.layerAliases !== undefined) input.layerAliases = options.layerAliases
  return input
}
