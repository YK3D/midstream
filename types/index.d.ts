export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One reason behind a suggestion: what was found, and the points it added or took off. */
export type Part = { label: string; points: number; isNotable: boolean }

/** What the prompt-reading rules decided: a level, the reasons, and the working. */
export type Verdict = { level: Effort; why: string; score: number; parts: Part[] }

/**
 * The effort level suggested, and where it came from: a `draft` in the main prompt box
 * (where the surface reports it), the text of the `note` box as it is typed, or the
 * prompt that was just `sent`.
 */
export type Suggestion = Verdict & { source: 'draft' | 'note' | 'sent' }

/** The parts of the band the settings panel can switch off; all on by default. */
export type Features = { attach: boolean; effort: boolean; usage: boolean; lastNote: boolean; divider: boolean }

/** A small preview of an attached image: its size in pixels and their colours, as hex. */
export type Thumb = { width: number; height: number; hex: string }

/** One usage window as the API last reported it. */
export type Rate = { percent: number; resetsAt: string | null }

/** Both usage windows as the API last reported them; null where it has not said. */
export type Limits = { five: Rate | null; week: Rate | null }

/**
 * The last note sent from the note box. `live` went into a running turn, `prompt`
 * started a turn.
 */
export type Note = { text: string; mode: 'live' | 'prompt'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'midstream': {
      suggestion: Suggestion | null
      limits: Limits
      windowStart: number | null
      lastNote: Note | null
      isWorking: boolean
      /** Counts sent notes: it renames the note field, so a sent note's text is cleared. */
      sent: number
      /** How many lines the typed note needs, so the field can grow as the person types. */
      lines: number
      /** Files picked with the attach button, by path, waiting to go with the next note. */
      attachments: string[]
      /** Previews of attached images, by path. */
      thumbs: Record<string, Thumb>
      /** Which panel is open under the toolbar, if any. */
      detail: 'usage' | 'settings' | null
      /** Which parts of the band are shown. Kept across chats in the store too. */
      features: Features
      tick: number
    }
  }
}
