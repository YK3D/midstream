import type { Applied, Effort, EffortMode, Part, Rate, Verdict } from '../types'

export const FIVE_HOURS = 5 * 60 * 60 * 1000

// ---- effort suggestion -----------------------------------------------------

export const LEVELS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
}
export const BARS: Record<Effort, string> = {
  low: '▁',
  medium: '▃',
  high: '▅',
  xhigh: '▇',
  max: '█',
}
/** Claude's coral, for the effort meter. */
export const CORAL = '#D97757'
/** The blue Claude draws its usage bars in. */
export const USAGE_BLUE = '#2C84DB'
/** A track that reads on both light and dark themes. */
const TRACK = '#8b8b8b'

/** Which score reaches which level: the lowest score each level starts at. */
export const THRESHOLDS = 'Low ≤ 0 · Medium 1–2 · High 3–4 · X-High 5–6 · Max 7+'

export function levelIndex(level: Effort): number {
  return LEVELS.indexOf(level)
}

// ---- the effort selector ---------------------------------------------------

/** The selector's choices, in the order they are drawn. */
export const MODES: readonly EffortMode[] = ['session', 'auto', ...LEVELS]

export const MODE_LABEL: Record<EffortMode, string> = {
  session: 'Default',
  auto: 'Auto',
  ...LABEL,
}

/** A value read back from the store is used only if it is one of the choices. */
export function isMode(value: unknown): value is EffortMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

/**
 * The level the selector asks for on the next request, or null to leave the engine's
 * own: `session` never sets one, `auto` sets the last sent prompt's once there is one.
 */
export function wantedLevel(mode: EffortMode, auto: Verdict | null): Effort | null {
  if (mode === 'session') return null
  if (mode === 'auto') return auto?.level ?? null
  return mode
}

/**
 * What one main-conversation request will run at. `current` is the request's own
 * effort as the engine set it; where it is absent the model or the effort setting takes
 * none, so nothing is changed. A number (internal builds) is left alone.
 */
export function decide(
  current: Effort | number | undefined,
  want: Effort | null,
): { send: Effort | null; applied: Applied } {
  if (current === undefined) {
    return { send: null, applied: { level: null, isSupported: false, isOverride: false } }
  }

  const own = typeof current === 'string' ? current : null

  if (want === null || want === current || typeof current === 'number') {
    return { send: null, applied: { level: own, isSupported: true, isOverride: false } }
  }

  return { send: want, applied: { level: want, isSupported: true, isOverride: true } }
}

/** One line saying what the selected mode does, for the selector's panel. */
export function modeLine(mode: EffortMode, auto: Verdict | null): string {
  if (mode === 'session') {
    return "Claude Code's own effort setting is used. The side note doesn't change it."
  }

  if (mode === 'auto') {
    return auto
      ? `Each prompt you send sets the level. Your last prompt asked for ${LABEL[auto.level]} (${auto.why}).`
      : 'Each prompt you send sets the level. Until you send one, the default is used.'
  }

  return `Every request in this chat runs at ${LABEL[mode]}, until you change it here.`
}

/** What the last request ran at, as one short line. */
export function appliedLine(applied: Applied | null): string {
  if (applied === null) return 'No request sent yet in this chat.'
  if (!applied.isSupported) return 'This model or effort setting takes no level, so none was set.'
  if (applied.level === null) return 'The last request ran at the model default.'

  return `The last request ran at ${LABEL[applied.level]}${applied.isOverride ? ', set by the side note' : ''}.`
}

export const HARD =
  /\b(architect\w*|refactor\w*|migrat\w*|redesign\w*|race condition|deadlock|concurren\w*|security|vulnerab\w*|optimi[sz]\w*|performance|algorithm\w*|root cause|investigate|from scratch|end[- ]to[- ]end|rewrite|implement\w*|debug\w*|prove|proof|trade-?offs?)\b/gi
