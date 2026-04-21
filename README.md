# erg_talk

Platform-agnostic TypeScript library for interfacing with the Concept2 PM5 ergometer via Bluetooth Low Energy. Handles CSAFE framing/parsing, verified workout programming, PM data polling, race-start staging, and real-time data streaming.

**For coding agents**: See [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) for file map, quick start, and platform porting instructions.

## Install

```bash
npm install erg-talk
```

## Quick Start (Web)

```typescript
import { PM5, WebBluetoothTransport } from 'erg-talk';

const pm5 = new PM5(new WebBluetoothTransport());

// Connect to PM5
const info = await pm5.connect();

// Stream real-time data
pm5.on('data', (d) => {
  console.log(`${d.distance}m | ${d.current_pace}s/500m | ${d.stroke_rate}spm`);
});

// Program a workout
await pm5.programDistance(2000, 500);   // 2000m, 500m splits
// await pm5.programTime(1200, 240);    // 20:00, 4:00 splits
// await pm5.programJustRow();

// Stage a fixed-distance or fixed-time race start
await pm5.prepareRaceWorkout({ type: 'distance', meters: 2000, splitMeters: 500 });
await pm5.armRaceStart({ type: 'distance', meters: 2000, splitMeters: 500 });
await pm5.triggerRaceStart({ type: 'distance', meters: 2000, splitMeters: 500 });

// End workout
await pm5.endWorkout();
await pm5.disconnect();
```

## API

### PM5 Class

| Method | Description |
|--------|-------------|
| `connect()` | Connect to PM5 via BLE transport → `PM5DeviceInfo` |
| `disconnect()` | Disconnect cleanly |
| `programJustRow()` | Free rowing, no target |
| `programDistance(meters, splitMeters)` | Single distance workout |
| `programTime(totalSeconds, splitSeconds)` | Single time workout |
| `programIntervalDistance(meters, restSeconds, count)` | Distance intervals |
| `programIntervalTime(workSeconds, restSeconds, count)` | Time intervals |
| `prepareRaceWorkout(config)` | Prepare workout and PM5 race screen state for a staged start |
| `armRaceStart(config)` | Move PM5 fixed distance/time races into wait-to-start |
| `triggerRaceStart(config)` | Trigger PM5 native race start or `GOINUSE` fallback |
| `queryWorkoutState()` | Poll PM5 workout state via CSAFE response path |
| `queryScreenStateStatus()` | Poll asynchronous screen-state completion |
| `queryErrorValue()` | Read PM5 error code when verification fails |
| `resetRaceFlow()` | Clear cached prepare/arm/start state in the library |
| `endWorkout()` | End current workout |
| `on(event, callback)` | Listen: `'data'`, `'connected'`, `'disconnected'`, `'error'` |
| `connected` | Boolean connection state |
| `data` | Current `PM5Data` snapshot |
| `deviceInfo` | `PM5DeviceInfo` or null |
| `debugLog` | Set to `(dir, msg) => ...` for protocol logging |

### Real-Time Data (PM5Data)

| Field | Unit |
|-------|------|
| `elapsed_time` | seconds |
| `distance` | meters |
| `current_pace` | sec/500m |
| `average_pace` | sec/500m |
| `stroke_rate` | spm |
| `heart_rate` | bpm |
| `watts` | watts |
| `calories` | total kcal |
| `stroke_count` | count |
| `drag_factor` | raw |
| `workout_state` | enum (see WORKOUT_STATE_LABELS) |

## Platform Support

| Platform | Transport | Status |
|----------|-----------|--------|
| Chrome/Edge | `WebBluetoothTransport` | Included |
| iOS (CoreBluetooth) | Implement `BleTransport` | See Agent Guide |
| Android | Implement `BleTransport` | See Agent Guide |

The library core (`PM5`, `csafe`, `parsers`, `constants`) is pure TypeScript with zero platform dependencies. Only the transport adapter touches platform BLE APIs.

Current control-path behavior:

- CSAFE control writes are serialized so only one PM request is in flight at a time
- control responses are parsed from the PM5 RX characteristic instead of assuming writes succeeded
- workout programming now waits for PM screen-state completion and verifies workout type after setup
- fixed distance and fixed time race flows can use PM5-native race-start staging instead of a last-second blind workout program

## Documentation

| Document | Content |
|----------|---------|
| [AGENT_GUIDE.md](docs/AGENT_GUIDE.md) | How to use this library (for coding agents) |
| [CSAFE_SPEC.md](docs/CSAFE_SPEC.md) | CSAFE protocol: frames, byte stuffing, commands |
| [BLE_SPEC.md](docs/BLE_SPEC.md) | PM5 BLE services, characteristics, data formats |
| [WORKOUT_PROGRAMMING.md](docs/WORKOUT_PROGRAMMING.md) | Workout programming sequences with byte examples |

## License

MIT
