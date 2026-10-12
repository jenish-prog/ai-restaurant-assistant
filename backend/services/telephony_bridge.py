import array
import asyncio
import base64
import logging
import time
from typing import Dict, Any, Optional, Callable, Awaitable

logger = logging.getLogger("telephony_bridge")

# ----------------- G.711 mu-law (PCMU) Transcoder -----------------
# Built-in lookup table: 8-bit mu-law to 16-bit linear PCM
MULAW_TO_PCM16 = array.array('h', [0] * 256)
for i in range(256):
    val = ~i
    sign = val & 0x80
    exponent = (val >> 4) & 0x07
    mantissa = val & 0x0F
    sample = ((mantissa << 3) + 0x84) << exponent
    sample -= 0x84
    MULAW_TO_PCM16[i] = -sample if sign != 0 else sample

CLIP = 32635
BIAS = 0x84

def _pcm16_sample_to_mulaw(sample: int) -> int:
    """Encodes a single 16-bit linear PCM sample (-32768..32767) into 8-bit mu-law."""
    sign = (sample >> 8) & 0x80
    if sign:
        sample = -sample
    if sample > CLIP:
        sample = CLIP
    sample += BIAS
    exponent = 7
    for exp in range(7, -1, -1):
        if sample & (1 << (exp + 7)):
            exponent = exp
            break
    mantissa = (sample >> (exponent + 3)) & 0x0F
    return ~(sign | (exponent << 4) | mantissa) & 0xFF

def mulaw8k_to_pcm16k(mulaw_bytes: bytes) -> bytes:
    """
    Converts 8kHz 8-bit mu-law telephony audio to 16kHz 16-bit Linear PCM audio
    required by Google Gemini Live API. (2x linear repeat interpolation)
    """
    out = array.array('h')
    for b in mulaw_bytes:
        s = MULAW_TO_PCM16[b]
        out.append(s)
        out.append(s)
    return out.tobytes()

