// Voice-Chat am Tisch: WebRTC zwischen allen Leuten am Tisch (Signale über den Server).
// „Perfect Negotiation“: keine Kollisionen, wenn beide gleichzeitig verhandeln;
// ICE-Kandidaten werden gepuffert; das Mikro wird per replaceTrack ein-/ausgeschaltet
// (keine Neuverhandlung nötig). STUN + öffentliche TURN-Relays für schwierige Netze (Handy/WLAN).

import { send, on } from './net.ts';
import { settings, vol } from './settings.ts';

const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  // öffentliches Test-Relay (Open Relay Project) – hilft, wenn kein direkter Weg möglich ist
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

export type PeerState = 'connecting' | 'connected' | 'failed';

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  muted: boolean;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  state: PeerState;
}

export class Voice {
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private myId = '';
  micOn = false;
  private pttDown = false;
  /** eigener Pegel 0..1 (für die Anzeige am Mikro-Knopf) */
  level = 0;
  onChange: (() => void) | null = null;

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
    // Autoplay-Sperre (iPhone/iPad): bei der nächsten Berührung alle Stimmen starten
    const resume = () => this.peers.forEach((p) => p.audio.srcObject && p.audio.play().catch(() => {}));
    addEventListener('pointerdown', resume);
    addEventListener('keydown', resume);
  }

  setMe(id: string) {
    this.myId = id;
  }

  async enableMic(on: boolean) {
    // iPhone: mit Audio-Session „playback“ verweigert Safari das Mikrofon → beim Sprechen „play-and-record“
    try {
      const as = (navigator as any).audioSession;
      if (as) as.type = on ? 'play-and-record' : 'playback';
    } catch {}
    if (on && !this.stream) {
      try {
        // direkt im Tipp aufrufen → der Browser zeigt seine Erlaubnis-Abfrage
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.meter(this.stream);
      } catch (e: any) {
        this.micOn = false;
        try {
          const as = (navigator as any).audioSession;
          if (as) as.type = 'playback';
        } catch {}
        const de = (localStorage.getItem('lang') ?? 'tr') === 'de';
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (e?.name === 'NotAllowedError')
          throw new Error(
            ios
              ? de
                ? 'Mikro gesperrt: in Safari auf „aA“ (bzw. ☰) › Website-Einstellungen › Mikrofon › Erlauben, dann neu laden'
                : 'Mikrofon engelli: Safari’de „aA“ (☰) › Web sitesi ayarları › Mikrofon › İzin ver, sonra yenile'
              : de
                ? 'Mikro gesperrt: beim Schloss-Symbol in der Adressleiste Mikrofon erlauben, dann neu laden'
                : 'Mikrofon engelli: adres çubuğundaki kilit simgesinden izin ver, sonra yenile',
          );
        throw new Error(de ? 'Kein Mikrofon gefunden' : 'Mikrofon bulunamadı');
      }
    }
    this.micOn = on;
    const track = this.stream?.getAudioTracks()[0] ?? null;
    for (const p of this.peers.values()) this.attachTrack(p, track);
    this.updateTrack();
    this.onChange?.();
  }

  private attachTrack(p: Peer, track: MediaStreamTrack | null) {
    for (const tr of p.pc.getTransceivers()) {
      if (tr.receiver.track?.kind !== 'audio') continue;
      if (tr.currentDirection === 'stopped') continue;
      try {
        if (tr.direction !== 'sendrecv') tr.direction = 'sendrecv';
        tr.sender.replaceTrack(track).catch(() => {});
      } catch {}
    }
  }

  private updateTrack() {
    const active = this.micOn && (!settings.pushToTalk || this.pttDown);
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = active));
  }

  /** Pegelmesser fürs eigene Mikro */
  private meter(stream: MediaStream) {
    try {
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const active = this.micOn && (!settings.pushToTalk || this.pttDown);
        this.level = active ? Math.min(1, Math.sqrt(sum / buf.length) * 6) : 0;
      }, 120);
    } catch {}
  }

  /** Mit allen anderen am Tisch verbinden */
  syncMembers(ids: string[]) {
    const others = ids.filter((i) => i && i !== this.myId && !i.startsWith('bot-'));
    for (const id of [...this.peers.keys()]) if (!others.includes(id)) this.drop(id);
    for (const id of others) if (!this.peers.has(id)) this.create(id, this.myId < id);
  }

  state(id: string): PeerState | null {
    return this.peers.get(id)?.state ?? null;
  }

  private create(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.append(audio);
    const p: Peer = { pc, audio, muted: false, polite: this.myId > id, makingOffer: false, ignoreOffer: false, pendingIce: [], state: 'connecting' };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => e.candidate && send({ type: 'rtc', to: id, data: { ice: e.candidate.toJSON() } });
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      audio.volume = vol('volVoice');
      audio.muted = p.muted;
      audio.play().catch(() => {});
    };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        send({ type: 'rtc', to: id, data: { sdp: pc.localDescription } });
      } catch (e) {
        console.warn('RTC offer', e);
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      p.state = s === 'connected' ? 'connected' : s === 'failed' || s === 'closed' ? 'failed' : 'connecting';
      if (s === 'failed') pc.restartIce?.();
      this.onChange?.();
    };
    // nur eine Seite legt den Audio-Kanal an, die andere übernimmt ihn aus dem Angebot
    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const track = this.stream?.getAudioTracks()[0];
      if (track) tr.sender.replaceTrack(track).catch(() => {});
    }
    return p;
  }

  private async onSignal(from: string, data: any) {
    let p = this.peers.get(from);
    if (!p) p = this.create(from, false);
    const pc = p.pc;
    try {
      if (data.sdp) {
        const collision = data.sdp.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.sdp);
        for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          // eigenes Mikro auf den angebotenen Kanal legen
          this.attachTrack(p, this.stream?.getAudioTracks()[0] ?? null);
          await pc.setLocalDescription();
          send({ type: 'rtc', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.ice) {
        if (!pc.remoteDescription) p.pendingIce.push(data.ice);
        else await pc.addIceCandidate(data.ice).catch((e) => !p!.ignoreOffer && console.warn('ICE', e));
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
    if (p) {
      p.audio.srcObject = null;
      p.audio.remove();
    }
    this.peers.delete(id);
  }

  leaveAll() {
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
