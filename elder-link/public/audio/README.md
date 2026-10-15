# Call audio assets

Generated Cantonese audio for the check-in calls. **Committed to the repo**, so a
fresh clone plays real audio with no setup.

## What is here

| File | Spoken Cantonese | Source |
|---|---|---|
| `disclosure.mp3` | AI disclosure | generated |
| `ask.mp3` | the check-in question + keypad prompt | generated |
| `safe.mp3` | reply when the elder is fine | generated |
| `worry.mp3` | reply when the elder is unwell | generated |
| `danger.mp3` | tells the elder to call 999 | generated |
| `unclear.mp3` | could not understand the answer | generated |
| `no_answer.mp3` | nobody answered | generated |
| `close.mp3` | goodbye | generated |
| `closing-music.wav` | traditional-style closing music | generated |

The eight `.mp3` files correspond one-to-one with the lines in
`src/lib/script.ts`. If a line's wording changes, regenerate.

## Regenerating

```bash
node scripts/generate-audio.mjs           # write anything missing
node scripts/generate-audio.mjs --force   # regenerate everything
node scripts/generate-music.mjs --force   # rebuild the music
```

Both scripts run against free endpoints and need no API key.

## Provenance and licensing

**Speech** — Google Translate's speech endpoint with `tl=yue` (real Cantonese,
not Mandarin read aloud). Free, no account, no quota. Reaching a *premium*
neural voice would mean a keyed service; the trade-off is documented in the
script header. To upgrade later, keep the filenames identical and replace
`scripts/generate-audio.mjs` — nothing under `src/` needs to change. Edge-TTS
(`zh-HK-WanLungNeural`, a warmer voice) was the first choice and still works as
an alternative, but Microsoft returns **403 on the synthesis WebSocket** from
some networks, so it cannot be relied on.

**Music** — `closing-music.wav` is an **original composition** rendered by
`scripts/generate-music.mjs` from a five-tone (五聲音階) Cantonese melody. There
is no third-party recording, so there is no licence to clear. Deliberately
nothing was downloaded from the internet: for a care service, shipping a track
whose rights cannot be proven is not worth the risk.

## Behavioural rules

These are enforced in `src/lib/voice.ts`, not just by convention:

- The closing music plays **only after a `safe` check-in**. The `worry`,
  `danger` and `no_answer` lines are safety instructions — the danger line tells
  the elder to call 999 — and music over them would be actively dangerous.
- Volume is `CLOSING_MUSIC_VOLUME` (0.18) with a 1.2 s fade, so it never startles.
- A caption is shown for every line **even if audio fails to play**, so an elder
  is never left with silence and no feedback.

## Playing over a real phone line

`buildGatherTwiml()` in `src/lib/telephony.ts` emits `<Play>` when
`TWILIO_AUDIO_URL` is set, and falls back to `<Say>` otherwise. Point it at any
of these files, e.g.:

```
TWILIO_AUDIO_URL=https://your-app.vercel.app/audio/ask.mp3
```

Files under `public/` are served at the site root, so `public/audio/ask.mp3`
is reachable as `/audio/ask.mp3`.

## Constraints

- Keep speech files mono and small — they travel down a phone line, where
  high-fidelity audio is wasted.
- Never put money, HKID, bank or medical details in the script. It is
  deliberately limited to a greeting and one question.
- These files are inputs to a care system. Changing the wording of the
  `danger` line means re-recording *and* re-reviewing the safety wording.
