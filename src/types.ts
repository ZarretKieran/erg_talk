// TypeScript interfaces for erg_talk library.
// Platform-agnostic types — no browser or OS APIs referenced.

// ---------------------------------------------------------------------------
// BLE Transport Abstraction
// ---------------------------------------------------------------------------

/**
 * Abstract BLE transport interface. Implement this for each platform:
 * - Web: WebBluetoothTransport (included)
 * - iOS: CoreBluetooth adapter
 * - Android: Android BLE adapter
 *
 * All UUIDs are lowercase strings in standard format:
 *   "ce060020-43e5-11e4-916c-0800200c9a66"
 */
export interface BleTransport {
  /**
   * Scan for and connect to a PM5 device.
   * @param namePrefix - Device name prefix to filter (e.g. "PM5")
   * @param serviceUuids - Service UUIDs to request access to
   * @returns Device name or identifier
   */
  connect(namePrefix: string, serviceUuids: readonly string[]): Promise<string>;

  /** Disconnect from the current device. */
  disconnect(): Promise<void>;

  /**
   * Write data to a BLE characteristic.
   * @param serviceUuid - GATT service UUID
   * @param charUuid - GATT characteristic UUID
   * @param data - Raw bytes to write
   */
  write(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>;

  /**
   * Subscribe to notifications from a BLE characteristic.
   * @param serviceUuid - GATT service UUID
   * @param charUuid - GATT characteristic UUID
   * @param callback - Called with raw bytes on each notification
   */
  subscribe(
    serviceUuid: string,
    charUuid: string,
    callback: (data: DataView) => void,
  ): Promise<void>;

  /**
   * Read a characteristic value once.
   * @param serviceUuid - GATT service UUID
   * @param charUuid - GATT characteristic UUID
   * @returns Raw bytes
   */
  readValue(serviceUuid: string, charUuid: string): Promise<DataView>;

  /**
   * Register a callback for when the device disconnects unexpectedly.
   */
  onDisconnect(callback: () => void): void;
}

// ---------------------------------------------------------------------------
// Parsed Notification Data
// ---------------------------------------------------------------------------

/** Parsed from General Status characteristic (ce060031), 19 bytes */
export interface GeneralStatus {
  readonly elapsed_time: number;    // seconds
  readonly distance: number;        // meters
  readonly workout_type: number;    // enum, see WORKOUT_TYPE
  readonly interval_type: number;
  readonly workout_state: number;   // enum, see WORKOUT_STATE_LABELS
  readonly rowing_state: number;    // 0=inactive, 1=active
  readonly stroke_state: number;
  readonly total_work_dist: number;
  readonly workout_duration: number;
  readonly drag_factor: number;
}

/** Parsed from Additional Status characteristic (ce060032), 16 bytes */
export interface AdditionalStatus {
  readonly elapsed_time: number;  // seconds
  readonly speed: number;         // m/s
  readonly stroke_rate: number;   // strokes per minute
  readonly heart_rate: number;    // bpm
  readonly current_pace: number;  // seconds per 500m
  readonly average_pace: number;  // seconds per 500m
  readonly rest_distance: number; // meters
  readonly rest_time: number;     // seconds
}

/** Parsed from Stroke Data characteristic (ce060035), 20 bytes */
export interface StrokeData {
  readonly elapsed_time: number;         // seconds
  readonly distance: number;             // meters
  readonly drive_length: number;         // meters
  readonly drive_time: number;           // seconds
  readonly stroke_recovery_time: number; // seconds
  readonly stroke_distance: number;      // meters
  readonly peak_drive_force: number;     // newtons
  readonly avg_drive_force: number;      // newtons
  readonly work_per_stroke: number;      // joules
  readonly stroke_count: number;
}

/** Parsed from Split/Interval Data characteristic (ce060037), 18 bytes */
export interface SplitData {
  readonly elapsed_time: number;   // seconds
  readonly distance: number;       // meters
  readonly split_time: number;     // seconds
  readonly split_distance: number; // meters
  readonly rest_time: number;      // seconds
  readonly rest_distance: number;  // meters
  readonly split_type: number;
  readonly split_number: number;
}

/** Aggregate live data state — updated continuously from all notification channels */
export interface PM5Data {
  elapsed_time: number;
  distance: number;
  workout_state: number;
  rowing_state: number;
  stroke_state: number;
  drag_factor: number;
  workout_type: number;
  interval_type: number;
  stroke_rate: number;
  heart_rate: number;
  current_pace: number;
  average_pace: number;
  stroke_count: number;
  watts: number;
  calories: number;
  split_number: number;
}

/** Device identification info read from Info service */
export interface PM5DeviceInfo {
  readonly model: string;
  readonly serial: string;
  readonly firmware: string;
}

// ---------------------------------------------------------------------------
// Workout Configuration
// ---------------------------------------------------------------------------

export interface JustRowConfig {
  readonly type: 'just_row';
}

export interface DistanceWorkoutConfig {
  readonly type: 'distance';
  readonly meters: number;
  readonly splitMeters: number;
}

export interface TimeWorkoutConfig {
  readonly type: 'time';
  readonly totalSeconds: number;
  readonly splitSeconds: number;
}

export interface IntervalDistanceConfig {
  readonly type: 'interval_distance';
  readonly meters: number;
  readonly restSeconds: number;
  readonly count: number;
}

export interface IntervalTimeConfig {
  readonly type: 'interval_time';
  readonly workSeconds: number;
  readonly restSeconds: number;
  readonly count: number;
}

export type WorkoutConfig =
  | JustRowConfig
  | DistanceWorkoutConfig
  | TimeWorkoutConfig
  | IntervalDistanceConfig
  | IntervalTimeConfig;

// ---------------------------------------------------------------------------
// Event System
// ---------------------------------------------------------------------------

export interface PM5EventMap {
  data: PM5Data;
  connected: PM5DeviceInfo;
  disconnected: void;
  error: Error;
}

/** CSAFE sub-command descriptor for building proprietary (0x76) payloads */
export interface PmSubCommand {
  readonly cmd: number;
  readonly data: readonly number[];
}

export interface CsafeCommand {
  readonly cmd: number;
  readonly data?: readonly number[];
}

export interface CsafeCommandResponse {
  readonly command: number;
  readonly data: Uint8Array;
}

export interface CsafeFrameStatus {
  readonly raw: number;
  readonly previousFrameStatus: number;
  readonly stateMachineState: number;
}

export interface CsafeFrameResponse {
  readonly status: CsafeFrameStatus;
  readonly responses: readonly CsafeCommandResponse[];
}
