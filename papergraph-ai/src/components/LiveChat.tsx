"use client";

import { GoogleGenAI, type FunctionCall, type FunctionResponse, type LiveServerMessage, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_FUNCTION_DECLARATIONS, type LiveTokenResponse } from "@/lib/live";
import type { GraphData } from "@/lib/types";

interface LiveToolResult {
  ok: boolean;
  message: string;
  payload?: Record<string, unknown>;
}

interface LiveChatProps {
  graphData: GraphData;
  onAddNode: (label: string, description?: string) => LiveToolResult;
  onAddEdge: (source: string, target: string, relation?: string) => LiveToolResult;
  onHighlightNode: (nodeId: string, color: string) => LiveToolResult;
  onClose: () => void;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "idle" | "error";

const PCM_OUTPUT_SAMPLE_RATE = 24000;
const PCM_INPUT_SAMPLE_RATE = 16000;
const MIC_BUFFER_SIZE = 2048;

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const count = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function float32ToBase64Pcm(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function resampleAudio(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return new Float32Array(input);
  const ratio = srcRate / dstRate;
  const len = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const si = i * ratio;
    const li = Math.floor(si);
    const ri = Math.min(li + 1, input.length - 1);
    const b = si - li;
    out[i] = input[li] * (1 - b) + input[ri] * b;
  }
  return out;
}

function parseSampleRate(mimeType?: string): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : PCM_OUTPUT_SAMPLE_RATE;
}

