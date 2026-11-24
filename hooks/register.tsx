import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { Limits } from '../types'

import {
  ALL_ON,
  BARS,
  DIVIDER,
  FEATURES,
  FIVE_HOURS,
  LABEL,
  LEVELS,
  PICK_FILES,
  USAGE_BLUE,
  WEEK_VIOLET,
  baseName,
  effortMeter,
  glyphFor,
  isImage,
  parseThumbs,
  thumbScript,
  thumbSvg,
  levelIndex,
  suggest,
  toFeatures,
  updateResult,
  usageRings,
  weekOf,
  windowOf,
  withFiles,
} from './logic'

const PLUGIN = 'midstream'

/** Where a prompt came from that the person wrote: only these set the recommendation. */
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

const suggestion = atom({ plugin: 'midstream', key: 'suggestion' } as const, null)
const limits = atom({ plugin: 'midstream', key: 'limits' } as const, { five: null, week: null })
const windowStart = atom({ plugin: 'midstream', key: 'windowStart' } as const, null)
const lastNote = atom({ plugin: 'midstream', key: 'lastNote' } as const, null)
const isWorking = atom({ plugin: 'midstream', key: 'isWorking' } as const, false)
const sent = atom({ plugin: 'midstream', key: 'sent' } as const, 0)
const lines = atom({ plugin: 'midstream', key: 'lines' } as const, 1)
const attachments = atom({ plugin: 'midstream', key: 'attachments' } as const, [])
const detail = atom({ plugin: 'midstream', key: 'detail' } as const, null)
const tick = atom({ plugin: 'midstream', key: 'tick' } as const, 0)
const features = atom({ plugin: 'midstream', key: 'features' } as const, ALL_ON)
const thumbs = atom({ plugin: 'midstream', key: 'thumbs' } as const, {})

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

