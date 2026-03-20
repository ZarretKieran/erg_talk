// erg_talk — Concept2 PM5 ergometer interface library.
// Platform-agnostic CSAFE protocol + BLE transport abstraction.

export { PM5 } from './pm5.js';
export { WebBluetoothTransport } from './adapters/web-bluetooth.js';

export type { BleTransport } from './transport.js';
export type {
  GeneralStatus,
  AdditionalStatus,
  StrokeData,
  SplitData,
  PM5Data,
  PM5DeviceInfo,
  PM5EventMap,
  PmSubCommand,
  WorkoutConfig,
  JustRowConfig,
  DistanceWorkoutConfig,
  TimeWorkoutConfig,
  IntervalDistanceConfig,
  IntervalTimeConfig,
} from './types.js';

export {
  SVC, CHR, FRAME, CSAFE, PM,
  WORKOUT_TYPE, DUR_TYPE, UNIT_METER,
  WORKOUT_STATE_LABELS, BLE_MTU, FRAME_DELAY_MS,
  svcUuid,
} from './constants.js';

export {
  xorChecksum, stuffByte, buildCsafeFrame,
  bigEndian32, bigEndian16, lowEndian16,
  buildPmCfgPayload, buildLongCommand, bytesToHex,
} from './csafe.js';

export {
  readUint24LE,
  parseGeneralStatus, parseAdditionalStatus, parseStrokeData, parseSplitData,
  wattsFromPace, caloriesFromWattsAndTime,
} from './parsers.js';
