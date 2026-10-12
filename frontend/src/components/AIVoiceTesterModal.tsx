import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioStreamer } from '../utils/audioStreamer';
import {
  X,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Bot,
  User,
  Sparkles,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  ShoppingBag,
  Layers,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOrderPlaced?: () => void;
  onCallLogged?: () => void;
}

export type MicState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface Message {
  id: string;
  sender: 'customer' | 'ai' | 'system';
  text: string;
  time: string;
  toolCall?: {
    name: string;
    args: any;
    result: any;
  };
  orderDraft?: any;
  confirmedOrder?: any;
}

export const AIVoiceTesterModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOrderPlaced,
  onCallLogged,
}) => {
  const [callerName] = useState('Priya Sharma');
  const [callerPhone] = useState('+91 7845742951');
  const [inputText, setInputText] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [wsConnected, setWsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('Connecting to Gemini Live...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallActive, setIsCallActive] = useState(true);
  const [activeDraft, setActiveDraft] = useState<any | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: 'வணக்கம்! Welcome to Aura Dining! I am your AI Voice Assistant powered by Google Gemini Live. I can take your order in Tamil or English, tell you about our menu, and answer your questions. What would you like to order today?',
      time: 'Just now',
    },
  ]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Single-flight guard: React StrictMode mounts effects twice — without this,
  // two WebSockets (two Gemini sessions) open and the greeting plays twice.
  const connectingRef = useRef(false);
  const sessionSeqRef = useRef(0);
  // Server sends the greeting exactly once per Gemini session; this flag keeps
  // reconnects from ever replaying it client-side.
  const greetingHeardRef = useRef(false);
  // Live diagnostics (counters only — no audio, no secrets).
  const [diag, setDiag] = useState<{
    audioOut?: number;
    inputTx?: number;
    outputTx?: number;
    turns?: number;
    interrupts?: number;
    tools?: number;
    chunksSent?: number;
    nativeRate?: number;
    latAudioMs?: number;
    latTotalMs?: number;
    backendAudioMs?: number;
  }>({});
  // One turn in flight at a time: cid traces submit→WS→backend→Gemini→reply.
  const pendingCidRef = useRef<string | null>(null);
  // t0/t1 per turn (performance.now ms): submit/stop time + kind for latency math.
  const turnTimingRef = useRef<{ cid: string; tSubmit: number; kind: string; firstAudioAt?: number } | null>(null);
  // Raw audio-chunk count (ref, no renders); synced to diag throttled + on turn end.
  const audioCountRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const micStateRef = useRef<MicState>('idle');
  useEffect(() => {
    micStateRef.current = micState;
  }, [micState]);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    pendingCidRef.current = null;
  }, []);

  const armWatchdog = useCallback((cid: string) => {
    clearWatchdog();
    pendingCidRef.current = cid;
    // If Gemini/WS/tooling never answers, surface an error instead of
    // PROCESSING forever. Fires only while still stuck in processing.
    watchdogRef.current = window.setTimeout(() => {
      if (micStateRef.current === 'processing' && pendingCidRef.current === cid) {
        console.error(`[voice] turn timeout cid=${cid}: no turn_complete/error in 25s`);
        pendingCidRef.current = null;
        watchdogRef.current = null;
        setErrorMessage('No response from the assistant (timed out). Check backend logs, then Retry or Reconnect.');
        setMicState('idle');
      }
    }, 25000);
  }, [clearWatchdog]);

  /** Safe WS send: readyState-checked, never throws. Returns accepted or not. */
  const sendWs = useCallback((obj: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[voice] WS send blocked: socket not OPEN', { readyState: ws?.readyState });
      return false;
    }
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      console.error('[voice] WS send threw:', err);
      return false;
    }
  }, []);
  // Stable refs for callbacks so connectWebSocket doesn't change every render
  // (micState / prop closures in deps caused a reconnect storm: close -> send on
  // dead socket -> ClientDisconnected ERROR in backend logs).
  const onOrderPlacedRef = useRef(onOrderPlaced);
  const onCallLoggedRef = useRef(onCallLogged);
  const mutedRef = useRef(isAudioMuted);
  // Increments every user turn / AI turn-complete so transcript chunks from a NEW
  // answer start a new bubble instead of appending to the previous answer.
  const turnRef = useRef(0);
  useEffect(() => {
    onOrderPlacedRef.current = onOrderPlaced;
    onCallLoggedRef.current = onCallLogged;
  }, [onOrderPlaced, onCallLogged]);
  useEffect(() => {
    mutedRef.current = isAudioMuted;
  }, [isAudioMuted]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Call timer
  useEffect(() => {
    let timer: any;
    if (isOpen && isCallActive && wsConnected) {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen, isCallActive, wsConnected]);

  // WebSocket Connection & AudioStreamer Lifecycle (one WS = one Gemini session)
  const connectWebSocket = useCallback(() => {
    if (connectingRef.current) return; // StrictMode double-invoke guard
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return; // already connected/connecting — never spawn a duplicate session
    }
    connectingRef.current = true;
    const mySeq = ++sessionSeqRef.current;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    setErrorMessage(null);
    setConnectionMessage('Connecting to Google Gemini Live (gemini-2.5-flash-native-audio-latest)...');

    const host = window.location.hostname || '127.0.0.1';
    const wsUrl = `ws://${host}:8000/api/voice-simulator/stream?phone=${encodeURIComponent(
      callerPhone
    )}&name=${encodeURIComponent(callerName)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mySeq !== sessionSeqRef.current) { try { ws.close(); } catch { /* ignore */ } return; }
      connectingRef.current = false;
      setWsConnected(true);
      setConnectionMessage('Connected to Google Gemini Live API');
      console.info(`[voice] ws open seq=${mySeq}`);
    };

    ws.onmessage = (event) => {
      if (mySeq !== sessionSeqRef.current) return; // stale session — ignore
      try {
        const data = JSON.parse(event.data);
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (data.type === 'diag') {
          const s = data.stats || {};
          setDiag((prev) => ({
            ...prev,
            inputTx: s.input_transcripts ?? prev.inputTx,
            outputTx: s.output_transcripts ?? prev.outputTx,
            turns: s.turn_completes ?? prev.turns,
            interrupts: s.interrupts ?? prev.interrupts,
            tools: s.tool_calls ?? prev.tools,
          }));
          if (data.event && data.event !== 'audio_out') {
            console.info(`[voice] diag: ${data.event}`, s);
          }
          if (data.event === 'turn_latency' && typeof data.ms_recv_to_audio === 'number') {
            setDiag((prev) => ({ ...prev, backendAudioMs: data.ms_recv_to_audio }));
          }
          if (
            data.event === 'session_error' ||
            data.event === 'session_closed_unexpectedly' ||
            data.event === 'text_error' ||
            data.event === 'tool_response_error'
          ) {
            clearWatchdog();
            setErrorMessage(
              data.event === 'session_closed_unexpectedly'
                ? 'Voice session closed unexpectedly. Press Reconnect.'
                : `Assistant error (${data.event}). Try again or Reconnect.`
            );
            setMicState('idle');
          }
          return;
        }

        if (data.type === 'ack') {
          console.info(`[voice] backend accepted turn cid=${data.cid}`);
          return;
        }

        if (data.type === 'error') {
          console.error(`[voice] backend rejected turn cid=${data.cid}:`, data.message);
          clearWatchdog();
          setErrorMessage(data.message || 'Assistant rejected the message. Try Reconnect.');
          setMicState('idle');
          return;
        }

        if (data.type === 'status') {
          if (data.connected) {
            setWsConnected(true);
            setConnectionMessage(data.message || 'Connected to Gemini Live');
          } else {
            setWsConnected(false);
            setErrorMessage(data.error || 'Failed to connect to Gemini Live');
            setMicState('error');
          }
        } else if (data.type === 'audio') {
          // Received 24kHz PCM chunk from Gemini Live — play immediately.
          // Counter-only state is throttled (every 5th chunk) so playback at
          // ~5 chunks/sec doesn't re-render the modal on every chunk; the
          // exact count syncs on turn_complete. Audio itself is never delayed.
          audioCountRef.current += 1;
          if (audioCountRef.current % 5 === 0) {
            const n = audioCountRef.current;
            setDiag((prev) => ({ ...prev, audioOut: n }));
          }
          let msUntilAudible = 0;
          if (streamerRef.current && !mutedRef.current) {
            msUntilAudible = streamerRef.current.playAudioChunk(data.data);
          }
          const timing = turnTimingRef.current;
          if (timing && timing.firstAudioAt === undefined && pendingCidRef.current === timing.cid) {
            timing.firstAudioAt = performance.now();
            const msSubmitToAudio = Math.round(timing.firstAudioAt - timing.tSubmit);
            console.info(
              `[voice] TURN cid=${timing.cid} kind=${timing.kind} ` +
              `submit->first_audio=${msSubmitToAudio}ms ` +
              `playback_queue=${Math.round(msUntilAudible)}ms`
            );
            setDiag((prev) => ({ ...prev, latAudioMs: msSubmitToAudio }));
          }
        } else if (data.type === 'interrupted') {
          // Gemini detected interruption -> stop playing immediately
          if (streamerRef.current) {
            streamerRef.current.interrupt();
          }
          setMicState((prev) =>
            streamerRef.current?.isCapturingAudio() ? 'listening' : prev === 'speaking' ? 'idle' : prev
          );
        } else if (data.type === 'turn_complete') {
          // Model finished generating speech turn — new turn boundary so the
          // NEXT answer starts a fresh bubble instead of extending the old one.
          console.info('[voice] turn_complete: clearing processing state');
          clearWatchdog();
          turnRef.current += 1;
          const turnAtComplete = turnRef.current;
          const audioTotal = audioCountRef.current;
          if (streamerRef.current && !streamerRef.current.isPlaying()) {
            const timing = turnTimingRef.current;
            if (timing?.firstAudioAt !== undefined) {
              const msTotal = Math.round(performance.now() - timing.tSubmit);
              console.info(`[voice] TURN cid=${timing.cid} submit->done=${msTotal}ms`);
              setDiag((prev) => ({ ...prev, latTotalMs: msTotal, audioOut: audioTotal }));
            } else {
              setDiag((prev) => ({ ...prev, audioOut: audioTotal }));
            }
            setMicState(streamerRef.current.isCapturingAudio() ? 'listening' : 'idle');
          } else {
            // Audio still queued: fall back to idle/listening when playback drains.
            const poll = setInterval(() => {
              if (!streamerRef.current || !streamerRef.current.isPlaying() || turnRef.current !== turnAtComplete) {
                clearInterval(poll);
                if (turnRef.current === turnAtComplete) {
                  const timing = turnTimingRef.current;
                  const done = { audioOut: audioCountRef.current } as Record<string, number>;
                  if (timing?.firstAudioAt !== undefined) {
                    const msTotal = Math.round(performance.now() - timing.tSubmit);
                    console.info(`[voice] TURN cid=${timing.cid} submit->done=${msTotal}ms`);
                    done.latTotalMs = msTotal;
                  }
                  setDiag((prev) => ({ ...prev, ...done }));
                  setMicState(streamerRef.current?.isCapturingAudio() ? 'listening' : 'idle');
                }
              }
            }, 300);
            setTimeout(() => clearInterval(poll), 30000);
          }
        } else if (data.type === 'transcript') {
          const turnId = turnRef.current;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.sender === (data.sender || 'ai') &&
              last.id !== 'welcome' &&
              (last as any).turnId === turnId
            ) {
              const updated = [...prev];
              const spacer = last.text.endsWith(' ') || data.text.startsWith(' ') ? '' : ' ';
              updated[updated.length - 1] = {
                ...last,
                text: `${last.text}${spacer}${data.text}`,
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: `msg-${Date.now()}-${Math.random()}`,
                sender: data.sender || 'ai',
                text: data.text,
                time: now,
                turnId,
              } as Message & { turnId: number },
            ];
          });
        } else if (data.type === 'tool_call') {
          const toolName = data.name;
          const result = data.result;

          if (toolName === 'create_order_draft' && result.status === 'success') {
            setActiveDraft(result);
            setMessages((prev) => [
              ...prev,
              {
                id: `tool-${Date.now()}`,
                sender: 'system',
                text: `📋 Draft Created: ${result.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')} (Total: ₹${result.grand_total})`,
                time: now,
                orderDraft: result,
              },
            ]);
          } else if (toolName === 'confirm_order' && result.status === 'success') {
            setActiveDraft(null);
            setMessages((prev) => [
              ...prev,
              {
                id: `tool-${Date.now()}`,
                sender: 'system',
                text: `✅ Order #${result.order_id} Confirmed & Sent to Kitchen! (Total: ₹${result.total_inr})`,
                time: now,
                confirmedOrder: result,
              },
            ]);
            if (onOrderPlacedRef.current) onOrderPlacedRef.current();
            if (onCallLoggedRef.current) onCallLoggedRef.current();
          } else if (toolName === 'get_menu') {
            setMessages((prev) => [
              ...prev,
              {
                id: `tool-${Date.now()}`,
                sender: 'system',
                text: `📖 Retrieved live menu (${result.total_available} dishes available from SQLite database).`,
                time: now,
              },
            ]);
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      if (mySeq !== sessionSeqRef.current) return;
      connectingRef.current = false;
      console.error('WebSocket error:', err);
      clearWatchdog();
      try { streamerRef.current?.stopRecording(); } catch { /* ignore */ }
      setWsConnected(false);
      setErrorMessage('WebSocket connection error. Check backend server.');
      setMicState('error');
    };

    ws.onclose = () => {
      if (mySeq !== sessionSeqRef.current) return;
      connectingRef.current = false;
      console.info(`[voice] ws close seq=${mySeq}`);
      clearWatchdog();
      try { streamerRef.current?.stopRecording(); } catch { /* ignore */ }
      setWsConnected(false);
      // Functional update: no micState in closure, avoids reconnect loop.
      setMicState((prev) => (prev === 'listening' ? 'idle' : prev));
    };
  }, [callerName, callerPhone, clearWatchdog]);

  // Connect on modal open; teardown closes the WS so no orphan session replays.
  useEffect(() => {
    if (isOpen) {
      // Pre-warm playback context on user gesture: first AI reply starts fast.
      try {
        streamerRef.current?.warmup();
      } catch {
        // ignore
      }
      connectWebSocket();
    } else {
      connectingRef.current = false;
      sessionSeqRef.current += 1; // invalidate any in-flight socket
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (streamerRef.current) {
        streamerRef.current.close();
        streamerRef.current = null;
      }
      setMicState('idle');
      setIsCallActive(true);
      setCallDuration(0);
    }
    return () => {
      // StrictMode remount safety: close WS created by the abandoned mount.
      connectingRef.current = false;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (streamerRef.current) {
        streamerRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Manual reconnect: invalidate old session first so its late greeting/audio
  // can never leak into the new conversation.
  const handleReconnect = useCallback(() => {
    connectingRef.current = false;
    sessionSeqRef.current += 1;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    greetingHeardRef.current = false;
    connectWebSocket();
  }, [connectWebSocket]);

  // Initialize AudioStreamer
  useEffect(() => {
    if (!streamerRef.current) {
      streamerRef.current = new AudioStreamer(
        (base64Pcm: string) => {
          // Batched ~150-200ms true-16kHz PCM frames from the streamer.
          if (sendWs({ type: 'audio', data: base64Pcm })) {
            const st = streamerRef.current?.getMicStats();
            if (st) {
              setDiag((prev) => ({ ...prev, chunksSent: st.chunksSent, nativeRate: st.nativeRate }));
            }
          }
        },
        (isSpeaking: boolean) => {
          // AI playback started/stopped. Only return to "listening" if the mic
          // is actually still capturing; otherwise go idle so the next
          // "Start Live Voice" press really starts recording.
          if (isSpeaking) {
            greetingHeardRef.current = true;
            setMicState('speaking');
          } else {
            setMicState((prev) => {
              if (prev !== 'speaking') return prev;
              return streamerRef.current?.isCapturingAudio() ? 'listening' : 'idle';
            });
          }
        },
        (micError: string) => {
          console.error('[voice] mic error:', micError);
          setErrorMessage(micError);
          setMicState('error');
        }
      );
    }
  }, [sendWs]);

  // Toggle Microphone capture
  const handleToggleMic = async () => {
    if (!wsConnected || !wsRef.current) {
      setErrorMessage('WebSocket is disconnected. Reconnecting...');
      handleReconnect();
      return;
    }

    if (micState === 'listening') {
      // Stop listening: flush mic tail, signal end-of-turn, wait for reply.
      const cid = `vox-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      console.info(`[voice] mic stop cid=${cid}: ending voice turn`);
      if (streamerRef.current) {
        streamerRef.current.stopRecording();
      }
      sendWs({ type: 'audio_end', cid });
      turnTimingRef.current = { cid, tSubmit: performance.now(), kind: 'voice' };
      try {
        const mt = streamerRef.current?.getMicTimings();
        if (mt && mt.recStart) {
          console.info(
            `[voice] VTIME cid=${cid} rec->first_frame=${Math.round(mt.firstFrame - mt.recStart)}ms ` +
            `first_frame->first_sent=${Math.round(mt.firstFlush - mt.firstFrame)}ms ` +
            `speech->end_signal=${Math.round(performance.now() - mt.recStart)}ms`
          );
        }
      } catch {
        // ignore — timing is best-effort
      }
      setMicState('processing');
      armWatchdog(cid);
    } else {
      // Start listening (also from speaking/idle/processing/error).
      // If AI audio is still playing, interrupt it first so the new
      // question doesn't get talked over / queued behind stale audio.
      setErrorMessage(null);
      if (streamerRef.current?.isPlaying()) {
        streamerRef.current.interrupt();
      }
      // New user turn boundary for transcript bubbles.
      turnRef.current += 1;
      try {
        streamerRef.current?.resetPlaybackSchedule();
      } catch {
        // ignore
      }
      setMicState('processing');

      try {
        if (!streamerRef.current) {
          throw new Error('AudioStreamer not initialized');
        }
        await streamerRef.current.startRecording();
        setMicState('listening');
      } catch (err: any) {
        console.error('Microphone access error:', err);
        setMicState('error');
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setErrorMessage('Microphone access was denied. Please allow microphone permissions in your browser bar.');
        } else {
          setErrorMessage(`Could not access microphone: ${err.message || 'Check audio hardware'}`);
        }
      }
    }
  };

  // Send text turn (e.g. quick sample query or keyboard).
  // Lifecycle: submit log → safe WS send (cid) → backend ack → Gemini events
  // → turn_complete clears processing. Failures surface as errors; the input
  // clears only after the message is accepted for sending.
  const handleSendText = (textOverride?: string) => {
    const text = (textOverride || inputText).trim();
    if (!text) return;

    const cid = `txt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    console.info(`[voice] submit text cid=${cid} (${text.length} chars)`);
    if (!wsConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error(`[voice] submit blocked cid=${cid}: socket not open`);
      setErrorMessage('Cannot send message: WebSocket is disconnected. Press Reconnect.');
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // New turn so the coming AI answer starts a fresh bubble.
    turnRef.current += 1;
    try {
      streamerRef.current?.resetPlaybackSchedule();
    } catch {
      // ignore
    }

    const accepted = sendWs({ type: 'text', text, cid });
    if (!accepted) {
      setErrorMessage('Cannot send message: WebSocket is disconnected. Press Reconnect.');
      return;
    }
    console.info(`[voice] WS sent text cid=${cid}`);
    setInputText('');
    turnTimingRef.current = { cid, tSubmit: performance.now(), kind: 'text' };

    setMessages((prev) => [
      ...prev,
      {
        id: `cust-${Date.now()}`,
        sender: 'customer',
        text: text,
        time: now,
      },
    ]);

    setMicState('processing');
    armWatchdog(cid);
  };

  // Explicit confirmation button action
  const handleConfirmOrder = () => {
    if (!activeDraft || !wsRef.current) return;
    handleSendText('Yes, I confirm the order. Please place it now.');
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[94vh] max-h-[860px] flex flex-col overflow-hidden text-slate-900">
        
        {/* Call Simulation HUD Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <div className="w-11 h-11 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-600/30">
                <Bot className="w-6 h-6" />
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
                  wsConnected ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'
                }`}
              ></span>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${
                  wsConnected ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  Aura Dining AI Voice Concierge
                </h2>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Gemini Live (gemini-2.5-flash-native-audio-latest)
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span className="text-emerald-400 font-mono font-medium flex items-center gap-1">
                  <PhoneCall className="w-3 h-3 text-emerald-400" />
                  {wsConnected ? `Active Live Stream (${formatDuration(callDuration)})` : 'Disconnected'}
                </span>
                <span>•</span>
                <span>Bilingual: Tamil (தமிழ்) & English</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Mute/Unmute */}
            <button
              onClick={() => setIsAudioMuted(!isAudioMuted)}
              title={isAudioMuted ? 'Unmute AI output' : 'Mute AI output'}
              className={`p-2 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 ${
                isAudioMuted
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {isAudioMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
              <span className="hidden sm:inline text-[11px]">{isAudioMuted ? 'Muted' : 'Audio Live'}</span>
            </button>

            {/* Reconnect button */}
            <button
              onClick={handleReconnect}
              title="Reconnect Gemini Live session (starts a fresh call)"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs transition flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline text-[11px]">Reconnect</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status / Error Diagnostic Banner */}
        {errorMessage && (
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-2.5 flex items-center justify-between text-xs text-rose-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={handleReconnect}
              className="px-2.5 py-1 bg-rose-600 text-white rounded-lg font-medium text-xs hover:bg-rose-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Dev diagnostics: counters only, no audio content or secrets */}
        <div className="bg-slate-900 text-slate-300 px-5 py-1.5 text-[10px] font-mono flex flex-wrap gap-x-3 gap-y-0.5 border-b border-slate-800">
          <span>mic: {diag.chunksSent ?? 0} frames{diag.nativeRate ? ` @${diag.nativeRate}→16kHz` : ''}</span>
          <span>ai audio: {diag.audioOut ?? 0}</span>
          <span>in-tx: {diag.inputTx ?? 0}</span>
          <span>out-tx: {diag.outputTx ?? 0}</span>
          <span>turns: {diag.turns ?? 0}</span>
          <span>interrupts: {diag.interrupts ?? 0}</span>
          <span>tools: {diag.tools ?? 0}</span>
          {diag.latAudioMs !== undefined && <span>1st audio: {diag.latAudioMs}ms</span>}
          {diag.backendAudioMs !== undefined && <span>srv: {diag.backendAudioMs}ms</span>}
          {diag.latTotalMs !== undefined && <span>total: {diag.latTotalMs}ms</span>}
        </div>

        {/* Live Conversation Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/70">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.sender === 'customer'
                  ? 'justify-end'
                  : msg.sender === 'system'
                  ? 'justify-center'
                  : 'justify-start'
              }`}
            >
              {msg.sender === 'ai' && (
                <div className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              {msg.sender === 'system' ? (
                <div className="w-full max-w-lg p-3 rounded-xl bg-slate-900/5 border border-slate-200 text-slate-700 text-xs shadow-sm space-y-2">
                  <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-orange-600" />
                    {msg.text}
                  </p>

                  {/* Render Order Draft Card */}
                  {msg.orderDraft && (
                    <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <ShoppingBag className="w-4 h-4 text-orange-600" />
                          Order Draft #{msg.orderDraft.draft_id}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          Pending Confirmation
                        </span>
                      </div>

                      <div className="space-y-1 text-xs">
                        {msg.orderDraft.items.map((it: any, idx: number) => (
                          <div key={idx} className="flex justify-between text-slate-700">
                            <span>
                              {it.quantity}x {it.name}
                            </span>
                            <span className="font-medium">₹{it.item_total}</span>
                          </div>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-slate-100 space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span>₹{msg.orderDraft.subtotal}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>5% GST:</span>
                          <span>₹{msg.orderDraft.gst_5_percent}</span>
                        </div>
                        {msg.orderDraft.delivery_fee > 0 && (
                          <div className="flex justify-between">
                            <span>Delivery Fee:</span>
                            <span>₹{msg.orderDraft.delivery_fee}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-sm">
                          <span>Grand Total:</span>
                          <span className="text-orange-600">₹{msg.orderDraft.grand_total}</span>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 italic">
                          Speak "Yes, confirm order" or tap:
                        </span>
                        <button
                          onClick={handleConfirmOrder}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Confirm Order (₹{msg.orderDraft.grand_total})</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Render Confirmed Order Card */}
                  {msg.confirmedOrder && (
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-950 text-xs space-y-1.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center gap-1.5 text-emerald-900">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Saved to Kitchen DB: Order #{msg.confirmedOrder.order_id}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                          Confirmed
                        </span>
                      </div>
                      <p className="text-emerald-800">
                        Estimated preparation time: {msg.confirmedOrder.estimated_time}. WhatsApp receipt dispatched.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className={`max-w-[82%] sm:max-w-[75%] rounded-2xl p-3.5 shadow-subtle ${
                    msg.sender === 'customer'
                      ? 'bg-slate-900 text-white rounded-tr-none'
                      : 'bg-white text-slate-900 border border-slate-200/90 rounded-tl-none'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1 text-[11px]">
                    <span
                      className={`font-bold ${
                        msg.sender === 'customer' ? 'text-slate-300' : 'text-orange-600'
                      }`}
                    >
                      {msg.sender === 'customer' ? 'You (Customer)' : 'Aura Dining AI'}
                    </span>
                    <span className="text-[10px] text-slate-400">{msg.time}</span>
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-line font-normal">
                    {msg.text}
                  </p>
                </div>
              )}

              {msg.sender === 'customer' && (
                <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-sm mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Live Audio & Microphone Controller Footer */}
        <div className="bg-white border-t border-slate-200/90 p-4 sm:p-5 flex flex-col gap-3 shrink-0">
          
          {/* Quick Voice Prompt Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap flex items-center gap-1 mr-1">
              <HelpCircle className="w-3.5 h-3.5 text-orange-600" />
              Quick Test Phrases:
            </span>
            {[
              'I want two chicken biryanis',
              'இரண்டு சிக்கன் பிரியாணி வேண்டும்',
              'What food do you have on the menu?',
              'Change the chicken biryani quantity to 3',
              'Yes, please confirm the order',
            ].map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSendText(prompt)}
                disabled={!wsConnected}
                className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200 border border-slate-200 text-slate-700 whitespace-nowrap transition disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Interactive Microphone & State Visualizer */}
          <div className="flex items-center gap-3">
            
            {/* Primary Microphone Action Button */}
            <button
              type="button"
              onClick={handleToggleMic}
              disabled={!wsConnected}
              className={`relative px-5 py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2.5 shrink-0 shadow-lg ${
                micState === 'listening'
                  ? 'bg-rose-600 text-white ring-4 ring-rose-200 animate-pulse'
                  : micState === 'speaking'
                  ? 'bg-emerald-600 text-white ring-4 ring-emerald-200'
                  : micState === 'processing'
                  ? 'bg-amber-600 text-white animate-pulse'
                  : 'bg-orange-600 hover:bg-orange-700 text-white shadow-orange-600/30'
              } disabled:opacity-50`}
            >
              {micState === 'listening' ? (
                <>
                  <MicOff className="w-5 h-5 animate-bounce" />
                  <span>Stop Listening</span>
                </>
              ) : micState === 'speaking' ? (
                <>
                  <Volume2 className="w-5 h-5 animate-pulse" />
                  <span>AI Speaking (Tap to Interrupt)</span>
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  <span>Start Live Voice</span>
                </>
              )}
            </button>

            {/* Text Input Fallback Bar */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                placeholder={
                  micState === 'listening'
                    ? 'Listening live... speak naturally into your microphone...'
                    : 'Or type speech input (e.g. "I want two chicken biryanis")...'
                }
                className="w-full pl-4 pr-11 py-3 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm focus:ring-2 focus:ring-slate-900 focus:bg-white transition"
              />
              <button
                type="button"
                disabled={!inputText.trim() || !wsConnected}
                onClick={() => handleSendText()}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-900 disabled:opacity-30 transition"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Real-time State & Status Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-1 pt-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Mic State:</span>
              <span
                className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px] ${
                  micState === 'listening'
                    ? 'bg-rose-100 text-rose-700 border border-rose-300'
                    : micState === 'speaking'
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                    : micState === 'processing'
                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : micState === 'error'
                    ? 'bg-rose-100 text-rose-700 border border-rose-300'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                {micState === 'listening'
                  ? '🔴 Listening (16kHz PCM Stream)'
                  : micState === 'speaking'
                  ? '🟢 Speaking (24kHz Native Audio)'
                  : micState === 'processing'
                  ? '🟡 Processing Turn / Tool Calls'
                  : micState === 'error'
                  ? '⚠️ Error'
                  : '⚪ Idle'}
              </span>
              <span className="text-slate-400">•</span>
              <span>{connectionMessage}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Tools:</span>
              <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                get_menu • create_order_draft • confirm_order
              </span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