def pcm24k_to_mulaw8k(pcm_bytes: bytes) -> bytes:
    """
    Converts 24kHz 16-bit Linear PCM audio from Gemini Live to 8kHz 8-bit mu-law
    telephony audio for phone speaker playback. (3:1 decimation)
    """
    pcm_samples = array.array('h')
    # Guard against uneven byte length
    usable_len = (len(pcm_bytes) // 2) * 2
    pcm_samples.frombytes(pcm_bytes[:usable_len])
    
    # 3:1 decimation
    downsampled = pcm_samples[::3]
    out = bytearray(len(downsampled))
    for idx, s in enumerate(downsampled):
        out[idx] = _pcm16_sample_to_mulaw(s)
    return bytes(out)

# ----------------- Twilio TwiML & Event Helpers -----------------

def generate_twilio_stream_twiml(
    stream_url: str,
    caller_phone: str = "",
    call_sid: str = "",
) -> str:
    """
    Generates TwiML response instructing Twilio Programmable Voice
    to connect the active phone call to our WebSocket Media Stream.
    Caller identity rides along as <Parameter>s (Twilio does not forward
    From/CallSid inside Media Stream events by itself).
    """
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi" language="en-IN">Welcome to Aura Dining. Connecting you to our AI assistant.</Say>
    <Connect>
        <Stream url="{stream_url}">
            <Parameter name="caller_phone" value="{caller_phone}" />
            <Parameter name="caller" value="{caller_phone}" />
            <Parameter name="call_sid" value="{call_sid}" />
        </Stream>
    </Connect>
</Response>"""

def parse_twilio_media_chunk(payload_b64: str) -> bytes:
    """Decodes base64 telephony media payload into raw 8kHz mu-law bytes."""
    return base64.b64decode(payload_b64)

def format_twilio_media_event(mulaw_bytes: bytes, stream_sid: str) -> Dict[str, Any]:
    """Formats 8kHz mu-law bytes into a Twilio Media Stream event message."""
    b64_data = base64.b64encode(mulaw_bytes).decode('ascii')
    return {
        "event": "media",
        "streamSid": stream_sid,
        "media": {
            "payload": b64_data
        }
    }


def format_twilio_clear_event(stream_sid: str) -> Dict[str, Any]:
    """Formats a Twilio `clear` event: drops queued playback (barge-in)."""
    return {"event": "clear", "streamSid": stream_sid}


def mask_phone(phone: str) -> str:
    phone = phone or ""
    return f"{phone[:4]}...{phone[-2:]}" if len(phone) > 6 else (phone or "unknown")


class TwilioCallBridge:
    """One live phone call: Twilio Media Stream <-> Gemini Live session.

    Owns the whole call lifecycle (steps 2-4 of the restaurant call flow):
      Twilio 8kHz mu-law in  -> PCM16 16kHz -> GeminiLiveSession
      Gemini 24kHz PCM out   -> mu-law 8kHz -> Twilio speaker
    Ordering tools, greeting-once, session reuse-per-call and confirmation
    gating all come from the shared GeminiLiveSession (step 3-4). On hangup
    it writes one call record (step 5) via on_call_end (default: DB log).
    """

    def __init__(
        self,
        send_json,
        session_factory=None,
        on_call_end=None,
    ):
        """
        send_json: async callable(dict) -> None, sends to the Twilio socket.
        session_factory: callable(caller_phone, caller_name, **callbacks)
            -> session (defaults to GeminiLiveSession; injectable for tests).
        on_call_end: async callable(summary dict) -> None (defaults to DB log).
        """
        self._send_json = send_json
        self._session_factory = session_factory
        self._on_call_end = on_call_end or self._default_log_call
        self.stream_sid: Optional[str] = None
        self.call_sid: str = ""
        self.caller_phone: str = ""
        self.session = None
        self.started_at: float = 0.0
        self.confirmed_order_id: Optional[str] = None
        self._closed = False

    async def _send(self, obj: Dict[str, Any]):
        try:
            res = self._send_json(obj)
            if asyncio.iscoroutine(res):
                await res
        except Exception as e:
            logger.warning(f"Twilio send failed: {e}")

    async def handle_message(self, msg: Dict[str, Any]) -> str:
        """Routes one Twilio Media Stream event. Returns the event name."""
        if not isinstance(msg, dict):
            return "ignored"
        event = msg.get("event", "")
        if event == "connected":
            logger.info("Twilio media stream connected.")
            return "connected"
        if event == "start":
            return await self._handle_start(msg)
        if event == "media":
            return await self._handle_media(msg)
        if event == "stop":
            await self.close(reason="twilio_stop")
            return "stop"
        if event == "mark":
            return "mark"
        logger.info(f"Ignoring Twilio event: {event!r}")
        return "ignored"

    async def _handle_start(self, msg: Dict[str, Any]) -> str:
        start = msg.get("start", {}) or {}
        params = start.get("customParameters", {}) or {}
        self.stream_sid = msg.get("streamSid") or start.get("streamSid", "")
        self.call_sid = params.get("call_sid", "") or start.get("callSid", "")
        self.caller_phone = params.get("caller_phone", "") or params.get("caller", "")
        self.started_at = time.perf_counter()
        logger.info(
            f"Twilio call started caller={mask_phone(self.caller_phone)} "
            f"call_sid={self.call_sid} stream={self.stream_sid}"
        )

        if self._session_factory is None:
            from services.gemini_live_client import GeminiLiveSession
            self._session_factory = GeminiLiveSession
        self.session = self._session_factory(
            caller_phone=self.caller_phone or "Unknown Caller",
            caller_name="Phone Caller",
            on_audio_out=self._on_gemini_audio,
            on_transcript=self._on_transcript,
            on_tool_call=self._on_tool_call,
            on_interrupted=self._on_interrupted,
            on_turn_complete=self._on_turn_complete,
        )
        started = await self.session.start()
        if not started:
            logger.error(f"Gemini session failed for call {self.call_sid}: {self.session.last_error}")
            await self.close(reason="gemini_start_failed")
            return "start_failed"
        await self.session.send_greeting_once()
        return "start"

    async def _handle_media(self, msg: Dict[str, Any]) -> str:
        if not self.session or not self.session.is_active:
            return "dropped"
        try:
            payload = ((msg.get("media") or {}).get("payload")) or ""
            mulaw = parse_twilio_media_chunk(payload)
        except Exception:
            return "dropped"
        if not mulaw:
            return "dropped"
        try:
            pcm16k = mulaw8k_to_pcm16k(mulaw)
            await self.session.send_audio_chunk(pcm16k)
            return "media"
        except Exception as e:
            logger.warning(f"Twilio media forward failed: {e}")
            return "dropped"

    async def _on_gemini_audio(self, pcm24k_bytes: bytes):
        if not self.stream_sid:
            return
        try:
            mulaw = pcm24k_to_mulaw8k(pcm24k_bytes)
            await self._send(format_twilio_media_event(mulaw, self.stream_sid))
        except Exception:
            pass

    async def _on_transcript(self, sender: str, text: str):
        return None

    async def _on_tool_call(self, name: str, args: dict, result: dict):
        try:
            if name in ("confirm_order", "confirm_and_place_order"):
                if isinstance(result, dict) and result.get("status") == "success":
                    self.confirmed_order_id = result.get("order_id")
        except Exception:
            pass

    async def _on_interrupted(self):
        # Caller barged in: drop Twilio-side queued playback immediately.
        if self.stream_sid:
            await self._send(format_twilio_clear_event(self.stream_sid))

    async def _on_turn_complete(self):
        return None

    def build_summary(self) -> Dict[str, Any]:
        duration = int(time.perf_counter() - self.started_at) if self.started_at else 0
        history = []
        try:
            history = list(getattr(self.session, "transcript_history", []) or [])
        except Exception:
            history = []
        lines = [f"{who}: {tx}" for who, tx in history[-20:]]
        summary_text = " | ".join(lines)[:2000]
        return {
            "caller_phone": self.caller_phone or "Unknown Caller",
            "caller_name": "Phone Caller",
            "call_sid": self.call_sid,
            "duration_seconds": duration,
            "status": "completed",
            "sentiment": "positive" if self.confirmed_order_id else "neutral",
            "transcript_summary": summary_text or "Phone call via Gemini Live AI.",
            "order_id": self.confirmed_order_id,
            "notes": "Twilio phone call via Gemini Live AI voice assistant.",
        }

    async def _default_log_call(self, summary: Dict[str, Any]):
        try:
            from services.ordering_service import log_call_record
            log_call_record(
                caller_phone=summary["caller_phone"],
                caller_name=summary["caller_name"],
                status=summary["status"],
                sentiment=summary["sentiment"],
                transcript_summary=summary["transcript_summary"],
                duration_seconds=summary["duration_seconds"],
                order_id=summary["order_id"],
                notes=summary["notes"],
            )
            logger.info(
                f"Call logged caller={mask_phone(summary['caller_phone'])} "
                f"order={summary['order_id']} duration={summary['duration_seconds']}s"
            )
        except Exception as e:
            logger.error(f"Failed to log Twilio call: {e}")

    async def close(self, reason: str = "closed"):
        if self._closed:
            return
        self._closed = True
        summary = self.build_summary()
        try:
            if self.session:
                await self.session.close(source=f"twilio_{reason}")
        except Exception:
            pass
        try:
            res = self._on_call_end(summary)
            if asyncio.iscoroutine(res):
                await res
        except Exception as e:
            logger.error(f"Call-end hook failed: {e}")
