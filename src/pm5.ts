// High-level PM5 interface class.
// Wraps CSAFE protocol, BLE notifications, and workout programming
// behind a clean async API. Platform-agnostic via BleTransport.

import { SVC, CHR, PM, WORKOUT_TYPE, DUR_TYPE, CSAFE, BLE_MTU, FRAME_DELAY_MS } from './constants.js';
import { buildCsafeFrame, buildPmCfgPayload, bigEndian32, bigEndian16, bytesToHex } from './csafe.js';
import {
  parseGeneralStatus, parseAdditionalStatus, parseStrokeData, parseSplitData,
  wattsFromPace, caloriesFromWattsAndTime,
} from './parsers.js';
import type { BleTransport, PM5Data, PM5DeviceInfo, PM5EventMap } from './types.js';

type EventCallback<T> = (data: T) => void;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createInitialData(): PM5Data {
  return {
    elapsed_time: 0, distance: 0, workout_state: 0, rowing_state: 0,
    stroke_state: 0, drag_factor: 0, workout_type: 0, interval_type: 0,
    stroke_rate: 0, heart_rate: 0, current_pace: 0, average_pace: 0,
    stroke_count: 0, watts: 0, calories: 0, split_number: 0,
  };
}

export class PM5 {
  private readonly transport: BleTransport;
  private _connected = false;
  private _deviceInfo: PM5DeviceInfo | null = null;
  private _data: PM5Data = createInitialData();
  private readonly listeners: { [K in keyof PM5EventMap]?: Array<EventCallback<PM5EventMap[K]>> } = {};
  private _debugLog: ((direction: string, msg: string) => void) | null = null;

  constructor(transport: BleTransport) {
    this.transport = transport;
  }

  // ---------------------------------------------------------------------------
  // Public API — Connection
  // ---------------------------------------------------------------------------

  get connected(): boolean { return this._connected; }
  get deviceInfo(): PM5DeviceInfo | null { return this._deviceInfo; }
  get data(): Readonly<PM5Data> { return this._data; }

  /** Enable debug logging. Pass a function that receives (direction, message). */
  set debugLog(fn: ((direction: string, msg: string) => void) | null) {
    this._debugLog = fn;
  }

  /** Connect to a PM5 over BLE. */
  async connect(): Promise<PM5DeviceInfo> {
    this.log('info', 'Requesting PM5 device...');

    const deviceName = await this.transport.connect('PM5', [SVC.INFO, SVC.CONTROL, SVC.ROWING]);
    this.log('info', `Found: ${deviceName}`);

    this.transport.onDisconnect(() => this.handleDisconnect());

    // Read device info
    const info = await this.readDeviceInfo();
    this._deviceInfo = info;
    this._connected = true;

    // Subscribe to RX for debug
    try {
      await this.transport.subscribe(SVC.CONTROL, CHR.RX, (dv) => {
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this.log('rx', bytesToHex(bytes));
      });
    } catch {
      this.log('err', 'RX subscribe failed (non-critical)');
    }

    // Subscribe to rowing notifications
    await this.subscribeToNotifications();

    this.log('info', 'Connected and subscribed to notifications');
    this.emit('connected', info);
    return info;
  }

