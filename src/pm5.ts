// High-level PM5 interface class.
// Wraps CSAFE protocol, BLE notifications, and workout programming
// behind a clean async API. Platform-agnostic via BleTransport.

import {
  SVC, CHR, PM, PM_GET_CFG, PM_GET_DATA, WORKOUT_TYPE, DUR_TYPE, CSAFE,
  BLE_MTU, FRAME_DELAY_MS, SCREEN_STATUS, SCREEN_TYPE, SCREEN_VALUE_RACE,
  SCREEN_VALUE_WORKOUT, RACE_OPERATION, RACE_TYPE, START_TYPE,
} from './constants.js';
import {
  buildCsafeFrame, buildLongCommand, buildPmCfgPayload, buildPmWrapperPayload,
  bigEndian32, bigEndian16, bytesToHex, parseCommandResponses, parseCsafeFrame,
} from './csafe.js';
import {
  parseGeneralStatus, parseAdditionalStatus, parseStrokeData, parseSplitData,
  wattsFromPace, caloriesFromWattsAndTime,
} from './parsers.js';
import type {
  BleTransport, CsafeCommand, CsafeCommandResponse, CsafeFrameResponse,
  PM5Data, PM5DeviceInfo, PM5EventMap, WorkoutConfig,
} from './types.js';

