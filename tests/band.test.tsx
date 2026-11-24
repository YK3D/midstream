import { expect, mock, test } from 'claude-code/testing'

import {
  USAGE_BLUE,
  baseName,
  effortMeter,
  glyphFor,
  levelIndex,
  suggest,
  parseThumbs,
  thumbSvg,
  toFeatures,
  updateResult,
  usageRings,
  weekOf,
  windowOf,
  withFiles,
} from '../hooks/logic'

const BAND = {
  plugin: 'midstream',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 40,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const HEAVY =
  'Refactor the whole codebase architecture and migrate the auth module. ' +
  'Investigate the race condition in src/a.ts, src/b.ts and src/c.ts too. ' +
  'x'.repeat(500)

const world = ($: unknown, on: Parameters<typeof mock.clock>[0]) => {
  void $
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { TEMP: 'C:\\tmp' })
  on('ui.toast', () => ({ value: undefined }))

  return clock
}

test('the bar has the note field, attach, effort, usage and send on each surface that takes input', async ($, on) => {
  world($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    const field = await ui.find({ type: 'Input' })
    expect(field?.key).toBe('note-0')
    // The hint the surface draws beside the field is the one send control.
    expect(field?.props.submitLabel).toBe('Send')
    for (const key of ['attach', 'usage', 'settings', 'refresh']) {
      expect(await ui.find({ type: 'Button', key })).toBeDefined()
    }
    // No second Send button, no Paste button, no effort picker.
    for (const key of ['send', 'paste', 'effort']) {
      expect(await ui.find({ type: 'Button', key })).toBeUndefined()
    }
    // No hover cards: nothing hidden waiting for the pointer.
    expect(JSON.stringify(await ui.drawn())).not.toContain('"display":"none"')
    // Hold mode is gone: no switch, no Finish.
    expect(await ui.find({ type: 'Button', key: 'hold' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'finish' })).toBeUndefined()

    await ui.unmount()
  }
})

test('the usage button opens both windows, and closes again', async ($, on) => {
  world($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Weekly')

  await ui.press({ key: 'usage' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('5-hour')
  expect(drawn).toContain('Weekly')

  await ui.press({ key: 'usage' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Weekly')
  await ui.unmount()
})

test('the effort shown is only a recommendation, read from what is typed or was sent', async ($, on) => {
  world($, on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const label = suggest(HEAVY)?.level === 'max' ? 'Max' : 'Extra'

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn())).toContain('Recommended: –')

  await ui.input({ key: 'note-0', kind: 'change', text: HEAVY })
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain(`Recommended: ${label}`)
  expect(drawn).toContain(`"alt":"Recommended effort ${label}"`)

  await ui.input({ key: 'note-0', kind: 'change', text: '' })
  expect(JSON.stringify(await ui.drawn())).toContain('Recommended: –')
  await ui.unmount()

  // A prompt sent from the main box sets it too, on every surface.
  await $.prompt.submit({ text: HEAVY, wait: false, origin: { kind: 'composer' } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const again = await $.ui.mount({ ...BAND, surface })
    drawn = JSON.stringify(await again.drawn())
    expect(drawn).toContain(`Recommended: ${label}`)
    await again.unmount()
  }
})

test('a note sent while Claude is idle goes in as a prompt, and the field is renamed to clear it', async ($, on) => {
  world($, on)

  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'note-0', text: 'check the tests too' })

  expect(prompts).toEqual(['check the tests too'])
  expect((await ui.find({ type: 'Input' }))?.key).toBe('note-1')
  expect(await ui.find({ type: 'Text', text: /Sent as a message/ })).toBeDefined()
  await ui.unmount()
})

test('a note sent while Claude is working is appended to the running response', async ($, on) => {
  world($, on)
  const session = mock.session(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'refactor it', turnId: 'turn-1' })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, isWorking: true },
    surface: 'desktop',
  })
  await ui.input({ key: 'note-0', text: 'also keep the old API' })

  const rows = session.appended()
  expect(rows).toHaveLength(1)
  expect(JSON.stringify(rows[0]?.message)).toContain('Side note: also keep the old API')
  expect(await ui.find({ type: 'Text', text: /Sent mid-response/ })).toBeDefined()

  // The ✕ beside it hides the line.
  await ui.press({ key: 'hide-note' })
  expect(await ui.find({ type: 'Text', text: /Sent mid-response/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'hide-note' })).toBeUndefined()
  await ui.unmount()
})

