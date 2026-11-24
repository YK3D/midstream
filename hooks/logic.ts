import type { Effort, Features, Part, Rate, Thumb, Verdict } from '../types'

export const FIVE_HOURS = 5 * 60 * 60 * 1000

// ---- effort suggestion -----------------------------------------------------

export const LEVELS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
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
export function levelIndex(level: Effort): number {
  return LEVELS.indexOf(level)
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

// ---- settings and updates ----------------------------------------------------

/** The parts of the band the settings panel switches, in the order it lists them. */
export const FEATURES: readonly (readonly [keyof Features, string])[] = [
  ['attach', 'Attach'],
  ['effort', 'Effort'],
  ['usage', 'Usage'],
  ['lastNote', 'Last note'],
  ['divider', 'Divider'],
]

export const ALL_ON: Features = { attach: true, effort: true, usage: true, lastNote: true, divider: true }

/** Features as stored: anything missing or not a yes/no falls back to on. */
export function toFeatures(raw: unknown): Features {
  const saved = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const pick = (k: keyof Features) => (typeof saved[k] === 'boolean' ? (saved[k] as boolean) : true)

  return { attach: pick('attach'), effort: pick('effort'), usage: pick('usage'), lastNote: pick('lastNote'), divider: pick('divider') }
}

/**
 * What `claude plugin update --json` reported, as one line for a toast, and whether a
 * newer version was installed (so the plugins need a reload).
 */
export function updateResult(stdout: string): { line: string; isNew: boolean } {
  const last = stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.startsWith('{'))
    .pop()

  try {
    const r = last ? (JSON.parse(last) as Record<string, unknown>) : {}
    if (r.updateOutcome === 'up_to_date') {
      return { line: `midstream is up to date (${String(r.newVersion ?? r.oldVersion ?? '')})`, isNew: false }
    }
    if (r.outcome === 'ok' && typeof r.newVersion === 'string') {
      return { line: `Updated midstream ${String(r.oldVersion ?? '?')} → ${r.newVersion}`, isNew: true }
    }
    if (typeof r.message === 'string') return { line: r.message, isNew: false }
  } catch {
    // not the JSON line expected: say so below
  }

  return { line: 'Could not read the update result', isNew: false }
}

// ---- image previews -----------------------------------------------------------

export const isImage = (path: string) => IMAGES.test(path)

/**
 * PowerShell that shrinks each image to fit 48 by 36 pixels and prints one line per
 * image: its place in the list|width|height|the pixels as hex colours. An image it cannot
 * read is skipped. Paths go in with forward slashes: Windows drops the backslashes on the
 * way to PowerShell, and .NET opens either.
 * The desktop draws no embedded pictures, so the preview is drawn from these pixels.
 */
export function thumbScript(paths: readonly string[]): string {
  const list = paths.map(p => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`).join(',')

  return [
    'Add-Type -AssemblyName System.Drawing',
    `$n=0;foreach($p in @(${list})){try{` +
      '$i=[System.Drawing.Image]::FromFile($p);$s=[Math]::Min(48/$i.Width,36/$i.Height);' +
      '$w=[Math]::Max(1,[int]($i.Width*$s));$h=[Math]::Max(1,[int]($i.Height*$s));' +
      '$b=New-Object System.Drawing.Bitmap $w,$h;$g=[System.Drawing.Graphics]::FromImage($b);' +
      "$g.InterpolationMode='HighQualityBicubic';$g.DrawImage($i,0,0,$w,$h);$g.Dispose();$i.Dispose();" +
      '$sb=New-Object System.Text.StringBuilder;' +
      "for($y=0;$y -lt $h;$y++){for($x=0;$x -lt $w;$x++){$c=$b.GetPixel($x,$y);[void]$sb.Append($c.R.ToString('x2')+$c.G.ToString('x2')+$c.B.ToString('x2'))}};" +
      "$b.Dispose();[Console]::Out.WriteLine([string]$n+'|'+$w+'|'+$h+'|'+$sb.ToString())}catch{};$n++}",
  ].join(';')
}

/** The previews in the script's output, by the path at each place; malformed lines are skipped. */
export function parseThumbs(stdout: string, paths: readonly string[]): Record<string, Thumb> {
  const out: Record<string, Thumb> = {}

  for (const line of stdout.split(/\r?\n/)) {
    const [at, w, h, hex] = line.trim().split('|')
    const path = paths[Number(at)]
    const width = Number(w)
    const height = Number(h)
    if (path && hex && width > 0 && height > 0 && hex.length === width * height * 6 && /^[0-9a-f]+$/.test(hex)) {
      out[path] = { width, height, hex }
    }
  }

  return out
}

/** A preview drawn as one rect per pixel (runs of one colour merged), `size` pixels tall. */
export function thumbSvg(t: Thumb, size: number): string {
  const rects: string[] = []

  for (let y = 0; y < t.height; y++) {
    let x = 0
    while (x < t.width) {
      const at = (y * t.width + x) * 6
      const color = t.hex.slice(at, at + 6)
      let run = 1
      while (x + run < t.width && t.hex.slice(at + run * 6, at + run * 6 + 6) === color) run++
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="#${color}"/>`)
      x += run
    }
  }

  const width = Math.round((size * t.width) / t.height)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${t.width} ${t.height}" shape-rendering="crispEdges">` +
    rects.join('') +
    '</svg>'
  )
}
