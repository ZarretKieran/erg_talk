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
  SETUSERCFG1_CMD:   0x1A,
  SETPMCFG_CMD:      0x76,
  SETPMDATA_CMD:     0x77,
  GETPMCFG_CMD:      0x7E,
  GETPMDATA_CMD:     0x7F,
  GOINUSE_CMD:       0x85,
  GOFINISHED_CMD:    0x86,
  GOREADY_CMD:       0x87,
} as const;

/** PM5 proprietary sub-command codes (used inside SETPMCFG_CMD 0x76 wrapper) */
export const PM = {
  SET_WORKOUTTYPE:     0x01,
  SET_RACETYPE:        0x09,
  SET_RACESTARTPARAMS: 0x0D,
  SET_WORKOUTDURATION: 0x03,
  SET_RESTDURATION:    0x04,
  SET_SPLITDURATION:   0x05,
  SET_SCREENSTATE:     0x13,
  CONFIGURE_WORKOUT:   0x14,
  SET_INTERVALTYPE:    0x17,
  SET_INTERVALCOUNT:   0x18,
  SET_RACEOPERATIONTYPE: 0x1E,
} as const;

export const PM_GET_CFG = {
  SCREEN_STATE_STATUS: 0x85,
} as const;

export const PM_GET_DATA = {
  WORKOUT_TYPE:     0x89,
  WORKOUT_STATE:    0x8D,
  STROKE_PACE_500M: 0xA8,
  AVG_PACE_500M:    0xAF,
  STROKE_RATE:      0xB3,
  STROKE_STATE:     0xBF,
  DRAG_FACTOR:      0xC1,
  ERROR_VALUE:      0xC9,
  RACE_DATA:        0xC6,
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

export const SCREEN_TYPE = {
  NONE: 0,
  WORKOUT: 1,
  RACE: 2,
  CSAFE: 3,
} as const;

export const SCREEN_VALUE_WORKOUT = {
  NONE: 0,
  PREPARE_TO_ROW: 1,
  TERMINATE_WORKOUT: 2,
  REARM_WORKOUT: 3,
  PREPARE_TO_RACE_START: 5,
  GO_TO_MAIN_SCREEN: 6,
} as const;

export const SCREEN_VALUE_RACE = {
  NONE: 0,
  WARMUP_FOR_RACE: 3,
  PREPARE_TO_RACE: 4,
  FALSE_START_RACE: 5,
  TERMINATE_RACE: 6,
  SET_PARTICIPANT_LIST: 8,
  SYNC_RACE_TIME: 9,
  RACE_IDLE: 13,
} as const;

export const START_TYPE = {
  RANDOM: 0,
  COUNTDOWN: 1,
  RANDOM_MODIFIED: 2,
  IMMEDIATE: 3,
  WAIT_FOR_FLYWHEEL: 4,
} as const;

export const RACE_TYPE = {
  FIXED_DISTANCE_SINGLE: 0,
  FIXED_TIME_SINGLE: 1,
  WORKOUT_RACE_START: 4,
  FIXED_CAL_SINGLE: 5,
} as const;

export const RACE_OPERATION = {
  DISABLE: 0,
  PARTICIPATION_REQUEST: 1,
  SLEEP: 2,
  ERG_INIT: 3,
  PHY_ADDR_INIT: 4,
  RACE_WARMUP: 5,
  RACE_INIT: 6,
  TIME_SYNC: 7,
  RACE_WAIT_TO_START: 8,
  START: 9,
  FALSE_START: 10,
  TERMINATE: 11,
  IDLE: 12,
} as const;

export const SCREEN_STATUS = {
  INACTIVE: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
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
