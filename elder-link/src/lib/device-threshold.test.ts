// The app and the hardware must not disagree about the threshold.
//
// This is a small module, but the thing it prevents is not small: for a while
// the code said 120 s while the door firmware alarmed at 15 s, so anyone reading
// the source would have believed a door could stand open two minutes before a
// call. These tests pin the declaration and, more importantly, pin the fact that
// the app does NOT own the number — so a future change that quietly reintroduces
// an app-side threshold has to delete a test that says why not.

import { describe, expect, it } from "vitest";
import {
  DEVICE_FIRMWARE_LABEL,
  DEVICE_THRESHOLD_SECONDS,
  describeThreshold,
} from "./device-threshold";

describe("device threshold", () => {
  it("declares the value flashed on the door firmware", () => {
    // 15s matches the firmware's own status text: "ALERT: Door Open > 15s!".
    expect(DEVICE_THRESHOLD_SECONDS).toBe(15);
  });

  it("attributes the threshold to the device, not to the app", () => {
    const d = describeThreshold();
    expect(d.source).toBe("device_firmware");
    expect(d.seconds).toBe(DEVICE_THRESHOLD_SECONDS);
  });

  it("reports that the app cannot change the threshold", () => {
    // If this ever flips to true, the device must have grown a config endpoint
    // and this whole module needs revisiting rather than a one-line edit.
    expect(describeThreshold().configurableFromApp).toBe(false);
  });

  it("names the firmware the value describes", () => {
    expect(describeThreshold().firmware).toBe(DEVICE_FIRMWARE_LABEL);
  });

  it("explains itself in terms a caregiver could understand", () => {
    const { explanation, seconds } = describeThreshold();
    // The number must appear in the prose, so no surface can show one without
    // the other and let them drift apart.
    expect(explanation).toContain(String(seconds));
    expect(explanation).toMatch(/reflash/i);
    expect(explanation.length).toBeGreaterThan(40);
  });
});
