import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { Applied, EffortMode, Limits, Verdict } from '../types'

import {
  BARS,
  DIVIDER,
  FIVE_HOURS,
  LABEL,
  LEVELS,
  MODES,
  MODE_LABEL,
  PICK_FILES,
  THRESHOLDS,
  USAGE_BLUE,
  WEEK_VIOLET,
  appliedLine,
  baseName,
  decide,
  effortMeter,
  glyphFor,
  isMode,
  levelIndex,
  modeLine,
  suggest,
  usageRings,
  wantedLevel,
  weekOf,
  windowOf,
  withFiles,
} from './logic'

const PLUGIN = 'side-desk'

/** What the suggested level was read from, as the explanation says it. */
const SOURCE = { draft: 'your draft', note: 'this note', sent: 'your last prompt' } as const

/** Where a prompt came from that the person wrote: only these set the Auto level. */
const NOT_THE_PERSON = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
])

function isFromPerson(origin: PromptOrigin | undefined): boolean {
  if (origin === undefined) return true
  if (origin.kind === 'plugin') return origin.asUser === true || origin.name === PLUGIN

  return !NOT_THE_PERSON.has(origin.kind)
}

const suggestion = atom({ plugin: 'side-desk', key: 'suggestion' } as const, null)
const autoPick = atom({ plugin: 'side-desk', key: 'autoPick' } as const, null)
const effortMode = atom({ plugin: 'side-desk', key: 'effortMode' } as const, 'session')
const applied = atom({ plugin: 'side-desk', key: 'applied' } as const, null)
const limits = atom({ plugin: 'side-desk', key: 'limits' } as const, { five: null, week: null })
const windowStart = atom({ plugin: 'side-desk', key: 'windowStart' } as const, null)
const lastNote = atom({ plugin: 'side-desk', key: 'lastNote' } as const, null)
const isWorking = atom({ plugin: 'side-desk', key: 'isWorking' } as const, false)
const sent = atom({ plugin: 'side-desk', key: 'sent' } as const, 0)
const lines = atom({ plugin: 'side-desk', key: 'lines' } as const, 1)
const attachments = atom({ plugin: 'side-desk', key: 'attachments' } as const, [])
const detail = atom({ plugin: 'side-desk', key: 'detail' } as const, null)
const tick = atom({ plugin: 'side-desk', key: 'tick' } as const, 0)

const sameApplied = (a: Applied | null, b: Applied) =>
  a !== null && a.level === b.level && a.isSupported === b.isSupported && a.isOverride === b.isOverride

