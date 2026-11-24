export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * What the effort selector is set to: `session` leaves Claude Code's own level alone,
 * `auto` uses the level read from the last prompt the person sent, and a level runs
 * every request of the main conversation at that level.
 */
export type EffortMode = 'session' | 'auto' | Effort

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

/**
 * What the last model request of the main conversation actually ran at. `isSupported`
 * is false where the model or the effort setting takes no level, so none can be set.
 */
export type Applied = { level: Effort | null; isSupported: boolean; isOverride: boolean }

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
    'side-desk': {
      suggestion: Suggestion | null
      /** The level read from the last prompt the person sent: what `auto` applies. */
      autoPick: Verdict | null
      /** What the effort selector is set to. Kept across chats in the store too. */
      effortMode: EffortMode
      /** What the last main-conversation request ran at, as the engine reported it. */
      applied: Applied | null
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
      /** Which panel is open under the toolbar, if any. */
      detail: 'effort' | 'usage' | null
      tick: number
    }
  }
}
