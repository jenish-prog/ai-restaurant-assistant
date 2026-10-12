import array
import base64
import logging
from typing import Dict, Any, Optional

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

def generate_twilio_stream_twiml(stream_url: str, caller_phone: str = "") -> str:
    """
    Generates TwiML response instructing Twilio Programmable Voice
    to connect the active phone call to our WebSocket Media Stream.
    """
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi" language="en-IN">Welcome to Aura Dining. Connecting you to our AI assistant.</Say>
    <Connect>
        <Stream url="{stream_url}">
            <Parameter name="caller" value="{caller_phone}" />
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
