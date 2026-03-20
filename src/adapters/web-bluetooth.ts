// Web Bluetooth adapter — reference BleTransport implementation for browsers.
// Requires Chrome or Edge with Web Bluetooth support.

import type { BleTransport } from '../types.js';

export class WebBluetoothTransport implements BleTransport {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private readonly services = new Map<string, BluetoothRemoteGATTService>();
  private readonly chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private disconnectCallback: (() => void) | null = null;

  async connect(namePrefix: string, serviceUuids: readonly string[]): Promise<string> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported. Use Chrome or Edge.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix }],
      optionalServices: [...serviceUuids],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.cleanup();
      this.disconnectCallback?.();
    });

    const server = this.device.gatt;
    if (!server) throw new Error('No GATT server on device');
    this.server = await server.connect();

    // Pre-cache all requested services
    for (const uuid of serviceUuids) {
      try {
        const svc = await this.server.getPrimaryService(uuid);
        this.services.set(uuid, svc);
      } catch {
        // Service may not exist on all firmware versions
      }
    }

    return this.device.name ?? 'Unknown PM5';
  }

  async disconnect(): Promise<void> {
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.cleanup();
  }

  async write(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
    const char = await this.getCharacteristic(serviceUuid, charUuid);
    await char.writeValue(data as unknown as BufferSource);
  }

  async subscribe(
    serviceUuid: string,
    charUuid: string,
    callback: (data: DataView) => void,
  ): Promise<void> {
    const char = await this.getCharacteristic(serviceUuid, charUuid);
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (e: Event) => {
      const target = e.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) callback(target.value);
    });
  }

  async readValue(serviceUuid: string, charUuid: string): Promise<DataView> {
    const char = await this.getCharacteristic(serviceUuid, charUuid);
    return char.readValue();
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async getCharacteristic(
    serviceUuid: string,
    charUuid: string,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    const key = `${serviceUuid}:${charUuid}`;
    const cached = this.chars.get(key);
    if (cached) return cached;

    const service = this.services.get(serviceUuid);
    if (!service) throw new Error(`Service not found: ${serviceUuid}`);

    const char = await service.getCharacteristic(charUuid);
    this.chars.set(key, char);
    return char;
  }

  private cleanup(): void {
    this.server = null;
    this.device = null;
    this.services.clear();
    this.chars.clear();
  }
}
