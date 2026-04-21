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
  CsafeCommand,
  CsafeCommandResponse,
  CsafeFrameStatus,
  CsafeFrameResponse,
  WorkoutConfig,
  JustRowConfig,
  DistanceWorkoutConfig,
  TimeWorkoutConfig,
  IntervalDistanceConfig,
  IntervalTimeConfig,
} from './types.js';

export {
  SVC, CHR, FRAME, CSAFE, PM, PM_GET_CFG, PM_GET_DATA,
  WORKOUT_TYPE, DUR_TYPE, UNIT_METER,
  WORKOUT_STATE_LABELS, BLE_MTU, FRAME_DELAY_MS, SCREEN_TYPE,
  SCREEN_VALUE_WORKOUT, SCREEN_VALUE_RACE, RACE_TYPE, START_TYPE,
  RACE_OPERATION, SCREEN_STATUS,
  svcUuid,
} from './constants.js';

export {
  xorChecksum, stuffByte, buildCsafeFrame,
  bigEndian32, bigEndian16, lowEndian16,
  buildPmCfgPayload, buildPmWrapperPayload, buildLongCommand,
  bytesToHex, unstuffBytes, parseCommandResponses, parseCsafeFrame,
} from './csafe.js';

export {
  readUint24LE,
  parseGeneralStatus, parseAdditionalStatus, parseStrokeData, parseSplitData,
  wattsFromPace, caloriesFromWattsAndTime,
} from './parsers.js';