export default function LiveChat({
  graphData,
  onAddNode,
  onAddEdge,
  onHighlightNode,
  onClose,
}: LiveChatProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const playSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const sessionHandleRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // mute ref — checked synchronously in audio callbacks so they always see the latest value
  const micActiveRef = useRef(false);

  const graphDataRef = useRef(graphData);
  const toolsRef = useRef({ onAddNode, onAddEdge, onHighlightNode });
  useEffect(() => { graphDataRef.current = graphData; }, [graphData]);
  useEffect(() => { toolsRef.current = { onAddNode, onAddEdge, onHighlightNode }; }, [onAddNode, onAddEdge, onHighlightNode]);

  // ─── audio context ────────────────────────────────────────
  // Don't force sampleRate — let browser use native rate (48kHz).
  // We resample mic audio to 16kHz ourselves, and Gemini's output PCM
  // comes at 24kHz which Web Audio handles via createBuffer(rate).

  const getAudioCtx = useCallback(async () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  const clearPlayback = useCallback(() => {
    playSourcesRef.current.forEach(s => { try { s.stop(); } catch { /* ok */ } });
    playSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const playChunk = useCallback(async (b64: string, mime?: string) => {
    // Always allow model audio playback. Mic mute only affects user input.
    const ctx = await getAudioCtx();
    const pcmFloat = base64ToFloat32(b64);
    const rate = parseSampleRate(mime);
    const buf = ctx.createBuffer(1, pcmFloat.length, rate);
    buf.copyToChannel(new Float32Array(pcmFloat), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const t = Math.max(now + 0.02, nextPlayTimeRef.current || now);
    nextPlayTimeRef.current = t + buf.duration;
    playSourcesRef.current.push(src);
    setIsSpeaking(true);
    src.onended = () => {
      playSourcesRef.current = playSourcesRef.current.filter(x => x !== src);
      if (playSourcesRef.current.length === 0) setIsSpeaking(false);
    };
    src.start(t);
  }, [getAudioCtx]);

  // ─── microphone ───────────────────────────────────────────

  const teardownMic = useCallback(() => {
    micProcessorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micGainRef.current?.disconnect();
    micProcessorRef.current = null;
    micSourceRef.current = null;
    micGainRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  }, []);

  const stopMic = useCallback(() => {
    micActiveRef.current = false;
    setIsMicActive(false);
    // signal Gemini that audio stream ended
    try { sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* ok */ }
    teardownMic();
  }, [teardownMic]);

  const startMic = useCallback(async () => {
    if (micStreamRef.current) {
      micActiveRef.current = true;
      setIsMicActive(true);
      return;
    }
    try {
      const ctx = await getAudioCtx();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);
      const silence = ctx.createGain();
      silence.gain.value = 0;

      processor.onaudioprocess = (ev) => {
        // check mute state synchronously via ref — don't send audio when muted
        if (!micActiveRef.current) return;
        const session = sessionRef.current;
        if (!session) return;
        const data = ev.inputBuffer.getChannelData(0);
        const resampled = resampleAudio(data, ctx.sampleRate, PCM_INPUT_SAMPLE_RATE);
        const b64 = float32ToBase64Pcm(resampled);
        try {
          session.sendRealtimeInput({
            audio: { data: b64, mimeType: `audio/pcm;rate=${PCM_INPUT_SAMPLE_RATE}` },
          });
        } catch { /* session closed */ }
      };

      source.connect(processor);
      processor.connect(silence);
      silence.connect(ctx.destination);
      micStreamRef.current = stream;
      micSourceRef.current = source;
      micProcessorRef.current = processor;
      micGainRef.current = silence;
      micActiveRef.current = true;
      setIsMicActive(true);
    } catch (err) {
      micActiveRef.current = false;
      setIsMicActive(false);
      console.error("Mic error:", err);
    }
  }, [getAudioCtx]);

  // ─── handle incoming server messages ──────────────────────

  const handleServerMessageRef = useRef<(msg: LiveServerMessage) => void>(() => {});
  handleServerMessageRef.current = (msg: LiveServerMessage) => {
    const update = msg.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) sessionHandleRef.current = update.newHandle;

    const sc = msg.serverContent;
    if (sc?.interrupted) clearPlayback();

    // audio from model turn
    const parts = sc?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        void playChunk(part.inlineData.data, part.inlineData.mimeType);
      }
    }

    if (sc?.turnComplete) {
      // model finished talking — orb goes back to blue (listening)
    }

    // tool calls
    if (msg.toolCall?.functionCalls?.length) {
      const responses: FunctionResponse[] = msg.toolCall.functionCalls.map((call: FunctionCall) => {
        const args = call.args ?? {};
        const name = call.name || "unknown";
        let result: LiveToolResult;
        switch (name) {
          case "addNode":
            result = toolsRef.current.onAddNode(typeof args.label === "string" ? args.label : "", typeof args.description === "string" ? args.description : undefined);
            break;
          case "addEdge":
            result = toolsRef.current.onAddEdge(typeof args.source === "string" ? args.source : "", typeof args.target === "string" ? args.target : "", typeof args.relation === "string" ? args.relation : undefined);
            break;
          case "highlightNode":
            result = toolsRef.current.onHighlightNode(typeof args.nodeId === "string" ? args.nodeId : "", typeof args.color === "string" ? args.color : "");
            break;
          default:
            result = { ok: false, message: `Unknown tool "${name}".` };
        }
        return {
          id: call.id,
          name,
          response: result.ok
            ? { output: { ok: true, message: result.message, ...(result.payload || {}) } }
            : { error: result.message },
        };
      });
      try { sessionRef.current?.sendToolResponse({ functionResponses: responses }); } catch { /* ok */ }
    }
  };

  // ─── connect to Gemini Live ───────────────────────────────

  const connectLive = useCallback(async () => {
    if (!mountedRef.current) return;
    setConnectionState("connecting");

    try {
      const resp = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphData: graphDataRef.current }),
      });
      const payload = await resp.json().catch(() => null) as
        | (LiveTokenResponse & { error?: never })
        | { error?: string }
        | null;
      if (!resp.ok) throw new Error((payload as { error?: string })?.error || "Token request failed.");
      if (!payload || !("token" in payload)) throw new Error("Bad token response.");
      if (!mountedRef.current) return;

      const ai = new GoogleGenAI({ apiKey: payload.token, httpOptions: { apiVersion: "v1alpha" } });

      const session = await ai.live.connect({
        model: payload.model,
        config: {
          sessionResumption: sessionHandleRef.current ? { handle: sessionHandleRef.current } : {},
          tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }],
        },
        callbacks: {
          onopen: () => {
            if (!mountedRef.current) return;
            setConnectionState("connected");
            // auto-start mic — user gesture already happened by clicking "Explain And Listen"
            void startMic();
          },
          onmessage: (msg) => handleServerMessageRef.current(msg),
          onerror: (event) => {
            if (!mountedRef.current) return;
            const errMsg = (event as { message?: string }).message || "Connection error.";
            setConnectionState("error");
            console.error("Live error:", errMsg);
          },
          onclose: () => {
            sessionRef.current = null;
            if (!mountedRef.current) return;
            setConnectionState("idle");
          },
        },
      });

      if (!mountedRef.current) { try { session.close(); } catch { /* ok */ } return; }
      sessionRef.current = session;
    } catch (err) {
      if (!mountedRef.current) return;
      setConnectionState("error");
      console.error("Live connect failed:", err);
    }
  }, [startMic]);

  // ─── lifecycle ────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      await getAudioCtx();
      await connectLive();
    };
    void init();

    return () => {
      mountedRef.current = false;
      micActiveRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      try { session?.close(); } catch { /* ok */ }
      teardownMic();
      if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── user actions ─────────────────────────────────────────

  const toggleMic = useCallback(() => {
    if (isMicActive) {
      stopMic();
    } else {
      void startMic();
    }
  }, [isMicActive, startMic, stopMic]);

  const handleReconnect = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    try { session?.close(); } catch { /* ok */ }
    micActiveRef.current = false;
    teardownMic();
    setIsMicActive(false);
    void connectLive();
  }, [connectLive, teardownMic]);

  const handleClose = useCallback(() => {
    mountedRef.current = false;
    micActiveRef.current = false;
    teardownMic();
    setIsMicActive(false);
    clearPlayback();
    const session = sessionRef.current;
    sessionRef.current = null;
    try { session?.close(); } catch { /* ok */ }
    onClose();
  }, [onClose, teardownMic, clearPlayback]);

  // ─── derived state ────────────────────────────────────────

  const canSend = connectionState === "connected";
  const isActive = canSend && isMicActive;
  const isLoading = connectionState === "connecting" || connectionState === "reconnecting";
  const hasError = connectionState === "error";

  // ─── Render ───────────────────────────────────────────────
  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-800/60 bg-gray-950">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <div className="relative">
          <div className={`live-orb-glow ${isSpeaking ? "live-orb-speaking" : isActive ? "live-orb-active" : isLoading ? "live-orb-loading" : ""}`} />
          <button
            type="button"
            onClick={canSend ? toggleMic : undefined}
            disabled={!canSend}
            className={`relative z-10 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all duration-300 ${
              isSpeaking
                ? "border-amber-400/50 bg-gradient-to-b from-amber-500/20 to-orange-600/20 shadow-[0_0_50px_rgba(251,191,36,0.2)]"
                : isActive
                ? "border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-blue-600/20 shadow-[0_0_50px_rgba(34,211,238,0.2)]"
                : "border-gray-700 bg-gray-900 hover:border-gray-600"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            aria-label={isMicActive ? "Mute microphone" : "Unmute microphone"}
          >
            {isSpeaking ? (
              <div className="flex items-center gap-[3px]">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="live-bar w-[3px] rounded-full bg-amber-400"
                    style={{ animationDelay: `${i * 0.08}s`, height: i === 3 ? "26px" : i === 2 || i === 4 ? "18px" : "12px" }} />
                ))}
              </div>
            ) : isMicActive ? (
              <div className="flex items-center gap-[3px]">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="live-bar w-[3px] rounded-full bg-cyan-400"
                    style={{ animationDelay: `${i * 0.1}s`, height: i === 3 ? "24px" : i === 2 || i === 4 ? "16px" : "10px" }} />
                ))}
              </div>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                <path d="M19 10a7 7 0 0 1-14 0" />
                <path d="M12 19v3" />
                <path d="M8 22h8" />
              </svg>
            )}
          </button>
        </div>

        <p className={`text-sm font-medium ${
          isSpeaking ? "text-amber-300"
          : isActive ? "text-cyan-300"
          : isLoading ? "text-gray-400 animate-pulse"
          : hasError ? "text-red-300"
          : "text-gray-500"
        }`}>
          {isSpeaking ? "Gemini speaking..." : isActive ? "Listening..." : isLoading ? "Connecting..." : hasError ? "Disconnected" : canSend ? "Muted" : "Idle"}
        </p>

        {hasError && (
          <button type="button" onClick={handleReconnect}
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            Tap to reconnect
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-gray-800/50 px-4 py-3">
        {canSend && (
          <button
            type="button"
            onClick={toggleMic}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium transition-colors ${
              isMicActive
                ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
          >
            {isMicActive ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                  <path d="M19 10a7 7 0 0 1-14 0" />
                </svg>
                Mute
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 10" />
                </svg>
                Unmute
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="flex items-center gap-1.5 rounded-xl bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
          End
        </button>
      </div>
    </section>
  );
}