test('the + button attaches files by path, chips can be removed, and the rest go with the note', async ($, on) => {
  world($, on)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: 'C:\\Users\\me\\photo.png\r\nC:\\Users\\me\\report.pdf\r\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'attach' })

  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('photo.png')
  expect(drawn).toContain('report.pdf')

  await ui.press({ key: 'remove-0' })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('photo.png')
  expect(drawn).toContain('report.pdf')

  await ui.input({ key: 'note-0', text: 'summarise this' })

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('summarise this')
  expect(prompts[0]).toContain('C:\\Users\\me\\report.pdf')
  expect(prompts[0]).not.toContain('photo.png')
  expect(JSON.stringify(await ui.drawn())).not.toContain('report.pdf')
  await ui.unmount()
})

test('files alone can be sent, with a short request in their place', async ($, on) => {
  world($, on)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: 'C:\\Users\\me\\notes.txt\r\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'attach' })
  await ui.input({ key: 'note-0', text: '' })

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Please take a look at the attached files.')
  expect(prompts[0]).toContain('notes.txt')
  await ui.unmount()
})

test('cancelling the file dialog attaches nothing', async ($, on) => {
  world($, on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'attach' })

  expect(await ui.find({ type: 'Button', key: 'remove-0' })).toBeUndefined()
  await ui.unmount()
})

test('the note field starts four rows tall and grows as lines are typed', async ($, on) => {
  world($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(4)

  // Three lines fit the four rows: nothing needs to redraw.
  await ui.input({ key: 'note-0', text: 'one\ntwo\nthree', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(4)

  await ui.input({ key: 'note-0', text: 'a\nb\nc\nd\ne\nf\ng', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(7)

  await ui.input({ key: 'note-0', text: 'a\nb', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(4)

  // Long text stops growing at twelve rows and scrolls inside the field.
  await ui.input({ key: 'note-0', text: Array.from({ length: 30 }, () => 'x').join('\n'), kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(12)
  await ui.unmount()
})

test('a short band still shows every feature, with a smaller field', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-20T12:00:00Z') })
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 31, resetsAt: '2026-11-20T15:12:00Z' }],
    changed: ['rateLimits'],
  } as never)

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 10 }, surface: 'desktop' })

  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(2)
  for (const key of ['attach', 'usage', 'settings', 'refresh']) {
    expect(await ui.find({ type: 'Button', key })).toBeDefined()
  }
  expect(JSON.stringify(await ui.drawn())).toContain('Recommended:')
  // Collapsed, the usage button reads the time left alone.
  expect((await ui.find({ type: 'Button', key: 'usage' }))?.props.label).toBe('3h 12m left')
  await ui.unmount()
})

test('sending clears the field and resets its height', async ($, on) => {
  world($, on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'note-0', text: 'a\nb\nc\nd\ne\nf\ng\nh', kind: 'change' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(8)

  await ui.input({ key: 'note-0', text: 'a\nb\nc\nd\ne\nf\ng\nh' })
  const field = await ui.find({ type: 'Input' })
  expect(field?.key).toBe('note-1')
  expect(field?.props.rows).toBe(4)
  await ui.unmount()
})

test('an empty note with no files sends nothing', async ($, on) => {
  world($, on)

  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'note-0', text: '   ' })

  expect(prompts).toEqual([])
  expect((await ui.find({ type: 'Input' }))?.key).toBe('note-0')
  await ui.unmount()
})

test('both windows from the API show on every surface, in one chart', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-20T12:00:00Z') })
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 31, resetsAt: '2026-11-20T15:12:00Z' },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-11-24T14:00:00Z' },
    ],
    changed: ['rateLimits'],
  } as never)

  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(JSON.stringify(await ui.drawn())).not.toContain('could not draw')
    expect((await ui.find({ type: 'Button', key: 'usage' }))?.props.label).toBe('3h 12m left')

    await ui.press({ key: 'usage' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('31% used · resets in 3h 12m')
    expect(drawn).toContain('12% used · resets in 4d 2h')
    await ui.press({ key: 'usage' })
    await ui.unmount()
  }

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(JSON.stringify(await desktop.drawn())).toContain('"alt":"5-hour 31% used, weekly 12% used"')
  await desktop.unmount()
})

