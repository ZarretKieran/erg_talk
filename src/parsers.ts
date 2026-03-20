// BLE notification parsers for PM5 rowing data.
// All notification data is LITTLE-ENDIAN. Pure functions, no platform deps.

import type { GeneralStatus, AdditionalStatus, StrokeData, SplitData } from './types.js';

/** Read a 24-bit unsigned integer in little-endian from a DataView. */
export function readUint24LE(dv: DataView, offset: number): number {
  return dv.getUint8(offset) +
         (dv.getUint8(offset + 1) << 8) +
         (dv.getUint8(offset + 2) << 16);
}

/**
 * Parse General Status notification (ce060031), 19 bytes.
 * Returns null if buffer is too short.
 */
export function parseGeneralStatus(dv: DataView): GeneralStatus | null {
  if (dv.byteLength < 19) return null;
  return {
    elapsed_time:     readUint24LE(dv, 0) * 0.01,
    distance:         readUint24LE(dv, 3) * 0.1,
    workout_type:     dv.getUint8(6),
    interval_type:    dv.getUint8(7),
    workout_state:    dv.getUint8(8),
    rowing_state:     dv.getUint8(9),
    stroke_state:     dv.getUint8(10),
    total_work_dist:  readUint24LE(dv, 11),
    workout_duration: readUint24LE(dv, 14),
    drag_factor:      dv.getUint8(18),
  };
}

/**
 * Parse Additional Status notification (ce060032), 16 bytes.
 * Returns null if buffer is too short.
 */
export function parseAdditionalStatus(dv: DataView): AdditionalStatus | null {
  if (dv.byteLength < 16) return null;
  return {
    elapsed_time:  readUint24LE(dv, 0) * 0.01,
    speed:         dv.getUint16(3, true) * 0.001,
    stroke_rate:   dv.getUint8(5),
    heart_rate:    dv.getUint8(6),
    current_pace:  dv.getUint16(7, true) * 0.01,
    average_pace:  dv.getUint16(9, true) * 0.01,
    rest_distance: dv.getUint16(11, true),
    rest_time:     readUint24LE(dv, 13) * 0.01,
  };
}

/**
 * Parse Stroke Data notification (ce060035), 20 bytes.
 * Returns null if buffer is too short.
 */
export function parseStrokeData(dv: DataView): StrokeData | null {
  if (dv.byteLength < 20) return null;
  return {
    elapsed_time:         readUint24LE(dv, 0) * 0.01,
    distance:             readUint24LE(dv, 3) * 0.1,
    drive_length:         dv.getUint8(6) * 0.01,
    drive_time:           dv.getUint8(7) * 0.01,
    stroke_recovery_time: dv.getUint16(8, true) * 0.01,
    stroke_distance:      dv.getUint16(10, true) * 0.01,
    peak_drive_force:     dv.getUint16(12, true) * 0.1,
    avg_drive_force:      dv.getUint16(14, true) * 0.1,
    work_per_stroke:      dv.getUint16(16, true) * 0.1,
    stroke_count:         dv.getUint16(18, true),
  };
}

/**
 * Parse Split/Interval Data notification (ce060037), 18 bytes.
 * Returns null if buffer is too short.
 */
export function parseSplitData(dv: DataView): SplitData | null {
  if (dv.byteLength < 18) return null;
  return {
    elapsed_time:   readUint24LE(dv, 0) * 0.01,
    distance:       readUint24LE(dv, 3) * 0.1,
    split_time:     readUint24LE(dv, 6) * 0.1,
    split_distance: readUint24LE(dv, 9) * 0.1,
    rest_time:      dv.getUint16(12, true),
    rest_distance:  dv.getUint16(14, true),
    split_type:     dv.getUint8(16),
    split_number:   dv.getUint8(17),
  };
}

/**
 * Calculate watts from pace (seconds per 500m).
 * Formula: 2.80 / (pace_per_meter ^ 3)
 */
export function wattsFromPace(paceSeconds: number): number {
  if (paceSeconds <= 0) return 0;
  const pacePerMeter = paceSeconds / 500;
  return Math.round(2.80 / (pacePerMeter * pacePerMeter * pacePerMeter));
}

/**
 * Calculate total calories burned from average watts and elapsed seconds.
 * Uses the Concept2 approximation: cal/hr = watts * 4 + 300 (when watts >= 50).
 */
export function caloriesFromWattsAndTime(watts: number, seconds: number): number {
  if (watts <= 0 || seconds <= 0) return 0;
  const calPerHour = (watts < 50) ? 300 : (watts * 4 + 300);
  return Math.round(calPerHour * seconds / 3600);
}
