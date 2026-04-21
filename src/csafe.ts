// CSAFE frame builder — checksum, byte stuffing, frame construction.
// Pure functions with no platform dependencies.

import { FRAME, CSAFE } from './constants.js';
import type {
  CsafeCommand,
  CsafeCommandResponse,
  CsafeFrameResponse,
  PmSubCommand,
} from './types.js';

/** XOR checksum of all bytes in the array. */
export function xorChecksum(bytes: readonly number[]): number {
  let cs = 0;
  for (let i = 0; i < bytes.length; i++) cs ^= bytes[i];
  return cs;
}

/** Append a byte to arr, applying CSAFE byte stuffing if 0xF0-0xF3. */
export function stuffByte(arr: number[], b: number): void {
  if (b >= 0xF0 && b <= 0xF3) {
    arr.push(FRAME.STUFF);
    arr.push(b - 0xF0);
  } else {
    arr.push(b);
  }
}

/**
 * Build a complete CSAFE frame from raw payload bytes.
 *
 * Frame format: [0xF1] [stuffed payload] [stuffed checksum] [0xF2]
 * - Checksum = XOR of all raw (pre-stuffing) payload bytes
 * - Byte stuffing: any byte 0xF0-0xF3 becomes [0xF3, byte - 0xF0]
 */
export function buildCsafeFrame(payload: readonly number[]): Uint8Array {
  const checksum = xorChecksum(payload);
  const stuffed: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    stuffByte(stuffed, payload[i]);
  }
  stuffByte(stuffed, checksum);
  return new Uint8Array([FRAME.START, ...stuffed, FRAME.END]);
}

/** Encode a 32-bit value as 4 bytes, big-endian (MSB first). Used for CSAFE command data. */
export function bigEndian32(v: number): readonly number[] {
  return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
}

/** Encode a 16-bit value as 2 bytes, big-endian (MSB first). Used for CSAFE command data. */
export function bigEndian16(v: number): readonly number[] {
  return [(v >>> 8) & 0xFF, v & 0xFF];
}

/** Encode a 16-bit value as 2 bytes, little-endian (LSB first). */
export function lowEndian16(v: number): readonly number[] {
  return [v & 0xFF, (v >>> 8) & 0xFF];
}

/**
 * Build a SETPMCFG_CMD (0x76) payload containing one or more proprietary sub-commands.
 *
 * Output format: [0x76, total_inner_length, sub_cmd_1, data_len_1, data_1..., sub_cmd_2, ...]
 *
 * @param subCommands - Array of {cmd, data} objects
 * @returns Raw payload bytes (not yet wrapped in a CSAFE frame)
 */
export function buildPmCfgPayload(subCommands: readonly PmSubCommand[]): readonly number[] {
  const inner: number[] = [];
  for (const sc of subCommands) {
    inner.push(sc.cmd);
    inner.push(sc.data.length);
    inner.push(...sc.data);
  }
  return [CSAFE.SETPMCFG_CMD, inner.length, ...inner];
}

/** Build a PM proprietary wrapper payload such as GETPMCFG / GETPMDATA / SETPMDATA. */
export function buildPmWrapperPayload(wrapper: number, commands: readonly CsafeCommand[]): readonly number[] {
  const inner: number[] = [];
  for (const command of commands) {
    const data = command.data ?? [];
    inner.push(command.cmd);
    if (data.length > 0 || command.cmd < 0x80) {
      inner.push(data.length);
      inner.push(...data);
    }
  }
  return [wrapper, inner.length, ...inner];
}

/**
 * Build a standard CSAFE long command.
 *
 * Output format: [cmd, data_length, ...data]
 *
 * @param cmd - CSAFE command code (e.g. CSAFE.SETHORIZONTAL_CMD)
 * @param data - Command data bytes
 */
export function buildLongCommand(cmd: number, data: readonly number[]): readonly number[] {
  return [cmd, data.length, ...data];
}

/** Convert a byte array or Uint8Array to a hex string for debug logging. */
export function bytesToHex(arr: Uint8Array | readonly number[]): string {
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join(' ');
}

/** Undo CSAFE byte stuffing on frame contents (without start/stop bytes). */
export function unstuffBytes(arr: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const byte = arr[i];
    if (byte === FRAME.STUFF) {
      i++;
      if (i >= arr.length) throw new Error('Malformed CSAFE frame: dangling stuff byte');
      out.push(0xF0 + arr[i]);
    } else {
      out.push(byte);
    }
  }
  return new Uint8Array(out);
}

/** Parse command responses from the body after the CSAFE status byte. */
export function parseCommandResponses(arr: Uint8Array): readonly CsafeCommandResponse[] {
  const responses: CsafeCommandResponse[] = [];
  let offset = 0;

  while (offset < arr.length) {
    const command = arr[offset++];
    if (offset >= arr.length) {
      throw new Error(`Malformed CSAFE response for command 0x${command.toString(16)}`);
    }

    const dataLength = arr[offset++];
    const end = offset + dataLength;
    if (end > arr.length) {
      throw new Error(`CSAFE response length overflow for command 0x${command.toString(16)}`);
    }

    responses.push({
      command,
      data: arr.slice(offset, end),
    });
    offset = end;
  }

  return responses;
}

/** Parse a full CSAFE response frame received from the PM. */
export function parseCsafeFrame(frame: Uint8Array): CsafeFrameResponse {
  if (frame.length < 4 || frame[0] !== FRAME.START || frame[frame.length - 1] !== FRAME.END) {
    throw new Error('Not a CSAFE frame');
  }

  const unstuffed = unstuffBytes(frame.slice(1, frame.length - 1));
  if (unstuffed.length < 2) throw new Error('CSAFE frame too short');

  const payload = unstuffed.slice(0, unstuffed.length - 1);
  const checksum = unstuffed[unstuffed.length - 1];
  if (xorChecksum(Array.from(payload)) !== checksum) {
    throw new Error('CSAFE checksum mismatch');
  }

  const status = payload[0];
  const responses = parseCommandResponses(payload.slice(1));

  return {
    status: {
      raw: status,
      previousFrameStatus: status & 0x30,
      stateMachineState: status & 0x0f,
    },
    responses,
  };
}
