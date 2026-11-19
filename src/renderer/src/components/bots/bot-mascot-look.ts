// A mascot as a bot shows it: its SVG on the bot's tile color (on a dark color, with the light rim) and wearing
// its outfit, built once per look and cached.
import { useEffect, useSyncExternalStore } from 'react'
import type { BotMascotId } from '../../../../shared/bot-avatar'
import {
  DEFAULT_BOT_AVATAR_COLOR,
  isDarkBotAvatarColor
} from '../../../../shared/bots/bot-avatar-color'
import type { BotAvatarOutfit } from '../../../../shared/bots/bot-avatar-outfit'
import { BOT_MASCOT_URLS } from './bot-mascots'

const MASCOT_SVGS = import.meta.glob<string>('../../../../shared/bot-mascots/*.svg', {
  query: '?raw',
  import: 'default'
})

/** One mascot's outfit: drawn over the picture, and for an outfit that changes the face (the eyes looking
 *  down), that face. */
export type BotOutfitLayer = { layer: string; face?: string }

const OUTFIT_LAYERS = import.meta.glob<Record<string, BotOutfitLayer>>(
  '../../../../shared/bot-mascots/outfits/*.json',
  { import: 'default' }
)

/** The SVG drawn on `color`; the mascots read their background and rim from these defaults. */
export function recolorMascotSvg(svg: string, color: string): string {
  const filled = svg.replace(`var(--avatar-bg,${DEFAULT_BOT_AVATAR_COLOR})`, color)
  return isDarkBotAvatarColor(color) ? filled.replace('var(--avatar-rim,0)', '1') : filled
}

// Every mascot SVG ends with its face group, then the groups that place it.
const FACE_OPEN = '<g id="face">'
const FACE_TAIL = '</g></g></g></svg>'

/** The SVG wearing `outfit`, its face swapped first when the outfit has one. */
export function dressMascotSvg(svg: string, outfit: BotOutfitLayer): string {
  const trimmed = svg.trimEnd()
  const faceAt = trimmed.indexOf(FACE_OPEN)
  const faced =
    outfit.face && faceAt !== -1 && trimmed.endsWith(FACE_TAIL)
      ? `${trimmed.slice(0, faceAt + FACE_OPEN.length)}${outfit.face}${FACE_TAIL}`
      : trimmed
  return `${faced.slice(0, -'</svg>'.length)}${outfit.layer}</svg>`
}

// Bounded, since dragging the custom color makes a new one per step; room for the picker's faces on several looks.
const MAX_LOOKS = 300
const looks = new Map<string, string>()
const loading = new Set<string>()
// Bumped whenever a look is ready, so readers render again.
let version = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readVersion(): number {
  return version
}

function lookKey(id: BotMascotId, color: string | null, outfit: BotAvatarOutfit | null): string {
  return `${id}|${color ?? ''}|${outfit ?? ''}`
}

async function buildLook(
  id: BotMascotId,
  color: string | null,
  outfit: BotAvatarOutfit | null
): Promise<string> {
  const loadSvg = MASCOT_SVGS[`../../../../shared/bot-mascots/${id}.svg`]
  const loadOutfit = outfit
    ? OUTFIT_LAYERS[`../../../../shared/bot-mascots/outfits/${outfit}.json`]
    : null
  if (!loadSvg || (outfit && !loadOutfit)) {
    throw new Error(`No picture for ${id}`)
  }
  const [svg, layers] = await Promise.all([loadSvg(), loadOutfit?.()])
  const layer = layers?.[id]
  const colored = color ? recolorMascotSvg(svg, color) : svg
  const dressed = layer ? dressMascotSvg(colored, layer) : colored
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dressed)}`
}

function loadLook(id: BotMascotId, color: string | null, outfit: BotAvatarOutfit | null): void {
  const key = lookKey(id, color, outfit)
  if (looks.has(key) || loading.has(key)) {
    return
  }
  loading.add(key)
  void buildLook(id, color, outfit).then(
    (src) => {
      loading.delete(key)
      looks.set(key, src)
      const oldest = looks.keys().next()
      if (looks.size > MAX_LOOKS && !oldest.done) {
        looks.delete(oldest.value)
      }
      version += 1
      for (const listener of listeners) {
        listener()
      }
    },
    // A picture that can't load stays as bundled.
    () => loading.delete(key)
  )
}

function shownColor(color: string | null | undefined): string | null {
  return !color || color === DEFAULT_BOT_AVATAR_COLOR ? null : color
}

// `_ready` is the cache version, passed so a memoizing compiler reads the cache again when it changes.
function mascotSrcs(
  ids: readonly BotMascotId[],
  color: string | null,
  outfit: BotAvatarOutfit | null,
  _ready: number
): Record<BotMascotId, string> {
  const srcs = { ...BOT_MASCOT_URLS }
  if (color || outfit) {
    for (const id of ids) {
      srcs[id] = looks.get(lookKey(id, color, outfit)) ?? BOT_MASCOT_URLS[id]
    }
  }
  return srcs
}

/** Each mascot's picture on `color` and wearing `outfit`; the bundled SVG until that look is ready. */
export function useBotMascotSrcs(
  ids: readonly BotMascotId[],
  color: string | null | undefined,
  outfit: BotAvatarOutfit | null | undefined = null
): Record<BotMascotId, string> {
  const ready = useSyncExternalStore(subscribe, readVersion, readVersion)
  const tile = shownColor(color)
  const worn = outfit ?? null
  useEffect(() => {
    if (tile || worn) {
      for (const id of ids) {
        loadLook(id, tile, worn)
      }
    }
  }, [ids, tile, worn])
  return mascotSrcs(ids, tile, worn, ready)
}

const NO_IDS: readonly BotMascotId[] = []

/** One mascot's picture on `color`, wearing `outfit`. */
export function useBotMascotSrc(
  id: BotMascotId | null,
  color: string | null | undefined,
  outfit: BotAvatarOutfit | null | undefined = null
): string | null {
  const srcs = useBotMascotSrcs(id ? [id] : NO_IDS, color, outfit)
  return id ? srcs[id] : null
}