test('leftovers of the effort selector and Hold are cleared from the store', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const saved: Record<string, unknown> = { effortMode: 'xhigh', holdOn: false }
  on('store.get', (_, e) => ({ value: saved[e.key] }))
  on('store.set', (_, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete saved[e.key]
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  expect('holdOn' in saved).toBe(false)
  expect('effortMode' in saved).toBe(false)
})

test('both panels draw on every surface', async ($, on) => {
  world($, on)

  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    await ui.press({ key: 'usage' })
    let drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('could not draw')
    expect(drawn).toContain('Weekly')

    await ui.press({ key: 'settings' })
    drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('could not draw')
    expect(drawn).not.toContain('Weekly')
    expect(await ui.find({ type: 'Button', key: 'feature-effort' })).toBeDefined()

    await ui.press({ key: 'settings' })
    await ui.unmount()
  }
})

test('the band draws no frames of its own, so only the app draws corners', async ($, on) => {
  world($, on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'C:\\a.png\r\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'attach' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('borderStyle')
    await ui.press({ key: 'settings' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('borderStyle')
    await ui.press({ key: 'usage' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('borderStyle')
    await ui.press({ key: 'usage' })
    await ui.press({ key: 'remove-0' })
    await ui.unmount()
  }
})

test('with hold mode gone, a response ends as soon as Claude stops', async ($, on) => {
  world($, on)
  on('classic.Stop', () => ({}))

  const result = await $.classic.Stop({ stop_hook_active: false })
  expect(result.block).toBeUndefined()
})

// ---- the rules, without the screen ------------------------------------------

test('the effort suggestion scales with the prompt', () => {
  expect(suggest('hi')).toBeNull()
  expect(suggest('/help')).toBeNull()
  expect(suggest('fix the typo in the readme')?.level).toBe('low')
  expect(
    suggest('add a dark mode toggle to the settings page and remember the choice between launches')
      ?.level,
  ).toBe('medium')

  const big = suggest(HEAVY)
  expect(['xhigh', 'max']).toContain(big?.level)
  expect(big?.why).toContain('refactor')
})

test('the working adds up to the score, and the score decides the level', () => {
  const verdict = suggest(HEAVY)

  expect(verdict?.score).toBe(verdict?.parts.reduce((n, p) => n + p.points, 0))
  expect(verdict?.parts.some(p => p.label.includes('hard words'))).toBe(true)
  expect(verdict?.parts.some(p => p.label === 'mentions several files')).toBe(true)

  const easy = suggest('fix the typo in the readme')
  expect(easy?.score).toBeLessThanOrEqual(0)
  expect(easy?.parts.some(p => p.points < 0)).toBe(true)
})

test('the window text follows the API reading, then an estimate, then nothing', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')

  const exact = windowOf(now, { percent: 31, resetsAt: '2026-11-20T15:12:00Z' }, null)
  expect(exact.headline).toBe('3h 12m')
  expect(exact.percent).toBe(31)

  const past = windowOf(now, { percent: 99, resetsAt: '2026-11-20T11:00:00Z' }, null)
  expect(past.headline).toBe('Reset')
  expect(past.percent).toBeNull()

  const estimate = windowOf(now, null, now - 60 * 60 * 1000)
  expect(estimate.headline).toBe('~4h 00m')

  expect(windowOf(now, null, null).headline).toBe('5 hours')
})

test('the usage chart draws the 5-hour ring outside and the weekly ring inside', () => {
  const both = usageRings(50, 25, 44)
  expect(USAGE_BLUE).toBe('#2C84DB')
  expect(both).toContain('#2C84DB')
  expect(both).toContain('#8B7CF6')
  // Two tracks and two used arcs.
  expect((both.match(/<circle/g) ?? []).length).toBe(4)

  // A window with no reading shows its track alone.
  const fiveOnly = usageRings(50, null, 44)
  expect(fiveOnly).toContain('#2C84DB')
  expect(fiveOnly).not.toContain('#8B7CF6')
  expect((usageRings(null, null, 14).match(/<circle/g) ?? []).length).toBe(2)
})

test('the weekly window reads in days and hours', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  expect(weekOf(now, { percent: 12, resetsAt: '2026-11-24T14:00:00Z' })).toEqual({
    percent: 12,
    headline: 'resets in 4d 2h',
  })
  expect(weekOf(now, { percent: 12, resetsAt: '2026-11-20T15:00:00Z' }).headline).toBe('resets in 3h 00m')
  expect(weekOf(now, null)).toEqual({ percent: null, headline: 'not reported yet' })
})

test('the effort meter fills exactly one bar per level, Low one and Max five', () => {
  const fills = (svg: string) => (svg.match(/fill-opacity="1"/g) ?? []).length

  expect(levelIndex('low')).toBe(0)
  expect(levelIndex('max')).toBe(4)
  expect(fills(effortMeter(null, 12))).toBe(0)
  expect(fills(effortMeter(levelIndex('low'), 12))).toBe(1)
  expect(fills(effortMeter(levelIndex('high'), 12))).toBe(3)
  expect(fills(effortMeter(levelIndex('max'), 12))).toBe(5)
  expect((effortMeter(2, 12).match(/<rect/g) ?? []).length).toBe(5)
})

test('settings hide parts of the bar, and the choice is kept for the next chat', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'feature-usage' })
  await ui.press({ key: 'feature-attach' })

  expect(await ui.find({ type: 'Button', key: 'usage' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'attach' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('Recommended:')
  expect(kept.get('features')).toEqual({ attach: false, effort: true, usage: false, lastNote: true, divider: true })

  // Back on again.
  await ui.press({ key: 'feature-usage' })
  expect(await ui.find({ type: 'Button', key: 'usage' })).toBeDefined()
  await ui.press({ key: 'settings' })
  await ui.unmount()
})

test('stored settings fall back to on, and the update result reads as one line', () => {
  expect(toFeatures(undefined)).toEqual({ attach: true, effort: true, usage: true, lastNote: true, divider: true })
  expect(toFeatures({ usage: false, divider: 'no' }).usage).toBe(false)
  expect(toFeatures({ usage: false, divider: 'no' }).divider).toBe(true)

  expect(
    updateResult('Checking…\n{"outcome":"ok","updateOutcome":"up_to_date","oldVersion":"0.12.0","newVersion":"0.12.0"}'),
  ).toEqual({ line: 'midstream is up to date (0.12.0)', isNew: false })
  expect(updateResult('{"outcome":"ok","updateOutcome":"updated","oldVersion":"0.12.0","newVersion":"0.13.0"}')).toEqual({
    line: 'Updated midstream 0.12.0 → 0.13.0',
    isNew: true,
  })
  expect(updateResult('garbage').line).toBe('Could not read the update result')
})

test('an image preview is read from the script and drawn pixel by pixel', () => {
  const thumbs = parseThumbs('0|2|1|ff0000ff0000\r\nbroken line\r\n1|2|2|00\r\n', ['C:\\a\\cat.png', 'C:\\b.png'])
  expect(Object.keys(thumbs)).toEqual(['C:\\a\\cat.png'])

  const svg = thumbSvg(thumbs['C:\\a\\cat.png']!, 36)
  // Two red pixels in a row are one rect.
  expect((svg.match(/<rect/g) ?? []).length).toBe(1)
  expect(svg).toContain('#ff0000')
  expect(svg).toContain('width="72"')
  expect(svg).not.toContain('data:')
})

test('attachments are named by their file and handed over as paths', () => {
  expect(baseName('C:\\Users\\me\\Documents\\report.pdf')).toBe('report.pdf')
  expect(baseName('/home/me/photo.png')).toBe('photo.png')
  expect(glyphFor('x.PNG')).toBe('🖼')
  expect(glyphFor('x.pdf')).toBe('📄')

  expect(withFiles('hello', [])).toBe('hello')
  const text = withFiles('look', ['C:\\a.png', 'C:\\b.pdf'])
  expect(text).toContain('look')
  expect(text).toContain('- C:\\a.png')
  expect(text).toContain('- C:\\b.pdf')
  expect(withFiles('', ['C:\\a.png'])).toContain('Please take a look')
})
