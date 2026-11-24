# midstream

Talk to Claude **midstream**: a side note box for Claude Code, drawn just above the prompt.

- **Notes mid-response.** Type while Claude is working and press Enter (or click **Send note** beside the field): Claude reads the note at its next step and answers it in the same response. While Claude is idle, the note goes in as an ordinary message.
- **Attach files and images.** **+ Attach** opens a file picker. Images show a small preview, and Claude opens the files with its own tools.
- **Recommended effort.** A five-bar meter shows the effort level your note or last prompt calls for, read from its length, wording, code and files. It only recommends; it never changes Claude's setting.
- **Usage at a glance.** One two-ring chart: the outer blue ring is your 5-hour window, the inner violet ring your weekly window. The button shows the time left in the 5-hour window; click it for both windows in detail.
- **Settings.** **⚙** shows or hides parts of the bar (Attach, Effort, Usage, the last-note line, the divider); your choice is kept.
- **Updates.** **↻** checks GitHub for a newer midstream, installs it, and reloads plugins.

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

- The file picker and previews use PowerShell, so they work on Windows only; elsewhere, paste a path into your note.
- Usage figures are the ones the API reports; until it reports a window, that ring stays empty and shows `–`.

## License

MIT