/** Both usage windows out of the API's readings; a window it did not report stays null. */
function toLimits(readings: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Limits {
  const pick = (kind: string) => {
    const l = readings.find(r => r.kind === kind)
    return l ? { percent: l.percentUsed, resetsAt: l.resetsAt ?? null } : null
  }

  return { five: pick('five_hour'), week: pick('seven_day') }
}

/** Show the level a draft in the main prompt box would get, redrawing only on a change. */
async function showDraft($: EngineInterface, text: string): Promise<void> {
  const verdict = suggest(text)
  const prev = await read($, suggestion)

  if (verdict) {
    if (prev?.source !== 'draft' || prev.level !== verdict.level || prev.why !== verdict.why) {
      await update($, suggestion, () => ({ ...verdict, source: 'draft' as const }))
    }
  } else if (prev?.source === 'draft') {
    await update($, suggestion, () => null)
  }
}

export const register: Register = on => {
  // What the person has typed in the note box. It lives here, not in `$.state`, so a
  // keystroke never makes the band redraw: a redraw that lands late would put an older
  // text back in the field and eat what was typed since. The band redraws only when the
  // rows the field needs, or the suggested level, change.
  let typed = ''

  on('session.start', async ($, e, next) => {
    const refreshRate = async () => {
      try {
        const usage = await $.session.usage()
        await update($, limits, () => toLimits(usage.rateLimits))
      } catch {
        // no reading yet: the estimate stands in
      }
    }

    try {
      const saved = await $.store.get('windowStart')
      if (typeof saved === 'number') {
        await update($, windowStart, () => saved)
      }

      // The effort choice carries over between chats; anything unknown falls back.
      const mode = await $.store.get('effortMode')
      await update($, effortMode, (): EffortMode => (isMode(mode) ? mode : 'session'))

      // Left behind by versions that had a Hold switch.
      await $.store.delete('holdOn')
    } catch {
      // the store only keeps conveniences
    }

    await refreshRate()

    // Keep the countdown moving. While a note is being typed the band is left alone,
    // so nothing redraws under the person's hands.
    $.clock.every(30_000, async () => {
      if (typed !== '') {
        return
      }

      if ((await read($, limits)).five === null) {
        await refreshRate()
      }

      await update($, tick, n => n + 1)
    })

    // Follow the main prompt box as it is typed, where the surface lets a plugin read it.
    // The terminal reports every change itself; this catches a surface that does not, and
    // does nothing where the box reads back empty.
    let lastBox = ''
    $.clock.every(1_500, async () => {
      if (typed !== '') {
        return
      }

      let text = ''
      try {
        text = (await $.prompt.read()).text
      } catch {
        return
      }

      if (text === lastBox) {
        return
      }

      lastBox = text
      await showDraft($, text)
    })

    return next(e)
  })

  // The API's own reading of the usage windows, whenever one moves.
  on('session.measure', async ($, e, next) => {
    await update($, limits, () => toLimits(e.rateLimits))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      // Fallback estimate: a window opens with the first message after the last one ended.
      const now = await $.clock.now()
      const start = await read($, windowStart)

      if (start === null || now - start >= FIVE_HOURS) {
        await update($, windowStart, () => now)
        await $.store.set('windowStart', now)
      }

      // The level a prompt the person sent asks for: what Auto applies to the turn it
      // starts. Commands, the engine's own notices and other sessions' messages are
      // skipped, so only the person's words move it.
      if (e.command === undefined && e.isMeta !== true && isFromPerson(e.origin)) {
        const verdict = suggest(e.text)

        if (verdict) {
          await update($, autoPick, (): Verdict => verdict)
          await update($, suggestion, () => ({ ...verdict, source: 'sent' as const }))
        }
      }
    } catch {
      // the effort read is a nicety: it must never stop a prompt from going through
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => true)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
    }

    return next(e)
  })

  // The effort selector at work: every request of the main conversation is sent at the
  // chosen level, so what the band shows is what Claude runs at. Subagents keep their
  // own. Where the model takes no level nothing is changed, and anything that goes wrong
  // sends the request exactly as the engine made it.
  on('turn.step', async function* ($, e, next) {
    let send: ReturnType<typeof decide>['send'] = null

    if (e.agentId === undefined) {
      try {
        const want = wantedLevel(await read($, effortMode), await read($, autoPick))
        const verdict = decide(e.effort, want)
        send = verdict.send

        if (!sameApplied(await read($, applied), verdict.applied)) {
          await update($, applied, () => verdict.applied)
        }
      } catch {
        send = null
      }
    }

    return yield* next(send === null ? e : { ...e, effort: send })
  })

  // Where the surface reports the prompt as it is typed (the terminal), suggest a level
  // live. An emptied box clears a draft's suggestion but keeps the one for a sent prompt.
  on('prompt.change', async ($, e, next) => {
    await showDraft($, e.text)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text, Input, Button } = $.ui.resolve(e)
    // The desktop and phones draw vectors; the terminal draws glyphs instead.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const isTerminal = e.surface === 'terminal'

    try {
      await read($, tick)
      const now = await $.clock.now()
      const sug = await read($, suggestion)
      const auto = await read($, autoPick)
      const mode = await read($, effortMode)
      const ran = await read($, applied)
      const note = await read($, lastNote)
      const usage = await read($, limits)
      const started = await read($, windowStart)
      const working = await read($, isWorking)
      const count = await read($, sent)
      const wanted = await read($, lines)
      const files = await read($, attachments)
      const open = await read($, detail)

      const five = windowOf(now, usage.five, started)
      const week = weekOf(now, usage.week)

      // The level in force, and the only one the meter and its label show: a fixed
      // choice; for Auto the level of the last prompt sent; for Default what the last
      // request ran at. What a draft would get is shown in the panel, never here.
      const inForce = mode === 'session' ? (ran?.level ?? null) : mode === 'auto' ? (auto?.level ?? null) : mode
      const level = inForce === null ? null : levelIndex(inForce)
      const isUnsupported = mode !== 'session' && ran !== null && !ran.isSupported

      // The note field takes the room left after the rows around it, so every control
      // stays on screen however short the window is.
      const room = e.props.maxRows
      const reserved =
        3 +
        1 +
        (files.length > 0 ? 1 : 0) +
        (open === 'effort' ? 7 : open === 'usage' ? 5 : 0)
      const minRows = isTerminal || room < 12 ? 2 : 4
      const spare = isTerminal ? room - reserved - 1 : room - reserved
      const rowsFor = (n: number) => Math.max(minRows, Math.min(n, isTerminal ? 8 : 12, spare))
      const fieldRows = rowsFor(wanted)

      // How many rows a text needs, counting lines that wrap.
      const wrapWidth = Math.max(20, e.props.bodyColumns - 8)
      const rowsNeeded = (text: string) =>
        text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / wrapWidth)), 0)

      // The level this text would need as a prompt, shown in the effort panel while it is
      // typed. Only a change of level redraws the band, so typing is never interrupted;
      // with the panel open the reasons follow along too.
      const previewEffort = async (value: string) => {
        const verdict = suggest(value)
        const prev = await read($, suggestion)
        const isWatching = (await read($, detail)) === 'effort'

        if (verdict) {
          if (
            prev?.source !== 'note' ||
            prev.level !== verdict.level ||
            (isWatching && prev.why !== verdict.why)
          ) {
            await update($, suggestion, () => ({ ...verdict, source: 'note' as const }))
          }
        } else if (prev?.source === 'note') {
          await update($, suggestion, () => null)
        }
      }

      // Attach: a native Windows file dialog. The files are named in the message, and
      // Claude opens them with its own tools, so photos and documents both work.
      const attach = async () => {
        try {
          let isWindows = true
          try {
            const { platform } = await $.session.info()
            isWindows = platform === 'windows' || platform === 'wsl'
          } catch {
            // the host would not say: try, the command fails cleanly where it cannot run
          }

          if (!isWindows) {
            $.ui.toast('The file picker works on Windows only. Paste a file path into your note instead.')
            return
          }

          const picked = await $.process.run(
            ['powershell.exe', '-NoProfile', '-STA', '-Command', PICK_FILES],
            { timeoutMs: 600_000 },
          )
          const paths = picked.stdout
            .split(/\r?\n/)
            .map(p => p.trim())
            .filter(p => p !== '')

          if (paths.length > 0) {
            await update($, attachments, list => [...new Set([...list, ...paths])])
          } else if (picked.exitCode !== 0) {
            $.ui.toast(`Could not open the file picker: ${picked.stderr.trim().slice(0, 120)}`)
          }
        } catch (error) {
          $.ui.toast(`Could not open the file picker: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Hand a note to Claude: into the running response, or as a prompt when it is idle.
      const send = async (value: string) => {
        const picked = await read($, attachments)
        const message = value.trim()
        if (message === '' && picked.length === 0) {
          return
        }

        const body = withFiles(message, picked)
        const isLive = await read($, isWorking)
        const at = await $.clock.now()
        const label = message || `${picked.length} attached file${picked.length === 1 ? '' : 's'}`

        if (isLive) {
          const delivered = await $.session.append({
            message: {
              type: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'The user typed a side note into a second text box while you were working. ' +
                    'It is a message from them: read it now and answer it or act on it as part of ' +
                    'your current response, before you finish, saying briefly that you saw it.\n\n' +
                    `Side note: ${body}`,
                },
              ],
            },
          })

          if (delivered.deny !== undefined) {
            $.ui.toast(`${PLUGIN}: note refused (${delivered.deny})`)
            return
          }

          $.ui.toast('Note sent: Claude reads it at its next step')
          await update($, lastNote, () => ({ text: label, mode: 'live' as const, at }))
        } else {
          void $.prompt.submit({ text: body, asUser: true })
          await update($, lastNote, () => ({ text: label, mode: 'prompt' as const, at }))
        }

        typed = ''
        await update($, attachments, () => [])
        if ((await read($, suggestion))?.source === 'note') {
          await update($, suggestion, () => null)
        }
        await update($, lines, () => 1)
        await update($, sent, n => n + 1)
      }

      // The same as typing /reload-plugins: run once the session is idle.
      const reload = async () => {
        try {
          await $.command.run({ command: 'reload-plugins' })
        } catch (error) {
          $.ui.toast(`Could not reload plugins: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const toggle = (which: 'effort' | 'usage') => () =>
        update($, detail, d => (d === which ? null : which))

      const choose = (picked: EffortMode) => async () => {
        await update($, effortMode, () => picked)
        try {
          await $.store.set('effortMode', picked)
        } catch {
          // the choice still holds for this chat
        }
      }

      const dim = (text: string) => (
        <Text dimColor size="caption">
          {text}
        </Text>
      )
      const pct = (p: number | null) => (p === null ? '–' : `${Math.round(p)}%`)

      // The app's own band look: no frames of our own, text buttons, one filled button
      // for the main action, and a spacer pushing it to the right.
      const spacer = <Box flexGrow={1} />

      // ---- the line that closes this row off from whatever is drawn below it ----------
      // The engine stacks other plugins' rows (ponytail's, say) under this one and gives
      // no say in the order, so the side note ends with a hairline of its own.

      const divider = Svg ? (
        <Svg source={DIVIDER} alt="Divider" height={1} />
      ) : (
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(Math.max(1, e.props.bodyColumns))}
        </Text>
      )

      // ---- the note field and the files going with it --------------------------------

      const placeholder = working
        ? 'Add a note for Claude while it works…'
        : isTerminal
          ? 'Message Claude… (Shift+Enter or \\ then Enter for a new line)'
          : 'Message Claude… (Shift+Enter for a new line)'

      // Enter sends. The surface always draws a hint of what Enter does beside a focused
      // field (an empty label draws an empty pill), so it reads as the Enter key alone and
      // the Send button stays the one send control. A newline is typed as in the main
      // prompt (Shift+Enter), and the field grows with the text: it redraws only when the
      // rows it needs change.
      const field = (
        <Input
          key={`note-${count}`}
          autoFocus
          rows={fieldRows}
          placeholder={placeholder}
          value={typed}
          submitLabel="↵"
          onInput={value => {
            typed = value
            const needed = rowsNeeded(value)

            if (rowsFor(needed) !== fieldRows) {
              void update($, lines, () => needed)
            }

            void previewEffort(value)
          }}
          onSubmit={value => send(value)}
        />
      )

      const chips =
        files.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2}>
            {files.map((path, i) => (
              <Box flexDirection="row" alignItems="center" columnGap={1}>
                <Text>{`${glyphFor(path)} ${baseName(path)}`}</Text>
                <Button
                  key={`remove-${i}`}
                  plain
                  dimColor
                  label="✕"
                  onPress={() => update($, attachments, list => list.filter((_, n) => n !== i))}
                />
              </Box>
            ))}
          </Box>
        ) : null

      // ---- one toolbar: attach, effort and usage as text buttons, Send on the right ----

      const effortLabel =
        mode === 'session'
          ? `Default${inForce ? ` · ${LABEL[inForce]}` : ''}`
          : mode === 'auto'
            ? `Auto${inForce ? ` · ${LABEL[inForce]}` : ''}`
            : LABEL[mode]

      const meter = Svg ? (
        <Svg source={effortMeter(level, 14)} alt={inForce ? `Effort ${LABEL[inForce]}` : 'Effort not set'} />
      ) : (
        <Text>
          {LEVELS.map((name, i) => (
            <Text {...(level !== null && i <= level ? { color: 'claude' } : { dimColor: true })}>
              {BARS[name]}
            </Text>
          ))}
        </Text>
      )

      const rings = Svg ? (
        <Svg
          source={usageRings(five.percent, week.percent, 18)}
          alt={`5-hour ${pct(five.percent)} used, weekly ${pct(week.percent)} used`}
        />
      ) : (
        <Text color={USAGE_BLUE}>◔</Text>
      )

      // A control with a description that shows while the pointer is over it: a card drawn
      // over the field above, revealed by the surface on hover, so nothing reflows.
      const withTip = (name: string, tip: string, isRightEdge: boolean, ...control: JSX.Element[]) => (
        <Box key={`tip-${name}`} flexDirection="row" alignItems="center" columnGap={1}>
          {control}
          <Box
            position="absolute"
            top={-2}
            {...(isRightEdge ? { right: 0 } : { left: 0 })}
            display="none"
            hover={{ display: 'flex' }}
            backgroundColor="text"
            paddingX={1}
          >
            <Text color="inverseText" size="caption" wrap="truncate-end">
              {tip}
            </Text>
          </Box>
        </Box>
      )

      // Time left in each window, on the button itself: the 5-hour countdown (or its
      // estimate) and the weekly one.
      const fiveLeft = five.headline === 'Reset' || five.headline === '5 hours' ? null : five.headline
      const weekLeft = week.headline.startsWith('resets in ') ? week.headline.slice('resets in '.length) : null
      const usageLabel =
        `5h ${pct(five.percent)}${fiveLeft ? ` ↻ ${fiveLeft}` : ''}` +
        ` · week ${pct(week.percent)}${weekLeft ? ` ↻ ${weekLeft}` : ''}`

      const toolbar = (
        <Box flexDirection="row" alignItems="center" columnGap={2}>
          {withTip(
            'attach',
            'Attach files to your note: Claude opens them with its own tools',
            false,
            <Button key="attach" plain dimColor onPress={attach}>
              {files.length > 0 ? `+ Attach · ${files.length}` : '+ Attach'}
            </Button>,
          )}
          {withTip(
            'effort',
            'Effort: how hard Claude thinks on each request. Click to pick Default, Auto or a level',
            false,
            meter,
            <Button key="effort" plain {...(open === 'effort' ? {} : { dimColor: true })} onPress={toggle('effort')}>
              {`${effortLabel}${isUnsupported ? ' ⚠' : ''}`}
            </Button>,
          )}
          {withTip(
            'usage',
            'Plan usage: 5-hour and weekly windows, ↻ time until each resets. Click for details',
            false,
            rings,
            <Button key="usage" plain {...(open === 'usage' ? {} : { dimColor: true })} onPress={toggle('usage')}>
              {usageLabel}
            </Button>,
          )}
          {spacer}
          {withTip(
            'reload',
            'Reload plugins: picks up a new version of this mod (and any other)',
            true,
            <Button key="reload" plain dimColor label="↻" onPress={reload} />,
          )}
          {withTip(
            'send',
            working ? 'Claude reads it at its next step, mid-response (Enter)' : 'Send as a new message (Enter)',
            true,
            <Button key="send" variant="primary" onPress={() => send(typed)}>
              {working ? 'Send note' : 'Send'}
            </Button>,
          )}
        </Box>
      )

      // ---- the panels the effort and usage buttons open -------------------------------

      const effortPanel = (
        <Box flexDirection="column" rowGap={isTerminal ? 0 : 'xs'}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap="xs">
            {MODES.map(m => (
              <Button
                key={`effort-${m}`}
                label={MODE_LABEL[m]}
                {...(m === mode ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })}
                onPress={choose(m)}
              />
            ))}
          </Box>
          {dim(modeLine(mode, auto))}
          <Text size="caption" {...(isUnsupported ? { color: 'warning' } : { dimColor: true })}>
            {appliedLine(ran)}
          </Text>
          {dim(
            sug
              ? `Why ${LABEL[sug.level]}, read from ${SOURCE[sug.source]}: ` +
                  sug.parts
                    .slice(0, 4)
                    .map(p => `${p.label} ${p.points > 0 ? '+' : p.points < 0 ? '−' : ''}${Math.abs(p.points)}`)
                    .join(' · ') +
                  ` → Score ${sug.score}`
              : 'How the effort level is chosen: a quick read of the text (length, hard words, code, files, lists), done on this machine.',
          )}
          {dim(THRESHOLDS)}
        </Box>
      )

      // Each window gets a legend line in its ring's color: what is used, when it resets.
      const legend = (color: string, name: string, percent: number | null, when: string) => (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Text color={color}>●</Text>
          <Text size="caption" weight="semibold">
            {name}
          </Text>
          {dim(percent === null ? when : `${Math.round(percent)}% used · ${when}`)}
        </Box>
      )

      const usagePanel = (
        <Box flexDirection="row" alignItems="center" columnGap={2}>
          {Svg && (
            <Svg
              source={usageRings(five.percent, week.percent, 76)}
              alt={`5-hour window ${pct(five.percent)} used, weekly window ${pct(week.percent)} used`}
              width={76}
              height={76}
            />
          )}
          <Box flexDirection="column" rowGap="xs">
            {legend(
              USAGE_BLUE,
              '5-hour',
              five.percent,
              five.headline === 'Reset' || five.headline === '5 hours'
                ? five.caption
                : `resets in ${five.headline.replace(/^~/, 'about ')}`,
            )}
            {legend(WEEK_VIOLET, 'Weekly', week.percent, week.headline)}
            {dim('Outer ring: 5-hour window · inner ring: weekly window')}
          </Box>
        </Box>
      )

      const panel = open === 'effort' ? effortPanel : open === 'usage' ? usagePanel : null

      const sentLine = note && (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {dim(
            `✓ ${note.mode === 'live' ? 'Sent mid-response' : 'Sent as a message'}: “${note.text.slice(0, 70)}${note.text.length > 70 ? '…' : ''}”`,
          )}
          <Button key="hide-note" plain dimColor label="✕" onPress={() => update($, lastNote, () => null)} />
        </Box>
      )

      return (
        <Box flexDirection="column" rowGap={isTerminal ? 0 : 'sm'}>
          {chips}
          {field}
          {toolbar}
          {panel}
          {sentLine}
          <Box marginTop={isTerminal ? 0 : 'xs'}>{divider}</Box>
        </Box>
      )
    } catch (error) {
      // Say what went wrong in the band rather than letting it vanish.
      return (
        <Text color="error" size="caption">
          {`side-desk could not draw: ${error instanceof Error ? error.message : String(error)}`}
        </Text>
      )
    }
  })
}
