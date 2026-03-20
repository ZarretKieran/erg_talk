# Agent Guide — Using erg_talk

Instructions for coding agents (Claude Code, Cursor, etc.) working with the erg_talk PM5 interface library.

## File Map

| File | Purpose | When to read |
|------|---------|--------------|
| `src/types.ts` | All TypeScript interfaces | Always read first — defines every type |
| `src/constants.ts` | UUIDs, command codes, enums | When you need protocol constants |
| `src/csafe.ts` | Frame builder functions | When building custom CSAFE commands |
| `src/parsers.ts` | BLE notification parsers | When parsing raw PM5 data |
| `src/transport.ts` | BLE transport interface re-export | When implementing a new platform adapter |
| `src/pm5.ts` | High-level PM5 class | When using the library in an app |
| `src/adapters/web-bluetooth.ts` | Web Bluetooth adapter | Reference for building other adapters |
| `docs/CSAFE_SPEC.md` | CSAFE protocol details | When debugging protocol issues |
| `docs/BLE_SPEC.md` | BLE service/characteristic layout | When working with raw BLE |
| `docs/WORKOUT_PROGRAMMING.md` | Workout programming sequences | When adding new workout types |

## Quick Start: Connect and Program a Workout

```typescript
import { PM5, WebBluetoothTransport } from 'erg-talk';

const transport = new WebBluetoothTransport();
const pm5 = new PM5(transport);

// Optional: enable debug logging
pm5.debugLog = (dir, msg) => console.log(`[${dir}] ${msg}`);

// Connect
const info = await pm5.connect();
console.log(`Connected: ${info.model} (${info.serial})`);

// Listen for real-time data
pm5.on('data', (data) => {
  console.log(`${data.distance}m | ${data.current_pace}s/500m | ${data.stroke_rate}spm`);
});

// Program a 2000m workout
await pm5.programDistance(2000, 500);

// Later: end workout
await pm5.endWorkout();
await pm5.disconnect();
```

## Building a New Platform Adapter

To port erg_talk to a new platform (iOS, Android, desktop, etc.):

### Step 1: Read the BleTransport interface

Open `src/types.ts` and find the `BleTransport` interface. You must implement these 6 methods:

| Method | Purpose |
|--------|---------|
| `connect(namePrefix, serviceUuids)` | Scan and connect to PM5 |
| `disconnect()` | Disconnect from device |
| `write(serviceUuid, charUuid, data)` | Write bytes to a characteristic |
| `subscribe(serviceUuid, charUuid, callback)` | Subscribe to notifications |
| `readValue(serviceUuid, charUuid)` | Read a characteristic value once |
| `onDisconnect(callback)` | Register disconnect handler |

### Step 2: Use web-bluetooth.ts as reference

Open `src/adapters/web-bluetooth.ts`. This is a complete, working implementation. Map each Web Bluetooth API call to your platform's equivalent:

| Web Bluetooth | iOS CoreBluetooth | Android BLE |
|---------------|-------------------|-------------|
| `navigator.bluetooth.requestDevice()` | `CBCentralManager.scanForPeripherals()` | `BluetoothAdapter.startLeScan()` |
| `device.gatt.connect()` | `centralManager.connect(peripheral)` | `device.connectGatt()` |
| `server.getPrimaryService(uuid)` | `peripheral.discoverServices([uuid])` | `gatt.discoverServices()` |
| `service.getCharacteristic(uuid)` | `peripheral.discoverCharacteristics([uuid])` | `service.getCharacteristic(uuid)` |
| `char.writeValue(data)` | `peripheral.writeValue(data, for: char)` | `gatt.writeCharacteristic(char)` |
| `char.startNotifications()` | `peripheral.setNotifyValue(true, for: char)` | `gatt.setCharacteristicNotification(char, true)` |
| `char.readValue()` | `peripheral.readValue(for: char)` | `gatt.readCharacteristic(char)` |

### Step 3: Use PM5 class directly

Once your transport adapter is implemented, the PM5 class works identically:

```swift
// iOS pseudocode
let transport = CoreBluetoothTransport()
let pm5 = PM5(transport: transport)
let info = try await pm5.connect()
try await pm5.programDistance(meters: 2000, splitMeters: 500)
```

## Key Gotchas for Agents

1. **Byte order matters**: Commands TO the PM5 use BIG-ENDIAN. Data FROM the PM5 (notifications) uses LITTLE-ENDIAN. See `bigEndian32()` in csafe.ts vs `getUint16(offset, true)` in parsers.ts.

2. **BLE MTU is 20 bytes**: Any CSAFE frame larger than 20 bytes must be split into chunks. The PM5 class handles this automatically via `sendFrame()`.

3. **Inter-frame delay**: Wait 100ms between sending separate CSAFE frames. The PM5 class handles this automatically via `sendFrames()`.

4. **Time values are centiseconds**: When programming time-based workouts, multiply seconds by 100. Rest durations are in plain seconds (not centiseconds).

5. **DataView callback**: The `subscribe()` callback receives a `DataView`. On iOS (CoreBluetooth), you'll receive `Data` — convert it to a format compatible with the parser functions.

6. **No CSAFE response parsing needed**: For workout programming and data streaming, you never need to parse CSAFE responses. The RX subscription is only for debug logging.

## Adding a New Workout Type

1. Check if the workout type exists in `WORKOUT_TYPE` constants (`src/constants.ts`)
2. Look at the programming pattern in `docs/WORKOUT_PROGRAMMING.md`
3. Add a new method to the `PM5` class in `src/pm5.ts` following the existing patterns
4. The frame building always follows: set type → set parameters → configure → screen state

## Protocol Debugging

If commands aren't working:
1. Enable debug logging: `pm5.debugLog = (dir, msg) => console.log(...)`
2. Check TX frames — verify byte order and frame structure against `docs/CSAFE_SPEC.md`
3. Check RX responses — the PM5 will respond to every command frame
4. Verify byte stuffing — any byte 0xF0-0xF3 in the payload must be escaped
5. Verify checksum — XOR of all raw payload bytes before stuffing
