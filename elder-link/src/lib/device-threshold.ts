// Where the door-open threshold actually comes from.
//
// This module exists because the app and the hardware must agree on one number,
// and for a while they did not: the app's comments claimed a 120 s threshold
// while the ESP32 firmware on the door was alarming at 15 s. Nothing was broken
// at runtime — the app simply trusts the firmware's `alarm` flag — but the
// disagreement was a trap for whoever read the code next, and it meant a
// caregiver could have been told "120 seconds" with no way to check.
//
// The honest position is this:
//
//   * The physical device owns the timing. It is the only thing that can see
//     the door, and its firmware decides when a door counts as "left open".
//   * The app cannot change that from here. The door monitor is an ESP32-S3
//     whose firmware is flashed onto the board; it exposes exactly one endpoint
//     (`/data`) and has no /config, /status or /settings route to push a new
//     value to. Changing the real duration means reflashing the firmware.
//   * So the app's job is not to *impose* a threshold. It is to know what the
//     device is doing, say so plainly, and refuse to pretend otherwise.
//
// Hence `DEVICE_THRESHOLD_SECONDS` below is a *declaration of fact about the
// hardware*, set to match the flashed firmware, not a knob the app enforces.
// When the firmware is rebuilt with a different value, this constant moves with
// it. `describeThreshold()` is what the UI reads, so the number a caregiver
// sees is always traceable to a single line.

/**
 * The door-open duration, in seconds, after which the ESP32 firmware raises
 * `alarm: true` on its `/data` endpoint.
 *
 * Set from the flashed firmware: its own status text reads
 * `ALERT: Door Open > 15s!`, and the value is hardcoded in the sketch. Only
 * change this when the firmware on the device is reflashed to match.
 */
export const DEVICE_THRESHOLD_SECONDS = 15;

/** The firmware build this constant describes. Bump when the board is reflashed. */
export const DEVICE_FIRMWARE_LABEL = "ESP32-S3 Door Monitor";

/**
 * Where the threshold is enforced. There is exactly one correct answer today,
 * and naming it explicitly is the point of this module — it makes it obvious
 * that `device_firmware` is not a placeholder for something the app does.
 */
export type ThresholdSource = "device_firmware";

export type ThresholdDescriptor = {
  seconds: number;
  source: ThresholdSource;
  firmware: string;
  /**
   * True when the app can change this value by itself. Always false while the
   * threshold lives in flashed firmware — kept as a field so callers never have
   * to hardcode the assumption.
   */
  configurableFromApp: boolean;
  /** One sentence, safe to show a caregiver. */
  explanation: string;
};

/**
 * Describe the effective threshold so every surface tells the same story.
 *
 * The number is deliberately reported as the device's, because that is the
 * truth even though it may surprise someone who set a different value in the
 * app expecting it to apply.
 */
export function describeThreshold(): ThresholdDescriptor {
  return {
    seconds: DEVICE_THRESHOLD_SECONDS,
    source: "device_firmware",
    firmware: DEVICE_FIRMWARE_LABEL,
    configurableFromApp: false,
    explanation:
      `The door sensor's firmware raises the alarm after the door has been held open for ` +
      `${DEVICE_THRESHOLD_SECONDS} seconds. That timing runs on the device itself, so changing ` +
      `it means reflashing the sensor — the app cannot adjust it remotely.`,
  };
}
