# PM5 BLE Specification

Bluetooth Low Energy (BLE) GATT service and characteristic layout for the Concept2 PM5 performance monitor.

## UUID Pattern

All PM5 UUIDs share a common base:

```
ce06XXXX-43e5-11e4-916c-0800200c9a66
```

Where `XXXX` is the 4-digit identifier listed below.

## Services

| Service | UUID Suffix | Purpose |
|---------|-------------|---------|
| Information | 0010 | Device info (model, serial, firmware) |
| Control | 0020 | CSAFE command TX/RX |
| Rowing | 0030 | Real-time rowing data notifications |

## Characteristics

### Information Service (0010)

| Characteristic | UUID Suffix | Access | Content |
|----------------|-------------|--------|---------|
| Model Number | 0011 | Read | UTF-8 string |
| Serial Number | 0012 | Read | UTF-8 string |
| Hardware Rev | 0013 | Read | UTF-8 string |
| Firmware Ver | 0014 | Read | UTF-8 string |
| Manufacturer | 0015 | Read | UTF-8 string |

### Control Service (0020)

| Characteristic | UUID Suffix | Access | Purpose |
|----------------|-------------|--------|---------|
| TX | 0021 | Write | Send CSAFE commands to PM5 |
| RX | 0022 | Notify | Receive CSAFE responses from PM5 |

### Rowing Service (0030)

| Characteristic | UUID Suffix | Access | Payload Size | Update Rate |
|----------------|-------------|--------|--------------|-------------|
| General Status | 0031 | Notify | 19 bytes | ~5 Hz |
| Additional Status | 0032 | Notify | 16 bytes | ~5 Hz |
| Stroke Data | 0035 | Notify | 20 bytes | Per stroke |
| Split/Interval Data | 0037 | Notify | 18 bytes | Per split |

## Notification Data Formats

**All multi-byte values in notifications are LITTLE-ENDIAN.**

### General Status (0031) — 19 bytes

| Offset | Size | Field | Scale | Unit |
|--------|------|-------|-------|------|
| 0-2 | 24-bit LE | elapsed_time | x 0.01 | seconds |
| 3-5 | 24-bit LE | distance | x 0.1 | meters |
| 6 | 8-bit | workout_type | enum | — |
| 7 | 8-bit | interval_type | enum | — |
| 8 | 8-bit | workout_state | enum | — |
| 9 | 8-bit | rowing_state | 0/1 | inactive/active |
| 10 | 8-bit | stroke_state | enum | — |
| 11-13 | 24-bit LE | total_work_dist | raw | meters |
| 14-16 | 24-bit LE | workout_duration | raw | — |
| 18 | 8-bit | drag_factor | raw | — |

### Additional Status (0032) — 16 bytes

| Offset | Size | Field | Scale | Unit |
|--------|------|-------|-------|------|
| 0-2 | 24-bit LE | elapsed_time | x 0.01 | seconds |
| 3-4 | 16-bit LE | speed | x 0.001 | m/s |
| 5 | 8-bit | stroke_rate | raw | spm |
| 6 | 8-bit | heart_rate | raw | bpm |
| 7-8 | 16-bit LE | current_pace | x 0.01 | sec/500m |
| 9-10 | 16-bit LE | average_pace | x 0.01 | sec/500m |
| 11-12 | 16-bit LE | rest_distance | raw | meters |
| 13-15 | 24-bit LE | rest_time | x 0.01 | seconds |

### Stroke Data (0035) — 20 bytes

| Offset | Size | Field | Scale | Unit |
|--------|------|-------|-------|------|
| 0-2 | 24-bit LE | elapsed_time | x 0.01 | seconds |
| 3-5 | 24-bit LE | distance | x 0.1 | meters |
| 6 | 8-bit | drive_length | x 0.01 | meters |
| 7 | 8-bit | drive_time | x 0.01 | seconds |
| 8-9 | 16-bit LE | stroke_recovery_time | x 0.01 | seconds |
| 10-11 | 16-bit LE | stroke_distance | x 0.01 | meters |
| 12-13 | 16-bit LE | peak_drive_force | x 0.1 | newtons |
| 14-15 | 16-bit LE | avg_drive_force | x 0.1 | newtons |
| 16-17 | 16-bit LE | work_per_stroke | x 0.1 | joules |
| 18-19 | 16-bit LE | stroke_count | raw | — |

### Split/Interval Data (0037) — 18 bytes

| Offset | Size | Field | Scale | Unit |
|--------|------|-------|-------|------|
| 0-2 | 24-bit LE | elapsed_time | x 0.01 | seconds |
| 3-5 | 24-bit LE | distance | x 0.1 | meters |
| 6-8 | 24-bit LE | split_time | x 0.1 | seconds |
| 9-11 | 24-bit LE | split_distance | x 0.1 | meters |
| 12-13 | 16-bit LE | rest_time | raw | seconds |
| 14-15 | 16-bit LE | rest_distance | raw | meters |
| 16 | 8-bit | split_type | enum | — |
| 17 | 8-bit | split_number | raw | — |

## Workout State Enum

| Value | State |
|-------|-------|
| 0 | Waiting |
| 1 | Rowing |
| 2 | Countdown |
| 3 | Rest |
| 4 | Work Interval |
| 5 | Finished |
| 7 | Manual Row |

## Derived Calculations

**Watts from pace:**
```
watts = 2.80 / (pace_sec_per_500m / 500)^3
```

**Calories per hour:**
```
cal_per_hour = watts * 4 + 300    (when watts >= 50)
cal_per_hour = 300                (when watts < 50)
total_cal = cal_per_hour * elapsed_seconds / 3600
```

## Connection Sequence

1. Scan for device with name prefix "PM5"
2. Request services: Info (0010), Control (0020), Rowing (0030)
3. Connect GATT server
4. Get all three primary services
5. Cache TX characteristic (0021 on Control service)
6. Read device info from Info service characteristics
7. Subscribe to RX (0022) for CSAFE response debug
8. Subscribe to all four Rowing service notification characteristics
9. Device is ready for workout programming and data streaming

## Code Reference

See `src/parsers.ts` for notification parsing and `src/constants.ts` for UUIDs.
