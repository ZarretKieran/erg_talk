// PM5 BLE UUIDs, CSAFE command codes, and protocol constants.
// Extracted from proven working index.html prototype.

export const UUID_BASE = '-43e5-11e4-916c-0800200c9a66';

export function svcUuid(id: string): string {
  return `ce06${id}${UUID_BASE}`;
}

/** BLE GATT Service UUIDs */
export const SVC = {
  INFO:    svcUuid('0010'),
  CONTROL: svcUuid('0020'),
  ROWING:  svcUuid('0030'),
} as const;

/** BLE GATT Characteristic UUIDs */
export const CHR = {
  MODEL:             svcUuid('0011'),
  SERIAL:            svcUuid('0012'),
  HW_REV:            svcUuid('0013'),
  FW_VER:            svcUuid('0014'),
  MFG_NAME:          svcUuid('0015'),
  TX:                svcUuid('0021'),
  RX:                svcUuid('0022'),
  GENERAL_STATUS:    svcUuid('0031'),
  ADDITIONAL_STATUS: svcUuid('0032'),
  STROKE_DATA:       svcUuid('0035'),
  SPLIT_DATA:        svcUuid('0037'),
} as const;

/** CSAFE frame delimiters */
export const FRAME = {
  START: 0xF1,
  END:   0xF2,
  STUFF: 0xF3,
} as const;

/** Standard CSAFE command codes */
export const CSAFE = {
  SETTWORK_CMD:      0x20,
  SETHORIZONTAL_CMD: 0x21,
  SETPROGRAM_CMD:    0x24,
  SETPMCFG_CMD:      0x76,
  GOINUSE_CMD:       0x85,
  GOFINISHED_CMD:    0x86,
  GOREADY_CMD:       0x87,
} as const;

/** PM5 proprietary sub-command codes (used inside SETPMCFG_CMD 0x76 wrapper) */
export const PM = {
  SET_WORKOUTTYPE:     0x01,
  SET_WORKOUTDURATION: 0x03,
  SET_RESTDURATION:    0x04,
  SET_SPLITDURATION:   0x05,
  SET_SCREENSTATE:     0x13,
  CONFIGURE_WORKOUT:   0x14,
  SET_INTERVALTYPE:    0x17,
  SET_INTERVALCOUNT:   0x18,
} as const;

/** Workout type values for PM.SET_WORKOUTTYPE */
export const WORKOUT_TYPE = {
  JUST_ROW_NO_SPLITS:  0,
  JUST_ROW_SPLITS:     1,
  FIXED_DIST_NO_SPLIT: 2,
  FIXED_DIST_SPLITS:   3,
  FIXED_TIME_NO_SPLIT: 4,
  FIXED_TIME_SPLITS:   5,
  FIXED_TIME_INTERVAL: 6,
  FIXED_DIST_INTERVAL: 7,
} as const;

/** Duration type byte: first byte of SET_WORKOUTDURATION / SET_SPLITDURATION data */
export const DUR_TYPE = {
  TIME:     0x00,
  DISTANCE: 0x80,
} as const;

/** CSAFE unit code for meters */
export const UNIT_METER = 0x24;

/** Human-readable labels for workout_state values from General Status notifications */
export const WORKOUT_STATE_LABELS: Record<number, string> = {
  0: 'Waiting',
  1: 'Rowing',
  2: 'Countdown',
  3: 'Rest',
  4: 'Work Interval',
  5: 'Finished',
  7: 'Manual Row',
};

/** BLE MTU for PM5 — maximum bytes per single BLE write */
export const BLE_MTU = 20;

/** Recommended inter-frame delay in milliseconds (spec minimum is 50ms) */
export const FRAME_DELAY_MS = 100;
