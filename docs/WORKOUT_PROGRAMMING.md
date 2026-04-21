# Workout Programming Guide

Step-by-step CSAFE programming and race-start sequencing for the PM5. The library no longer treats programming as fire-and-forget: control writes are serialized, PM responses are parsed from RX, asynchronous screen-state changes are polled, and workout type is verified after setup.

## Workout Types

| Type | WORKOUT_TYPE value | Description |
|------|-------------------|-------------|
| Just Row | 1 (JUST_ROW_SPLITS) | Free rowing, no target |
| Single Distance | 3 (FIXED_DIST_SPLITS) | Row X meters with split tracking |
| Single Time | 5 (FIXED_TIME_SPLITS) | Row for X time with split tracking |
| Interval Distance | 7 (FIXED_DIST_INTERVAL) | Repeating distance intervals with rest |
| Interval Time | 6 (FIXED_TIME_INTERVAL) | Repeating time intervals with rest |

## General Pattern

Every workout follows this sequence:
1. Reset or rearm the PM into a programmable state
2. Send `SETPROGRAM` when the flow requires explicit workout programming
3. Set workout type
4. Set workout parameters (duration, splits, rest, etc.)
5. Configure workout (flag=0x01 for programming)
6. Set screen state to `PrepareToRow`
7. Poll `GET_SCREENSTATESTATUS` until the PM reports screen work is complete
8. Poll `GET_WORKOUTTYPE` to verify the PM accepted the intended workout

The library currently uses that verified path in both `erg_talk/src/pm5.ts` and the mirrored iOS PM5 manager.

## Race Start Staging

Fixed-distance and fixed-time races now support PM5-native staged starts:

1. Program the underlying workout using the verified sequence above
2. Send `SET_RACETYPE`
3. Send `SET_RACESTARTPARAMS`
4. Send `SET_SCREENSTATE(RACE, WARMUP_FOR_RACE)`
5. Send `SET_RACEOPERATIONTYPE(RACE_INIT)`
6. During countdown arm the PM with:
   - `SET_SCREENSTATE(RACE, PREPARE_TO_RACE)`
   - `SET_RACEOPERATIONTYPE(RACE_WAIT_TO_START)`
7. At `T-0` trigger the PM-native start with:
   - `SET_SCREENSTATE(WORKOUT, PREPARE_TO_RACE_START)`
   - `SET_RACEOPERATIONTYPE(START)`

For interval formats, the library still uses the improved workout-programming path and falls back to `GOINUSE` at start rather than PM5-native race mode.

## Just Row

Simplest workout — no parameters needed.

```
Frame 1: CSAFE([0x76, 3, 0x01, 1, 0x01])
          ^     ^       ^      ^  ^
          |     |       |      |  JUST_ROW_SPLITS (1)
          |     |       |      data length
          |     |       SET_WORKOUTTYPE
          |     inner length
          SETPMCFG_CMD

Frame 2: CSAFE([0x76, 4, 0x13, 2, 0x01, 0x01])
                          ^        ^     ^
                          |        |     PrepareToRow
                          |        Workout screen
                          SET_SCREENSTATE
```

## Single Distance (e.g. 2000m, 500m splits)

```
Frame 1: CSAFE([0x76, 3, 0x01, 1, 0x03])        // workoutType = FIXED_DIST_SPLITS (3)
Frame 2: CSAFE([0x76, 7, 0x03, 5, 0x80, 0x00, 0x00, 0x07, 0xD0])
                          ^       ^     ^---- 2000 in big-endian ----^
                          |       DUR_TYPE.DISTANCE (0x80)
                          SET_WORKOUTDURATION

Frame 3: CSAFE([0x76, 7, 0x05, 5, 0x80, 0x00, 0x00, 0x01, 0xF4])
                          ^       ^     ^---- 500 in big-endian -----^
                          |       DUR_TYPE.DISTANCE (0x80)
                          SET_SPLITDURATION

Frame 4: CSAFE([0x76, 3, 0x14, 1, 0x01,     // CONFIGURE_WORKOUT = programming
                0x76, 4, 0x13, 2, 0x01, 0x01])  // SET_SCREENSTATE
```

**Note**: Frame 4 batches two 0x76 sub-commands. This works if total frame fits in 20 bytes after stuffing.

## Single Time (e.g. 20:00 total, 4:00 splits)

Time values are in **centiseconds** (1/100 sec):
- 20:00 = 1200 seconds = 120,000 cs = `0x0001D4C0`
- 4:00 = 240 seconds = 24,000 cs = `0x00005DC0`

