# Call audio assets

Optional pre-generated Cantonese audio for check-in calls.

## Why

Twilio's `<Say>` voice quality for Cantonese (`yue-HK`) is inconsistent and
`<Say>` **errors outright** if the voice and language do not match. Playing a
pre-generated MP3 instead decouples voice quality from the carrier entirely and
settles the open PRD question without re-recording anything.

## How to use

1. Generate the script lines from `src/lib/script.ts` as audio using a free
   Cantonese TTS tier (e.g. Azure Speech `zh-HK` voices — ~500k characters/month
   free).
2. Save the result here, e.g. `checkin-yue.mp3`.
3. Set the environment variable:

   ```
   TWILIO_AUDIO_URL=https://your-app.vercel.app/audio/checkin-yue.mp3
   ```

`buildGatherTwiml()` in `src/lib/telephony.ts` then emits `<Play>` instead of
`<Say>` for the disclosure and the question.

## Notes

- Files in `public/` are served as-is at the site root, so `public/audio/x.mp3`
  becomes `/audio/x.mp3`.
- Keep the file small (mono, 8–16 kHz) — it plays down a phone line, so
  high-fidelity audio is wasted bandwidth.
- Only the **disclosure** and the **question** are played from audio. The
  keypad prompt and the closing line still use `<Say>`, so set
  `TWILIO_VOICE` explicitly regardless.
- Never include anything requiring money, HKID, bank or medical details — the
  script is deliberately limited to a greeting and one question.
