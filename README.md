# midstream

Talk to Claude **midstream**: a side note box for Claude Code, drawn just above the prompt.

- **Notes mid-response.** Type while Claude is working and press Enter (or **Send note**): Claude reads the note at its next step and answers it in the same response. While Claude is idle, the note goes in as an ordinary message.
- **Attach files.** **+ Attach** opens a file picker (Windows) and names the files in your note, so Claude opens them with its own tools.
- **Effort you can trust.** Pick **Default**, **Auto** (a level read from your last prompt) or a fixed level from Low to Max. Every request of the main conversation runs at that level, and the five-bar meter shows the level actually in force.
- **Usage at a glance.** One two-ring chart: the outer blue ring is your 5-hour window, the inner violet ring your weekly window. The button shows both percentages and the time until each resets (↻); click it for details.
- **Hover help.** Every button describes itself on hover. **↻** at the right reloads plugins.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install midstream --marketplace YK3D/midstream
```

Answer `y` to add the marketplace, then pick a scope (user is first).

From a shell:

```
claude plugin install midstream --marketplace YK3D/midstream
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `YK3D/midstream`, then **Add plugin**.

## Notes

- The file picker uses PowerShell, so it works on Windows only; elsewhere, paste a path into your note.
- Models that take no effort setting are left alone, and the effort panel says so.
- Usage figures are the ones the API reports; until it reports a window, that ring stays empty and shows `–`.

## License

MIT