```
Frame 1: CSAFE([0x76, 3, 0x01, 1, 0x05])        // workoutType = FIXED_TIME_SPLITS (5)
Frame 2: CSAFE([0x76, 7, 0x03, 5, 0x00, 0x00, 0x01, 0xD4, 0xC0])
                                  ^     ^------- 120000 cs BE --------^
                                  DUR_TYPE.TIME (0x00)

Frame 3: CSAFE([0x76, 7, 0x05, 5, 0x00, 0x00, 0x00, 0x5D, 0xC0])
                                  ^     ^------- 24000 cs BE ---------^
                                  DUR_TYPE.TIME (0x00)

Frame 4: CSAFE([0x76, 3, 0x14, 1, 0x01,         // CONFIGURE_WORKOUT
                0x76, 4, 0x13, 2, 0x01, 0x01])   // SET_SCREENSTATE
```

## Interval Distance (e.g. 4 x 500m, 60s rest)

Intervals require a loop — each interval is programmed individually with a 0-based index.

```
Frame 1: CSAFE([0x76, 3, 0x01, 1, 0x07])        // workoutType = FIXED_DIST_INTERVAL (7)

// For each interval i = 0, 1, 2, 3:
Frame 2+2i: CSAFE([0x76, 3, 0x18, 1, i])        // SET_INTERVALCOUNT = i
Frame 3+2i: CSAFE([0x76, 7, 0x03, 5, 0x80, 0x00, 0x00, 0x01, 0xF4,   // duration: 500m
                   0x76, 4, 0x04, 2, 0x00, 0x3C])                      // rest: 60 seconds BE

// After all intervals:
Final: CSAFE([0x76, 3, 0x14, 1, 0x01,           // CONFIGURE_WORKOUT
              0x76, 4, 0x13, 2, 0x01, 0x01])     // SET_SCREENSTATE
```

**Total frames**: 2 + (2 * count). For 4 intervals = 10 frames.

## Interval Time (e.g. 4 x 2:00, 30s rest)

Same loop pattern as interval distance, but with time duration type.

- 2:00 = 120 seconds = 12,000 cs = `0x00002EE0`
- Rest: 30 seconds = `0x001E`

```
Frame 1: CSAFE([0x76, 3, 0x01, 1, 0x06])        // workoutType = FIXED_TIME_INTERVAL (6)

// For each interval i = 0, 1, 2, 3:
Frame 2+2i: CSAFE([0x76, 3, 0x18, 1, i])        // SET_INTERVALCOUNT = i
Frame 3+2i: CSAFE([0x76, 7, 0x03, 5, 0x00, 0x00, 0x00, 0x2E, 0xE0,   // duration: 12000 cs
                   0x76, 4, 0x04, 2, 0x00, 0x1E])                      // rest: 30 seconds

// After all intervals:
Final: CSAFE([0x76, 3, 0x14, 1, 0x01,           // CONFIGURE_WORKOUT
              0x76, 4, 0x13, 2, 0x01, 0x01])     // SET_SCREENSTATE
```

## End Workout

To end a workout in progress:

```
Frame: CSAFE([0x86])    // GOFINISHED_CMD (short command, no data)
```

## Common Pitfalls

1. **Endianness**: All multi-byte values in commands are BIG-ENDIAN. Forgetting this is the #1 bug.
2. **Time units**: Duration values for SET_WORKOUTDURATION and SET_SPLITDURATION are in centiseconds (seconds * 100), NOT milliseconds.
3. **Rest units**: SET_RESTDURATION values are in plain SECONDS (not centiseconds).
4. **Frame size**: Each CSAFE frame after byte-stuffing must fit in BLE writes of max 20 bytes. Split larger frames.
5. **Asynchronous screen changes**: `SET_SCREENSTATE` is not instantaneous. Poll `GET_SCREENSTATESTATUS` instead of assuming the PM is ready immediately after the write.
6. **Interval indexing**: SET_INTERVALCOUNT uses 0-based indexing.
7. **Duration type byte**: Don't forget the type prefix byte (0x00 for time, 0x80 for distance) before the 32-bit value.
8. **Write success is not enough**: A BLE write completing does not mean the PM accepted the command. Poll PM getters and read `GET_ERRORVALUE2` when verification fails.

## Decision Tree

```
Want to row freely?
  → Just Row

Have a distance target?
  ├── Single piece? → Single Distance
  └── Repeating with rest? → Interval Distance

Have a time target?
  ├── Single piece? → Single Time
  └── Repeating with rest? → Interval Time
```

## Code Reference

See `src/pm5.ts` for the high-level API:
- `pm5.programJustRow()`
- `pm5.programDistance(meters, splitMeters)`
- `pm5.programTime(totalSeconds, splitSeconds)`
- `pm5.programIntervalDistance(meters, restSeconds, count)`
- `pm5.programIntervalTime(workSeconds, restSeconds, count)`
- `pm5.prepareRaceWorkout(config)`
- `pm5.armRaceStart(config)`
- `pm5.triggerRaceStart(config)`
- `pm5.queryWorkoutState()`
- `pm5.queryScreenStateStatus()`
- `pm5.queryErrorValue()`
- `pm5.endWorkout()`