type EventCallback<T> = (data: T) => void;
type ResponseWaiter = {
  resolve: (response: CsafeFrameResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

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
  private _responseWaiter: ResponseWaiter | null = null;
  private _rxBuffer: number[] = [];
  private _controlChain: Promise<void> = Promise.resolve();
  private _racePreparedSignature: string | null = null;
  private _raceArmedSignature: string | null = null;
  private _raceStartedSignature: string | null = null;

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
        this.handleRxBytes(bytes);
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
    await this.resetWorkoutState();
    await this.sendPmSetCommand([
      { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.JUST_ROW_SPLITS] },
    ]);
    await this.sendPmSetCommand([
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_ROW] },
    ]);
    await this.waitForScreenIdle();
    this.log('info', 'Programmed: Just Row');
  }

  /** Program a single distance workout with splits. */
  async programDistance(meters: number, splitMeters: number): Promise<void> {
    await this.resetWorkoutState();
    await this.sendPublicLongCommand(CSAFE.SETPROGRAM_CMD, [0x00, 0x00]);
    await this.sendPmSetCommand([
      { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_DIST_SPLITS] },
      { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(meters)] },
      { cmd: PM.SET_SPLITDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(splitMeters)] },
      { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_ROW] },
    ]);
    await this.waitForScreenIdle();
    await this.verifyWorkoutType(WORKOUT_TYPE.FIXED_DIST_SPLITS);
    this.log('info', `Programmed: ${meters}m / ${splitMeters}m splits`);
  }

  /** Program a single time workout with splits. */
  async programTime(totalSeconds: number, splitSeconds: number): Promise<void> {
    const totalCs = totalSeconds * 100;
    const splitCs = splitSeconds * 100;

    await this.resetWorkoutState();
    await this.sendPublicLongCommand(CSAFE.SETPROGRAM_CMD, [0x00, 0x00]);
    await this.sendPmSetCommand([
      { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_TIME_SPLITS] },
      { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(totalCs)] },
      { cmd: PM.SET_SPLITDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(splitCs)] },
      { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_ROW] },
    ]);
    await this.waitForScreenIdle();
    await this.verifyWorkoutType(WORKOUT_TYPE.FIXED_TIME_SPLITS);
    this.log('info', `Programmed: ${totalSeconds}s / ${splitSeconds}s splits`);
  }

  /** Program a fixed distance interval workout. */
  async programIntervalDistance(meters: number, restSeconds: number, count: number): Promise<void> {
    await this.resetWorkoutState();
    await this.sendPublicLongCommand(CSAFE.SETPROGRAM_CMD, [0x00, 0x00]);
    await this.sendPmSetCommand([
      { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_DIST_INTERVAL] },
    ]);

    for (let i = 0; i < count; i++) {
      await this.sendPmSetCommand([
        { cmd: PM.SET_INTERVALCOUNT, data: [i] },
        { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.DISTANCE, ...bigEndian32(meters)] },
        { cmd: PM.SET_RESTDURATION, data: [...bigEndian16(restSeconds)] },
      ]);
    }

    await this.sendPmSetCommand([
      { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_ROW] },
    ]);
    await this.waitForScreenIdle();
    await this.verifyWorkoutType(WORKOUT_TYPE.FIXED_DIST_INTERVAL);
    this.log('info', `Programmed: ${count}x${meters}m / ${restSeconds}s rest`);
  }

  /** Program a fixed time interval workout. */
  async programIntervalTime(workSeconds: number, restSeconds: number, count: number): Promise<void> {
    const workCs = workSeconds * 100;
    await this.resetWorkoutState();
    await this.sendPublicLongCommand(CSAFE.SETPROGRAM_CMD, [0x00, 0x00]);
    await this.sendPmSetCommand([
      { cmd: PM.SET_WORKOUTTYPE, data: [WORKOUT_TYPE.FIXED_TIME_INTERVAL] },
    ]);

    for (let i = 0; i < count; i++) {
      await this.sendPmSetCommand([
        { cmd: PM.SET_INTERVALCOUNT, data: [i] },
        { cmd: PM.SET_WORKOUTDURATION, data: [DUR_TYPE.TIME, ...bigEndian32(workCs)] },
        { cmd: PM.SET_RESTDURATION, data: [...bigEndian16(restSeconds)] },
      ]);
    }

    await this.sendPmSetCommand([
      { cmd: PM.CONFIGURE_WORKOUT, data: [0x01] },
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_ROW] },
    ]);
    await this.waitForScreenIdle();
    await this.verifyWorkoutType(WORKOUT_TYPE.FIXED_TIME_INTERVAL);
    this.log('info', `Programmed: ${count}x${workSeconds}s / ${restSeconds}s rest`);
  }

  /** Send GOFINISHED to end the current workout. */
  async endWorkout(): Promise<void> {
    await this.sendShortCommand(CSAFE.GOFINISHED_CMD);
    this.log('info', 'Sent GOFINISHED');
  }

  async queryWorkoutState(): Promise<number> {
    return this.readUint8(await this.queryPmData(PM_GET_DATA.WORKOUT_STATE));
  }

  async queryStrokeState(): Promise<number> {
    return this.readUint8(await this.queryPmData(PM_GET_DATA.STROKE_STATE));
  }

  async queryStrokeRate(): Promise<number> {
    return this.readUint8(await this.queryPmData(PM_GET_DATA.STROKE_RATE));
  }

  async queryDragFactor(): Promise<number> {
    return this.readUint8(await this.queryPmData(PM_GET_DATA.DRAG_FACTOR));
  }

  async queryPace500m(): Promise<number> {
    return this.readUint32(await this.queryPmData(PM_GET_DATA.STROKE_PACE_500M));
  }

  async queryAveragePace500m(): Promise<number> {
    return this.readUint32(await this.queryPmData(PM_GET_DATA.AVG_PACE_500M));
  }

  async queryScreenStateStatus(): Promise<number> {
    return this.readUint8(await this.queryPmConfig(PM_GET_CFG.SCREEN_STATE_STATUS));
  }

  async queryErrorValue(): Promise<number> {
    return this.readUint16(await this.queryPmData(PM_GET_DATA.ERROR_VALUE));
  }

  async prepareRaceWorkout(config: WorkoutConfig): Promise<void> {
    const signature = JSON.stringify(config);
    if (this._racePreparedSignature === signature) return;

    switch (config.type) {
      case 'just_row':
        await this.programJustRow();
        break;
      case 'distance':
        await this.programDistance(config.meters, config.splitMeters);
        await this.sendRaceSetup(config);
        break;
      case 'time':
        await this.programTime(config.totalSeconds, config.splitSeconds);
        await this.sendRaceSetup(config);
        break;
      case 'interval_distance':
        await this.programIntervalDistance(config.meters, config.restSeconds, config.count);
        break;
      case 'interval_time':
        await this.programIntervalTime(config.workSeconds, config.restSeconds, config.count);
        break;
    }

    this._racePreparedSignature = signature;
    this._raceArmedSignature = null;
    this._raceStartedSignature = null;
  }

  async armRaceStart(config: WorkoutConfig): Promise<void> {
    const signature = JSON.stringify(config);
    if (this._raceArmedSignature === signature) return;

    if (config.type === 'distance' || config.type === 'time') {
      await this.sendPmSetCommand([
        { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.RACE, SCREEN_VALUE_RACE.PREPARE_TO_RACE] },
      ]);
      await this.waitForScreenIdle();
      await this.sendPmSetCommand([
        { cmd: PM.SET_RACEOPERATIONTYPE, data: [RACE_OPERATION.RACE_WAIT_TO_START] },
      ]);
    }

    this._raceArmedSignature = signature;
  }

  async triggerRaceStart(config: WorkoutConfig): Promise<void> {
    const signature = JSON.stringify(config);
    if (this._raceStartedSignature === signature) return;

    if (config.type === 'distance' || config.type === 'time') {
      await this.sendPmSetCommand([
        { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.WORKOUT, SCREEN_VALUE_WORKOUT.PREPARE_TO_RACE_START] },
      ]);
      await this.waitForScreenIdle();
      await this.sendPmSetCommand([
        { cmd: PM.SET_RACEOPERATIONTYPE, data: [RACE_OPERATION.START] },
      ]);
    } else {
      await this.sendShortCommand(CSAFE.GOINUSE_CMD);
    }

    this._raceStartedSignature = signature;
  }

  resetRaceFlow(): void {
    this._racePreparedSignature = null;
    this._raceArmedSignature = null;
    this._raceStartedSignature = null;
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
      await this.performControlOperation(async () => {
        await this.writeFrameAndMaybeAwait(frames[i], false);
      });
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
    this.resetRaceFlow();
    if (this._responseWaiter) {
      clearTimeout(this._responseWaiter.timeoutId);
      this._responseWaiter.reject(new Error('Disconnected while waiting for PM5 response'));
      this._responseWaiter = null;
    }
    this._rxBuffer = [];
    this.emit('disconnected', undefined as unknown as void);
    this.log('info', 'Disconnected');
  }

  private log(direction: string, msg: string): void {
    if (this._debugLog) this._debugLog(direction, msg);
  }

  private handleRxBytes(bytes: Uint8Array): void {
    this._rxBuffer.push(...bytes);

    while (true) {
      const start = this._rxBuffer.indexOf(0xF1);
      if (start < 0) {
        this._rxBuffer = [];
        return;
      }
      if (start > 0) this._rxBuffer = this._rxBuffer.slice(start);

      const end = this._rxBuffer.indexOf(0xF2, 1);
      if (end < 0) return;

      const frame = Uint8Array.from(this._rxBuffer.slice(0, end + 1));
      this._rxBuffer = this._rxBuffer.slice(end + 1);

      try {
        const parsed = parseCsafeFrame(frame);
        this.resolveResponse(parsed);
      } catch (error) {
        this.log('err', error instanceof Error ? error.message : String(error));
      }
    }
  }

  private resolveResponse(response: CsafeFrameResponse): void {
    if (!this._responseWaiter) return;
    clearTimeout(this._responseWaiter.timeoutId);
    const waiter = this._responseWaiter;
    this._responseWaiter = null;
    waiter.resolve(response);
  }

  private async performControlOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this._controlChain;
    let release!: () => void;
    this._controlChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async writeFrameAndMaybeAwait(frame: Uint8Array, expectResponse: boolean): Promise<CsafeFrameResponse | null> {
    const responsePromise = expectResponse ? this.awaitResponse() : null;
    await this.sendFrame(frame);
    if (!expectResponse) return null;
    return responsePromise;
  }

  private awaitResponse(timeoutMs: number = 1000): Promise<CsafeFrameResponse> {
    if (this._responseWaiter) throw new Error('Only one PM5 control request may be in flight');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._responseWaiter = null;
        reject(new Error('Timed out waiting for PM5 response'));
      }, timeoutMs);

      this._responseWaiter = { resolve, reject, timeoutId };
    });
  }

  private async sendShortCommand(command: number): Promise<void> {
    const frame = buildCsafeFrame([command]);
    await this.performControlOperation(async () => {
      await this.writeFrameAndMaybeAwait(frame, true);
      await sleep(FRAME_DELAY_MS);
    });
  }

  private async sendPublicLongCommand(command: number, data: readonly number[]): Promise<void> {
    const frame = buildCsafeFrame(buildLongCommand(command, data));
    await this.performControlOperation(async () => {
      await this.writeFrameAndMaybeAwait(frame, true);
      await sleep(FRAME_DELAY_MS);
    });
  }

  private async sendPmSetCommand(commands: readonly CsafeCommand[]): Promise<void> {
    const frame = buildCsafeFrame(buildPmWrapperPayload(CSAFE.SETPMCFG_CMD, commands));
    await this.performControlOperation(async () => {
      await this.writeFrameAndMaybeAwait(frame, true);
      await sleep(FRAME_DELAY_MS);
    });
  }

  private async queryPmConfig(command: number): Promise<Uint8Array> {
    return this.queryPmWrapper(CSAFE.GETPMCFG_CMD, command);
  }

  private async queryPmData(command: number): Promise<Uint8Array> {
    return this.queryPmWrapper(CSAFE.GETPMDATA_CMD, command);
  }

  private async queryPmWrapper(wrapper: number, command: number): Promise<Uint8Array> {
    const frame = buildCsafeFrame(buildPmWrapperPayload(wrapper, [{ cmd: command }]));

    const response = await this.performControlOperation(async () => {
      const parsed = await this.writeFrameAndMaybeAwait(frame, true);
      await sleep(FRAME_DELAY_MS);
      if (!parsed) throw new Error('PM5 returned no response');
      return parsed;
    });

    const outer = response.responses.find((entry) => entry.command === wrapper);
    if (!outer) throw new Error(`Missing PM5 wrapper response 0x${wrapper.toString(16)}`);

    const inner = parseCommandResponses(outer.data);
    const payload = inner.find((entry) => entry.command === command);
    if (!payload) throw new Error(`Missing PM5 command response 0x${command.toString(16)}`);
    return payload.data;
  }

  private async waitForScreenIdle(timeoutMs: number = 1500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.queryScreenStateStatus();
      if (status === SCREEN_STATUS.INACTIVE) return;
      await sleep(100);
    }
    throw new Error('PM5 screen state did not settle');
  }

  private async verifyWorkoutType(expected: number): Promise<void> {
    const deadline = Date.now() + 1500;

    while (Date.now() < deadline) {
      if (this._data.workout_type === expected) return;
      const workoutType = this.readUint8(await this.queryPmData(PM_GET_DATA.WORKOUT_TYPE));
      if (workoutType === expected) return;
      await sleep(100);
    }

    const errorValue = await this.queryErrorValue().catch(() => 0);
    throw new Error(`PM5 workout verification failed (expected ${expected}, error ${errorValue})`);
  }

  private async resetWorkoutState(): Promise<void> {
    const workoutState = await this.queryWorkoutState().catch(() => this._data.workout_state);
    if (workoutState !== 0 && workoutState !== 5) {
      await this.endWorkout();
      await this.sendShortCommand(CSAFE.GOREADY_CMD);
    } else {
      await this.sendShortCommand(CSAFE.GOREADY_CMD);
    }
  }

  private async sendRaceSetup(config: WorkoutConfig): Promise<void> {
    const raceType = config.type === 'distance' ? RACE_TYPE.FIXED_DISTANCE_SINGLE : RACE_TYPE.FIXED_TIME_SINGLE;
    const readyTick = 0;
    const attentionTick = 2 * 128;
    const rowTick = 4 * 128;

    await this.sendPmSetCommand([
      { cmd: PM.SET_RACETYPE, data: [raceType] },
      {
        cmd: PM.SET_RACESTARTPARAMS,
        data: [
          START_TYPE.COUNTDOWN,
          3,
          ...bigEndian32(readyTick),
          ...bigEndian32(attentionTick),
          ...bigEndian32(rowTick),
        ],
      },
      { cmd: PM.SET_SCREENSTATE, data: [SCREEN_TYPE.RACE, SCREEN_VALUE_RACE.WARMUP_FOR_RACE] },
      { cmd: PM.SET_RACEOPERATIONTYPE, data: [RACE_OPERATION.RACE_INIT] },
    ]);
    await this.waitForScreenIdle();
  }

  private readUint8(data: Uint8Array): number {
    return data[0] ?? 0;
  }

  private readUint16(data: Uint8Array): number {
    return ((data[0] ?? 0) << 8) | (data[1] ?? 0);
  }

  private readUint32(data: Uint8Array): number {
    return ((data[0] ?? 0) * 0x1000000)
      + ((data[1] ?? 0) << 16)
      + ((data[2] ?? 0) << 8)
      + (data[3] ?? 0);
  }

}