export const EASY =
  /\b(typo|rename|spelling|reformat|one[- ]liner|quick(ly)?|tl;?dr|translate|what does|what is|what's|define|yes or no|thanks?)\b/gi

/**
 * Reads a prompt and says how hard the model should think about it. It adds up points
 * for what the text shows (length, hard words, code, files, lists), takes points off
 * for easy words, and maps the total to a level. It runs here, in a few lines of rules;
 * it is not a model and cannot see the code the prompt is about.
 */
export function suggest(text: string): Verdict | null {
  const t = text.trim()
  if (t.length < 8 || t.startsWith('/')) return null

  const parts: Part[] = []
  const add = (label: string, points: number, isNotable = true) =>
    parts.push({ label, points, isNotable })
  const len = t.length

  if (len < 60) add('short prompt', -1, false)
  else if (len < 200) add('a few sentences', 1, false)
  else if (len < 500) add('a paragraph or two', 2, false)
  else if (len < 1200) add('long prompt', 3)
  else add('very long prompt', 4)

  const hard = [...new Set((t.match(HARD) ?? []).map(w => w.toLowerCase()))]
  if (hard.length > 0) {
    add(`hard words: ${hard.slice(0, 3).map(w => `“${w}”`).join(', ')}`, Math.min(4, hard.length * 2))
  }

  const easy = [...new Set((t.match(EASY) ?? []).map(w => w.toLowerCase()))]
  if (easy.length > 0) {
    add(`simple ask: ${easy.slice(0, 3).map(w => `“${w}”`).join(', ')}`, -Math.min(3, easy.length * 2))
  }

  if (/```|Traceback|\n\s+at \S+ \(|\bError:/.test(t)) add('code or an error trace', 1)

  const paths =
    t.match(/[\w.-]+[\\/][\w./\\-]+|\b\w+\.(?:tsx?|jsx?|py|rs|go|java|cs|cpp|md|json)\b/g) ?? []
  if (paths.length >= 3) add('mentions several files', 1)

  if ((t.match(/^\s*(?:\d+[.)]|[-*])\s/gm) ?? []).length >= 3) add('a multi-step list', 1)

  if (/\b(?:all|every|entire|whole)\b[^.\n]{0,40}\b(?:files?|codebase|repo|project)\b/i.test(t)) {
    add('repo-wide', 1)
  }

  if (/\bthink (?:hard|carefully|deeply)\b|\bultrathink\b/i.test(t)) add('asks for deep thought', 2)

  const score = parts.reduce((n, p) => n + p.points, 0)
  const level: Effort =
    score <= 0 ? 'low' : score <= 2 ? 'medium' : score <= 4 ? 'high' : score <= 6 ? 'xhigh' : 'max'

  const why =
    parts
      .filter(p => p.isNotable)
      .slice(0, 3)
      .map(p => p.label.replace(/^(hard words|simple ask): /, ''))
      .join(', ') || 'plain request'

  return { level, why, score, parts }
}

// ---- the usage windows --------------------------------------------------

export function span(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export type Win = {
  /** Share of the window still ahead, 0 to 1: what the ring shows. */
  fraction: number
  /** Percent of the limit used, when the API has said. */
  percent: number | null
  headline: string
  caption: string
}

export function windowOf(now: number, limit: Rate | null, started: number | null): Win {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN

  if (!Number.isNaN(resetsAt)) {
    if (resetsAt > now) {
      return {
        fraction: Math.min(1, (resetsAt - now) / FIVE_HOURS),
        percent: limit?.percent ?? null,
        headline: span(resetsAt - now),
        caption: 'until your 5-hour limit resets',
      }
    }

    return {
      fraction: 0,
      percent: null,
      headline: 'Reset',
      caption: 'a fresh window opens with your next message',
    }
  }

  if (started !== null && started + FIVE_HOURS > now) {
    return {
      fraction: (started + FIVE_HOURS - now) / FIVE_HOURS,
      percent: null,
      headline: `~${span(started + FIVE_HOURS - now)}`,
      caption: 'estimated from your first message',
    }
  }

  return {
    fraction: 0,
    percent: null,
    headline: '5 hours',
    caption: 'a window opens with your next message',
  }
}

/** The weekly window's color: a soft violet that sits apart from the 5-hour blue. */
export const WEEK_VIOLET = '#8B7CF6'

/** A time left, in days and hours once it is a day or more: what the weekly reset reads. */
export function spanLong(ms: number): string {
  const hours = Math.max(0, Math.ceil(ms / 3_600_000))

  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : span(ms)
}

export type Week = { percent: number | null; headline: string }

/** The weekly window as the API last reported it: how much is used and when it resets. */
export function weekOf(now: number, limit: Rate | null): Week {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN

  if (limit === null) return { percent: null, headline: 'not reported yet' }
  if (Number.isNaN(resetsAt)) return { percent: limit.percent, headline: 'reset time unknown' }
  if (resetsAt <= now) return { percent: null, headline: 'reset' }

  return { percent: limit.percent, headline: `resets in ${spanLong(resetsAt - now)}` }
}

/**
 * Two rings in one chart: the outer one is the 5-hour window, the inner one the weekly
 * window, each filled clockwise from the top to the share of it used. A window with no
 * reading shows its track alone.
 */
export function usageRings(five: number | null, week: number | null, size: number): string {
  const c = size / 2
  const stroke = Math.max(1.6, size * 0.11)
  const outer = c - stroke / 2 - 0.5
  const inner = outer - stroke - Math.max(1, size * 0.05)

  const circle = (r: number, color: string, percent: number | null) => {
    const length = 2 * Math.PI * r
    const track = `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${TRACK}" stroke-opacity="0.25" stroke-width="${stroke.toFixed(2)}"/>`
    const used = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100

    if (used <= 0) return track

    return (
      track +
      `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" ` +
      `stroke-dasharray="${(length * used).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
    )
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    circle(outer, USAGE_BLUE, five) +
    circle(inner, WEEK_VIOLET, week) +
    '</svg>'
  )
}

/**
 * The effort meter: five rising bars, the first `index + 1` filled in Claude's coral, so
 * the bars always count the level in force (Low one bar, Max five). `index` null: none.
 */
export function effortMeter(index: number | null, height: number): string {
  const bar = Math.max(2, Math.round(height * 0.22))
  const gap = Math.max(1, Math.round(bar * 0.55))
  const width = 5 * bar + 4 * gap

  const bars = LEVELS.map((_, i) => {
    const h = Math.round(height * (0.36 + 0.16 * i))
    const isOn = index !== null && i <= index

    return (
      `<rect x="${i * (bar + gap)}" y="${height - h}" width="${bar}" height="${h}" rx="${(bar / 2).toFixed(1)}" ` +
      `fill="${isOn ? CORAL : TRACK}" fill-opacity="${isOn ? 1 : 0.3}"/>`
    )
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`
}

/**
 * A hairline as wide as its slot: drawn long and squeezed to fit, since a surface caps
 * an Svg's width at its slot. Grey at low opacity reads on light and dark alike.
 */
export const DIVIDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none">' +
  `<rect width="4000" height="1" fill="${TRACK}" fill-opacity="0.35"/></svg>`

// ---- attachments ----------------------------------------------

/** The last part of a path: what an attachment chip shows. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const IMAGES = /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i

export function glyphFor(path: string): string {
  return IMAGES.test(path) ? '🖼' : '📄'
}

/** The message with the attached files named, for Claude to open with its own tools. */
export function withFiles(message: string, files: readonly string[]): string {
  if (files.length === 0) return message

  return (
    `${message || 'Please take a look at the attached files.'}\n\n` +
    `Attached files (open them with your Read tool):\n${files.map(f => `- ${f}`).join('\n')}`
  )
}

/** The Windows file dialog: prints one chosen path a line, or nothing if cancelled. */
export const PICK_FILES = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$f=New-Object System.Windows.Forms.Form',
  '$f.TopMost=$true',
  '$d=New-Object System.Windows.Forms.OpenFileDialog',
  '$d.Multiselect=$true',
  "$d.Title='Attach photos or documents'",
  "$d.Filter='Photos and documents|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.pdf;*.txt;*.md;*.csv;*.json;*.docx;*.xlsx;*.pptx|All files|*.*'",
  "if($d.ShowDialog($f) -eq 'OK'){$d.FileNames|ForEach-Object{[Console]::Out.WriteLine($_)}}",
].join(';')