/** Attach files, and on a surface that draws vectors make small previews of the images. */
async function addFiles($: EngineInterface, paths: readonly string[], canPreview: boolean): Promise<void> {
  await update($, attachments, list => [...new Set([...list, ...paths])])

  const images = paths.filter(isImage)
  if (!canPreview || images.length === 0) return

  try {
    const made = await $.process.run(['powershell.exe', '-NoProfile', '-Command', thumbScript(images)], {
      timeoutMs: 60_000,
    })
    const found = parseThumbs(made.stdout, images)
    if (Object.keys(found).length > 0) {
      await update($, thumbs, t => ({ ...t, ...found }))
    }
  } catch {
    // no preview: the chip shows the glyph
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

      // Which parts of the band are shown, as the settings panel last left them.
      const shown = toFeatures(await $.store.get('features'))
      await update($, features, () => shown)

      // Left behind by versions that had a Hold switch, and an effort selector.
      await $.store.delete('holdOn')
      await $.store.delete('effortMode')
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

      // The level a prompt the person sent would want: the recommendation shown until
      // something else is typed. Commands, the engine's own notices and other sessions'
      // messages are skipped, so only the person's words move it.
      if (e.command === undefined && e.isMeta !== true && isFromPerson(e.origin)) {
        const verdict = suggest(e.text)

        if (verdict) {
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
      const note = await read($, lastNote)
      const usage = await read($, limits)
      const started = await read($, windowStart)
      const working = await read($, isWorking)
      const count = await read($, sent)
      const wanted = await read($, lines)
      const files = await read($, attachments)
      const open = await read($, detail)
      const show = await read($, features)
      const previews = await read($, thumbs)

      const five = windowOf(now, usage.five, started)
      const week = weekOf(now, usage.week)

      // The note field takes the room left after the rows around it, so every control
      // stays on screen however short the window is.
      const room = e.props.maxRows
      const reserved =
        3 +
        1 +
        (files.length > 0 ? (files.some(f => previews[f]) && Svg ? 3 : 1) : 0) +
        (open === 'usage' ? 5 : open === 'settings' ? 3 : 0)
      const minRows = isTerminal || room < 12 ? 2 : 4
      const spare = isTerminal ? room - reserved - 1 : room - reserved
      const rowsFor = (n: number) => Math.max(minRows, Math.min(n, isTerminal ? 8 : 12, spare))
      const fieldRows = rowsFor(wanted)

      // How many rows a text needs, counting lines that wrap.
      const wrapWidth = Math.max(20, e.props.bodyColumns - 8)
      const rowsNeeded = (text: string) =>
        text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / wrapWidth)), 0)

      // The level this text would need as a prompt, recommended while it is typed. Only a
      // change of level redraws the band, so typing is never interrupted.
      const previewEffort = async (value: string) => {
        const verdict = suggest(value)
        const prev = await read($, suggestion)
        if (verdict) {
          if (prev?.source !== 'note' || prev.level !== verdict.level) {
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
            await addFiles($, paths, Svg !== undefined)
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
        await update($, thumbs, () => ({}))
        if ((await read($, suggestion))?.source === 'note') {
          await update($, suggestion, () => null)
        }
        await update($, lines, () => 1)
        await update($, sent, n => n + 1)
      }

      // Refresh: fetch the newest midstream from its GitHub marketplace, install it if it
      // is newer, then reload the plugins (as /reload-plugins does) so it takes effect.
      const refresh = async () => {
        $.ui.toast('Checking GitHub for a newer midstream…')
        try {
          await $.process.run(['claude', 'plugin', 'marketplace', 'update', PLUGIN], { timeoutMs: 150_000 })
          const ran = await $.process.run(['claude', 'plugin', 'update', `${PLUGIN}@${PLUGIN}`, '--json'], {
            timeoutMs: 150_000,
          })
          const { line, isNew } = updateResult(ran.stdout)
          $.ui.toast(
            ran.exitCode !== 0
              ? `Update failed: ${line}`
              : isNew
                ? `${line}. Reloading; if the bar has not changed, restart Claude Code.`
                : line,
          )
        } catch (error) {
          $.ui.toast(`Could not check for updates: ${error instanceof Error ? error.message : String(error)}`)
        }

        try {
          await $.command.run({ command: 'reload-plugins' })
        } catch (error) {
          $.ui.toast(`Could not reload plugins: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const flip = (k: keyof typeof ALL_ON) => async () => {
        const now = await read($, features)
        const flipped = { ...now, [k]: !now[k] }
        await update($, features, () => flipped)
        try {
          await $.store.set('features', flipped)
        } catch {
          // the choice still holds for this chat
        }
      }

      const toggle = (which: 'usage' | 'settings') => () =>
        update($, detail, d => (d === which ? null : which))

      const dim = (text: string) => (
        <Text dimColor size="caption">
          {text}
        </Text>
      )
      const pct = (p: number | null) => (p === null ? '–' : `${Math.round(p)}%`)

      // The app's own band look: no frames of our own, quiet text buttons, and a spacer
      // pushing settings and refresh to the right.
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

      // Enter sends. The surface always draws what Enter does beside a focused field and a
      // plugin cannot hide it, so that is the one send control: it reads Send. A newline is
      // typed as in the main prompt (Shift+Enter), and the field grows with the text: it
      // redraws only when the rows it needs change.
      const field = (
        <Input
          key={`note-${count}`}
          autoFocus
          rows={fieldRows}
          placeholder={placeholder}
          value={typed}
          submitLabel={working ? 'Send note' : 'Send'}
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
                {Svg && previews[path] ? (
                  <Svg source={thumbSvg(previews[path], 36)} alt={`Preview of ${baseName(path)}`} height={36} />
                ) : null}
                <Text>{Svg && previews[path] ? baseName(path) : `${glyphFor(path)} ${baseName(path)}`}</Text>
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

      // ---- one toolbar: attach, the recommended effort and the time left ---------------

      // The effort recommended for what is being typed (or was last sent): shown, never set.
      const level = sug ? levelIndex(sug.level) : null
      const effortLabel = sug ? `Recommended: ${LABEL[sug.level]}` : 'Recommended: –'

      const meter = Svg ? (
        <Svg
          source={effortMeter(level, 24)}
          alt={sug ? `Recommended effort ${LABEL[sug.level]}` : 'No effort recommended yet'}
          height={24}
        />
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
          source={usageRings(five.percent, week.percent, 32)}
          alt={`5-hour ${pct(five.percent)} used, weekly ${pct(week.percent)} used`}
          width={32}
          height={32}
        />
      ) : (
        <Text color={USAGE_BLUE}>◔</Text>
      )

      // Collapsed, the button reads the time left in the 5-hour window, nothing more. The
      // rings show how much is used; the panel has both windows in full.
      const usageLabel = five.headline === 'Reset' || five.headline === '5 hours' ? '5h left' : `${five.headline} left`

      const group = (...children: JSX.Element[]) => (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {children}
        </Box>
      )

      const toolbar = (
        <Box flexDirection="row" alignItems="center" columnGap={2}>
          {show.attach && (
            <Button key="attach" plain dimColor onPress={attach}>
              {files.length > 0 ? `+ Attach · ${files.length}` : '+ Attach'}
            </Button>
          )}
          {show.effort &&
            group(
              meter,
              <Text dimColor key="effort">
                {effortLabel}
              </Text>,
            )}
          {show.usage &&
            group(
              rings,
              <Button key="usage" plain {...(open === 'usage' ? {} : { dimColor: true })} onPress={toggle('usage')}>
                {usageLabel}
              </Button>,
            )}
          {spacer}
          <Button key="settings" plain {...(open === 'settings' ? {} : { dimColor: true })} label="⚙" onPress={toggle('settings')} />
          <Button key="refresh" plain dimColor label="↻" onPress={refresh} />
        </Box>
      )

      // ---- the panels the usage and settings buttons open ------------------------------

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

      // Settings: switch parts of the band on or off. Hiding Effort hides the button only;
      // the level chosen stays in force.
      const settingsPanel = (
        <Box flexDirection="column" rowGap={isTerminal ? 0 : 'xs'}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap="xs">
            {FEATURES.map(([k, name]) => (
              <Button
                key={`feature-${k}`}
                label={`${show[k] ? '✓' : '○'} ${name}`}
                {...(show[k] ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })}
                onPress={flip(k)}
              />
            ))}
          </Box>
          {dim('Show or hide parts of this bar. ↻ checks GitHub for a newer midstream and reloads.')}
        </Box>
      )

      const panel = open === 'usage' && show.usage ? usagePanel : open === 'settings' ? settingsPanel : null

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
          {show.lastNote && sentLine}
          {show.divider && <Box marginTop={isTerminal ? 0 : 'xs'}>{divider}</Box>}
        </Box>
      )
    } catch (error) {
      // Say what went wrong in the band rather than letting it vanish.
      return (
        <Text color="error" size="caption">
          {`midstream could not draw: ${error instanceof Error ? error.message : String(error)}`}
        </Text>
      )
    }
  })
}
