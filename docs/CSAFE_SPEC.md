# CSAFE Protocol Reference for PM5

Communication Standard for Fitness Equipment — the protocol used to send commands to and receive responses from the Concept2 PM5 performance monitor.

## Frame Format

Every CSAFE message is wrapped in a frame:

```
[0xF1] [stuffed payload bytes] [stuffed checksum] [0xF2]
  ^                                                  ^
  START byte                                         END byte
```

### Checksum

XOR of all **raw** (pre-stuffing) payload bytes:

```
checksum = payload[0] ^ payload[1] ^ ... ^ payload[N-1]
```

### Byte Stuffing

Any byte in the payload OR checksum that falls in the range `0xF0`-`0xF3` must be escaped:

| Original byte | Stuffed as |
|---------------|------------|
| 0xF0 | 0xF3, 0x00 |
| 0xF1 | 0xF3, 0x01 |
| 0xF2 | 0xF3, 0x02 |
| 0xF3 | 0xF3, 0x03 |

### Worked Example

Payload: `[0x76, 0x03, 0x01, 0x01, 0x01]`

1. Checksum: `0x76 ^ 0x03 ^ 0x01 ^ 0x01 ^ 0x01 = 0x76`
2. No bytes need stuffing (none in 0xF0-0xF3 range)
3. Frame: `[0xF1, 0x76, 0x03, 0x01, 0x01, 0x01, 0x76, 0xF2]`

## Command Types

### Short Commands (1 byte, no data)

Commands >= 0x80 are "short" — just the command byte, no length or data:

| Command | Code | Purpose |
|---------|------|---------|
| GOINUSE_CMD | 0x85 | Transition to InUse state |
| GOFINISHED_CMD | 0x86 | End current workout |
| GOREADY_CMD | 0x87 | Return to Ready state |

### Standard Long Commands (cmd + length + data)

Commands < 0x80 carry a data payload:

```
[cmd] [data_length] [data_byte_1] [data_byte_2] ...
```

| Command | Code | Data | Purpose |
|---------|------|------|---------|
| SETTWORK_CMD | 0x20 | [hour, min, sec] | Set work time |
| SETHORIZONTAL_CMD | 0x21 | [dist_lo, dist_hi, unit] | Set distance (unit 0x24=meters) |
| SETPROGRAM_CMD | 0x24 | [program, 0x00] | Set program (0=Programmed) |

### PM5 Proprietary Commands (0x76 SETPMCFG_CMD)

All PM5-specific workout programming uses the `0x76` wrapper containing one or more sub-commands:

```
[0x76] [total_inner_length] [sub_cmd_1] [data_len_1] [data_1...] [sub_cmd_2] [data_len_2] [data_2...] ...
```

Multiple sub-commands can be batched in a single 0x76 if they fit within the BLE MTU.

## PM5 Proprietary Sub-Commands

All sub-commands are placed inside a `0x76` SETPMCFG_CMD wrapper.

| Sub-Command | Code | Data Length | Data Format |
|-------------|------|-------------|-------------|
| SET_WORKOUTTYPE | 0x01 | 1 | [workout_type] |
| SET_WORKOUTDURATION | 0x03 | 5 | [dur_type, value_BE_32] |
| SET_RESTDURATION | 0x04 | 2 | [seconds_BE_16] |
| SET_SPLITDURATION | 0x05 | 5 | [dur_type, value_BE_32] |
| SET_SCREENSTATE | 0x13 | 2 | [screen_type, screen_value] |
| CONFIGURE_WORKOUT | 0x14 | 1 | [0x01=programming, 0x00=done] |
| SET_INTERVALTYPE | 0x17 | 1 | [interval_type] |
| SET_INTERVALCOUNT | 0x18 | 1 | [0-based interval index] |

### Duration Type Byte

The first byte of SET_WORKOUTDURATION and SET_SPLITDURATION data:

| Type | Value | Unit of the 32-bit value |
|------|-------|--------------------------|
| TIME | 0x00 | Centiseconds (1/100 sec) |
| DISTANCE | 0x80 | Meters |

### Screen State Values

For SET_SCREENSTATE `[screen_type, screen_value]`:
- `[0x01, 0x01]` = Workout screen, PrepareToRow

## CRITICAL: Endianness

**CSAFE command data** (values sent TO the PM5): **BIG-ENDIAN** (MSB first)

```
2000 meters = 0x000007D0 → bytes: [0x00, 0x00, 0x07, 0xD0]
```

**BLE notification data** (values received FROM the PM5): **LITTLE-ENDIAN** (LSB first)

```
2000 = 0x07D0 → bytes: [0xD0, 0x07]
```

Do NOT mix these up. This is the #1 source of bugs.

## BLE Transport Rules

- **Max BLE packet**: 20 bytes. Frames larger than 20 bytes must be split into 20-byte chunks and written sequentially.
- **Inter-frame delay**: Minimum 50ms between separate CSAFE frames. Recommended: 100ms for reliability.
- **Write characteristic**: TX (ce060021) on the Control service (ce060020).
- **Response characteristic**: RX (ce060022) on the Control service.

## Code Reference

See `src/csafe.ts` for the implementation:
- `buildCsafeFrame()` — frame construction with checksum and byte stuffing
- `buildPmCfgPayload()` — 0x76 wrapper builder
- `bigEndian32()` / `bigEndian16()` — endian helpers