  /** Disconnect from the PM5. */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.handleDisconnect();
  }

  // ---------------------------------------------------------------------------
  // Public API — Events
  // ---------------------------------------------------------------------------

  on<K extends keyof PM5EventMap>(event: K, callback: EventCallback<PM5EventMap[K]>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = (this.listeners as any)[event] ?? [];
    list.push(callback);
    (this.listeners as Record<string, unknown[]>)[event] = list;
  }

  off<K extends keyof PM5EventMap>(event: K, callback: EventCallback<PM5EventMap[K]>): void {
    const list = this.listeners[event];
    if (!list) return;
    const idx = list.indexOf(callback as EventCallback<PM5EventMap[K]>);
    if (idx >= 0) list.splice(idx, 1);
  }

  // ---------------------------------------------------------------------------
  // Public API — Workout Programming
  // ---------------------------------------------------------------------------

  /** Program a Just Row workout (no target, free rowing). */
  async programJustRow(): Promise<void> {
    const frames = [
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.JUST_ROW_SPLITS] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_SCREENSTATE, data: [0x01, 0x01] },
        ]),
      ]),
    ];
    await this.sendFrames(frames);
    this.log('info', 'Programmed: Just Row');
  }

  /** Program a single distance workout with splits. */
  async programDistance(meters: number, splitMeters: number): Promise<void> {
    const frames = [
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_DIST_SPLITS] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(meters)] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_SPLITDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(splitMeters)] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
          { cmd: PM.SET_SCREENSTATE, data: [0x01, 0x01] },
        ]),
      ]),
    ];
    await this.sendFrames(frames);
    this.log('info', `Programmed: ${meters}m / ${splitMeters}m splits`);
  }

  /** Program a single time workout with splits. */
  async programTime(totalSeconds: number, splitSeconds: number): Promise<void> {
    const totalCs = totalSeconds * 100;
    const splitCs = splitSeconds * 100;

    const frames = [
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_TIME_SPLITS] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(totalCs)] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_SPLITDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(splitCs)] },
        ]),
      ]),
      buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
          { cmd: PM.SET_SCREENSTATE, data: [0x01, 0x01] },
        ]),
      ]),
    ];
    await this.sendFrames(frames);
    this.log('info', `Programmed: ${totalSeconds}s / ${splitSeconds}s splits`);
  }

  /** Program a fixed distance interval workout. */
  async programIntervalDistance(meters: number, restSeconds: number, count: number): Promise<void> {
    const frames: Uint8Array[] = [];

    frames.push(buildCsafeFrame([
      ...buildPmCfgPayload([
        { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_DIST_INTERVAL] },
      ]),
    ]));

    for (let i = 0; i < count; i++) {
      frames.push(buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_INTERVALCOUNT, data: [i] },
        ]),
      ]));
      frames.push(buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(meters)] },
          { cmd: PM.SET_RESTDURATION, data: [...bigEndian16(restSeconds)] },
        ]),
      ]));
    }

    frames.push(buildCsafeFrame([
      ...buildPmCfgPayload([
        { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
        { cmd: PM.SET_SCREENSTATE, data: [0x01, 0x01] },
      ]),
    ]));

    await this.sendFrames(frames);
    this.log('info', `Programmed: ${count}x${meters}m / ${restSeconds}s rest`);
  }

  /** Program a fixed time interval workout. */
  async programIntervalTime(workSeconds: number, restSeconds: number, count: number): Promise<void> {
    const workCs = workSeconds * 100;
    const frames: Uint8Array[] = [];

    frames.push(buildCsafeFrame([
      ...buildPmCfgPayload([
        { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_TIME_INTERVAL] },
      ]),
    ]));

    for (let i = 0; i < count; i++) {
      frames.push(buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_INTERVALCOUNT, data: [i] },
        ]),
      ]));
      frames.push(buildCsafeFrame([
        ...buildPmCfgPayload([
          { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(workCs)] },
          { cmd: PM.SET_RESTDURATION, data: [...bigEndian16(restSeconds)] },
        ]),
      ]));
    }

    frames.push(buildCsafeFrame([
      ...buildPmCfgPayload([
        { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
        { cmd: PM.SET_SCREENSTATE, data: [0x01, 0x01] },
      ]),
    ]));

    await this.sendFrames(frames);
    this.log('info', `Programmed: ${count}x${workSeconds}s / ${restSeconds}s rest`);
  }

  /** Send GOFINISHED to end the current workout. */
  async endWorkout(): Promise<void> {
    const frame = buildCsafeFrame([CSAFE.GOFINISHED_CMD]);
    await this.sendFrames([frame]);
    this.log('info', 'Sent GOFINISHED');
  }

  // ---------------------------------------------------------------------------
  // Private — Frame Transport
  // ---------------------------------------------------------------------------

  /** Split a CSAFE frame into BLE_MTU-sized chunks and write sequentially. */
  private async sendFrame(frame: Uint8Array): Promise<void> {
    for (let i = 0; i < frame.length; i += BLE_MTU) {
      const chunk = frame.slice(i, Math.min(i + BLE_MTU, frame.length));
      await this.transport.write(SVC.CONTROL, CHR.TX, chunk);
    }
  }

  /** Send multiple CSAFE frames with inter-frame delay. */
  private async sendFrames(frames: readonly Uint8Array[], delayMs: number = FRAME_DELAY_MS): Promise<void> {
    for (let i = 0; i < frames.length; i++) {
      this.log('tx', bytesToHex(frames[i]));
      await this.sendFrame(frames[i]);
      if (i < frames.length - 1) {
        await sleep(delayMs);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Device Info
  // ---------------------------------------------------------------------------

  private async readDeviceInfo(): Promise<PM5DeviceInfo> {
    const read = async (uuid: string): Promise<string> => {
      try {
        const dv = await this.transport.readValue(SVC.INFO, uuid);
        return new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)).trim();
      } catch {
        return '';
      }
    };

    return {
      model: await read(CHR.MODEL),
      serial: await read(CHR.SERIAL),
      firmware: await read(CHR.FW_VER),
    };
  }

  // ---------------------------------------------------------------------------
  // Private — Notification Subscriptions
  // ---------------------------------------------------------------------------

  private async subscribeToNotifications(): Promise<void> {
    // General Status
    await this.transport.subscribe(SVC.ROWING, CHR.GENERAL_STATUS, (dv) => {
      const parsed = parseGeneralStatus(dv);
      if (!parsed) return;
      this._data = {
        ...this._data,
        elapsed_time: parsed.elapsed_time,
        distance: parsed.distance,
        workout_state: parsed.workout_state,
        rowing_state: parsed.rowing_state,
        stroke_state: parsed.stroke_state,
        drag_factor: parsed.drag_factor,
        workout_type: parsed.workout_type,
        interval_type: parsed.interval_type,
      };
      this.emit('data', this._data);
    });

    // Additional Status
    await this.transport.subscribe(SVC.ROWING, CHR.ADDITIONAL_STATUS, (dv) => {
      const parsed = parseAdditionalStatus(dv);
      if (!parsed) return;
      const watts = wattsFromPace(parsed.current_pace);
      const avgPaceForCals = parsed.average_pace > 0 ? parsed.average_pace : parsed.current_pace;
      this._data = {
        ...this._data,
        stroke_rate: parsed.stroke_rate,
        heart_rate: parsed.heart_rate,
        current_pace: parsed.current_pace,
        average_pace: parsed.average_pace,
        watts,
        calories: caloriesFromWattsAndTime(wattsFromPace(avgPaceForCals), this._data.elapsed_time),
      };
      this.emit('data', this._data);
    });

    // Stroke Data
    await this.transport.subscribe(SVC.ROWING, CHR.STROKE_DATA, (dv) => {
      const parsed = parseStrokeData(dv);
      if (!parsed) return;
      this._data = { ...this._data, stroke_count: parsed.stroke_count };
      this.emit('data', this._data);
    });

    // Split/Interval Data
    await this.transport.subscribe(SVC.ROWING, CHR.SPLIT_DATA, (dv) => {
      const parsed = parseSplitData(dv);
      if (!parsed) return;
      this._data = { ...this._data, split_number: parsed.split_number };
      this.emit('data', this._data);
    });
  }

  // ---------------------------------------------------------------------------
  // Private — Events & Logging
  // ---------------------------------------------------------------------------

  private emit<K extends keyof PM5EventMap>(event: K, data: PM5EventMap[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    for (const cb of list) {
      (cb as EventCallback<PM5EventMap[K]>)(data);
    }
  }

  private handleDisconnect(): void {
    this._connected = false;
    this._deviceInfo = null;
    this._data = createInitialData();
    this.emit('disconnected', undefined as unknown as void);
    this.log('info', 'Disconnected');
  }

  private log(direction: string, msg: string): void {
    if (this._debugLog) this._debugLog(direction, msg);
  }
}
