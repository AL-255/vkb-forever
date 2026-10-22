import { MidiStream, hex } from './protocol.js';
export const BLE_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Conservative 15 MIDI-data bytes per ATT packet, including EOX timestamp.
export function blePackets(message, timestamp = Math.floor(performance.now()) & 8191) {
  const header = 0x80 | ((timestamp >> 7) & 63), low = 0x80 | (timestamp & 127), packets = [];
  if (message[0] !== 0xf0) return [Uint8Array.from([header, low, ...message])];
  for (let i = 0; i < message.length; i += 15) {
    const chunk = Array.from(message.slice(i, i + 15)), packet = [header];
    if (!i) packet.push(low);
    for (const b of chunk) { if (b === 0xf7) packet.push(low); packet.push(b); }
    packets.push(Uint8Array.from(packet));
  }
  return packets;
}
export class BleDecoder {
  constructor(onMessage) { this.stream = new MidiStream(onMessage); }
  feed(bytes) {
    if (bytes.length < 2 || !(bytes[0] & 128)) return;
    let timestampConsumed = false;
    for (const byte of bytes.slice(1)) {
      // A high-bit byte introduces a timestamp; the immediately following
      // high-bit byte is MIDI status. Data-only SysEx continuation and running
      // status sharing a timestamp need no extra prefix.
      if (byte >= 128 && !timestampConsumed) timestampConsumed = true;
      else { this.stream.feed([byte]); timestampConsumed = false; }
    }
    // Only SysEx may span BLE packets. Running status is packet-local.
    if (!this.stream.sysex) { this.stream.status = null; this.stream.data = []; }
  }
}
export class Transport extends EventTarget {
  constructor() {
    super(); this.generation = 0; this.tail = Promise.resolve(); this.interval = 0; this.connected = false;
    this.inputStream = new MidiStream(bytes => this.emit('midi', bytes));
    this.bleDecoder = new BleDecoder(bytes => this.emit('midi', bytes));
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async connectBluetooth() {
    if (!navigator.bluetooth) throw Error('Web Bluetooth is unavailable. Use a supported Chrome/Edge browser, or connect through OS MIDI.');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_SERVICE] }, { namePrefix: 'VKB' }], optionalServices: [BLE_SERVICE] });
    this.disconnect(); const generation = this.generation;
    this.bluetooth = device;
    const disconnected = () => { if (generation === this.generation) this.disconnect(); };
    this.bluetoothListener = disconnected; device.addEventListener('gattserverdisconnected', disconnected);
    try {
      const server = await device.gatt.connect(), service = await server.getPrimaryService(BLE_SERVICE);
      const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC);
      this.notification = event => { if (generation === this.generation) { const view = event.target.value; const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength); this.emit('packet', { direction: 'RX BLE', hex: hex(bytes) }); this.bleDecoder.feed(bytes); } };
      this.characteristic = characteristic; characteristic.addEventListener('characteristicvaluechanged', this.notification);
      await characteristic.startNotifications();
      if (characteristic.properties.read) {
        const initial = await characteristic.readValue();
        if (initial.byteLength) this.notification({target:{value:initial}});
      }
      if (generation !== this.generation) throw Error('Connection canceled');
      this.connected = true; this.kind = 'ble'; this.name = device.name || 'VKB-100';
      this.emit('connection', { connected: true, name: this.name, kind: this.kind });
    } catch (error) { if (generation === this.generation) this.disconnect(); throw error; }
  }
  async midiPorts() {
    if (!navigator.requestMIDIAccess) throw Error('Web MIDI is unavailable in this browser. Try Chrome or Edge.');
    const access = await navigator.requestMIDIAccess({ sysex: true });
    this.midiAccess = access;
    return { inputs: [...access.inputs.values()], outputs: [...access.outputs.values()] };
  }
  async connectMidi(inputId, outputId) {
    const input = this.midiAccess?.inputs.get(inputId), output = this.midiAccess?.outputs.get(outputId);
    if (!input || !output) throw Error('Select both an input and output MIDI port');
    this.disconnect(); const generation = this.generation;
    await input.open(); await output.open();
    if (generation !== this.generation) { await input.close(); await output.close(); throw Error('Connection canceled'); }
    this.input = input; this.output = output;
    input.onmidimessage = e => this.inputStream.feed(e.data);
    this.portState = () => { if (input.state === 'disconnected' || output.state === 'disconnected') this.disconnect(); };
    this.midiAccess.addEventListener('statechange', this.portState);
    this.connected = true; this.kind = 'midi'; this.name = output.name || 'MIDI keyboard';
    this.emit('connection', { connected: true, name: this.name, kind: this.kind });
  }
  disconnect() {
    this.generation++; this.connected = false;
    if (this.characteristic && this.notification) this.characteristic.removeEventListener('characteristicvaluechanged', this.notification);
    if (this.bluetooth && this.bluetoothListener) this.bluetooth.removeEventListener('gattserverdisconnected', this.bluetoothListener);
    this.bluetooth?.gatt?.disconnect(); this.bluetooth = null; this.characteristic = null;
    if (this.input) { this.input.onmidimessage = null; this.input.close().catch(() => {}); }
    if (this.output) this.output.close().catch(() => {});
    if (this.portState) this.midiAccess?.removeEventListener('statechange', this.portState);
    this.input = this.output = null;
    this.inputStream.reset(); this.bleDecoder.stream.reset(); this.tail = Promise.resolve();
    this.emit('connection', { connected: false });
  }
  send(bytes) {
    const generation = this.generation, snapshot = Uint8Array.from(bytes);
    const task = async () => {
      const check = () => { if (!this.connected || generation !== this.generation) throw Error('Keyboard disconnected; transfer stopped'); };
      check(); this.emit('packet', { direction: 'TX MIDI', hex: hex(snapshot) });
      if (this.kind === 'ble') {
        for (const packet of blePackets(snapshot)) {
          check(); const c = this.characteristic;
          let timeout;
          try {
            await Promise.race([
              c.properties.writeWithoutResponse ? c.writeValueWithoutResponse(packet) : c.writeValueWithResponse(packet),
              new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Bluetooth write timed out; reconnect the keyboard')),10000); })
            ]);
          } finally { clearTimeout(timeout); }
          this.emit('packet', { direction: 'TX BLE', hex: hex(packet) });
          await sleep(Math.ceil(6 + [0,30,80,140,250,470][this.interval] * 15 / 780));
        }
      } else { this.output.send(snapshot); await sleep(Math.ceil(snapshot.length / 15) * Math.ceil(6 + [0,30,80,140,250,470][this.interval] * 15 / 780)); }
      check();
    };
    const result = this.tail.then(task).catch(error => {
      if (generation === this.generation && this.connected) this.disconnect();
      throw error;
    });
    this.tail = result.catch(() => {}); return result;
  }
}
