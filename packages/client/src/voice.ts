// Voice-Chat am Tisch: WebRTC zwischen allen Leuten am Tisch (Signale über den Server).

import { send, on } from './net.ts';
import { settings, vol } from './settings.ts';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  muted: boolean;
}

export class Voice {
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private myId = '';
  micOn = false;
  private pttDown = false;
  onSpeaking: ((id: string, level: number) => void) | null = null;

  constructor() {
    on('rtc', (m) => this.onSignal(m.from, m.data));
    addEventListener('keydown', (e) => {
      if (e.code === settings.keys.ptt && settings.pushToTalk && !(e.target instanceof HTMLInputElement)) {
        this.pttDown = true;
        this.updateTrack();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === settings.keys.ptt) {
        this.pttDown = false;
        this.updateTrack();
      }
    });
  }

  setMe(id: string) {
    this.myId = id;
  }

  async enableMic(on: boolean) {
    this.micOn = on;
    if (on && !this.stream) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        for (const [, p] of this.peers) for (const tr of this.stream.getTracks()) p.pc.addTrack(tr, this.stream);
        // neu verhandeln
        for (const id of this.peers.keys()) this.offer(id);
      } catch {
        this.micOn = false;
        throw new Error('Kein Mikrofonzugriff');
      }
    }
    this.updateTrack();
  }

  private updateTrack() {
    const active = this.micOn && (!settings.pushToTalk || this.pttDown);
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = active));
  }

  /** Mit allen anderen am Tisch verbinden */
  syncMembers(ids: string[]) {
    const others = ids.filter((i) => i && i !== this.myId && !i.startsWith('bot-'));
    for (const id of [...this.peers.keys()]) if (!others.includes(id)) this.drop(id);
    for (const id of others) if (!this.peers.has(id)) {
      this.create(id);
      if (this.myId < id) this.offer(id);
    }
  }

  private create(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio();
    audio.autoplay = true;
    const p: Peer = { pc, audio, muted: false };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => e.candidate && send({ type: 'rtc', to: id, data: { ice: e.candidate } });
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.volume = vol('volVoice');
      audio.play().catch(() => {});
    };
    if (this.stream) for (const tr of this.stream.getTracks()) pc.addTrack(tr, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    return p;
  }

  private async offer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    const o = await p.pc.createOffer();
    await p.pc.setLocalDescription(o);
    send({ type: 'rtc', to: id, data: { sdp: p.pc.localDescription } });
  }

  private async onSignal(from: string, data: any) {
    let p = this.peers.get(from);
    if (!p) p = this.create(from);
    try {
      if (data.sdp) {
        await p.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const a = await p.pc.createAnswer();
          await p.pc.setLocalDescription(a);
          send({ type: 'rtc', to: from, data: { sdp: p.pc.localDescription } });
        }
      } else if (data.ice) {
        await p.pc.addIceCandidate(data.ice);
      }
    } catch (e) {
      console.warn('RTC', e);
    }
  }

  setMuted(id: string, muted: boolean) {
    const p = this.peers.get(id);
    if (p) {
      p.muted = muted;
      p.audio.muted = muted;
    }
  }
  isMuted(id: string) {
    return this.peers.get(id)?.muted ?? false;
  }

  refreshVolume() {
    for (const p of this.peers.values()) p.audio.volume = vol('volVoice');
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    p?.pc.close();
    if (p) p.audio.srcObject = null;
    this.peers.delete(id);
  }

  leaveAll() {
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
