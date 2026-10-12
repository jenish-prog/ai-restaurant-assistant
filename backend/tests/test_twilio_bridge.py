"""Twilio phone-call path tests (stdlib only, no network/credentials).

Run:  venv/bin/python -m unittest discover -s tests -v
Covers:
  - mu-law <-> PCM transcoder math (lengths, ranges, roundtrip energy)
  - TwiML generation (stream URL, caller, call sid)
  - TwilioCallBridge lifecycle: start -> media -> stop, greeting once,
    unknown events ignored, media-before-start dropped, call summary logged
"""
import array
import asyncio
import base64
import math
import unittest

from services.telephony_bridge import (
    MULAW_TO_PCM16,
    mulaw8k_to_pcm16k,
    pcm24k_to_mulaw8k,
    generate_twilio_stream_twiml,
    format_twilio_media_event,
    format_twilio_clear_event,
    mask_phone,
    TwilioCallBridge,
)


def sine_pcm16_8k(n=160, freq=440, amp=12000):
    out = array.array('h')
    for t in range(n):
        out.append(int(amp * math.sin(2 * math.pi * freq * t / 8000)))
    return out.tobytes()


class FakePhoneSession:
    """Records what the bridge forwards (no buffering, no Gemini)."""

    def __init__(self, caller_phone="", caller_name="", **cbs):
        self.caller_phone = caller_phone
        self.cbs = cbs
        self.is_active = True
        self.last_error = None
        self.transcript_history = [("ai", "Welcome"), ("customer", "two biryanis")]
        self.started = False
        self.greeted = 0
        self.audio_chunks = []
        self.close_sources = []

    async def start(self):
        self.started = True
        return True

    async def send_greeting_once(self):
        self.greeted += 1
        return True

    async def send_audio_chunk(self, data: bytes):
        self.audio_chunks.append(bytes(data))

    async def close(self, source="close()"):
        self.is_active = False
        self.close_sources.append(source)


class TestTranscoders(unittest.TestCase):
    def test_mulaw_table_full_range(self):
        self.assertEqual(len(MULAW_TO_PCM16), 256)
        self.assertTrue(all(-32768 <= s <= 32767 for s in MULAW_TO_PCM16))

    def test_uplink_upsample_math(self):
        mulaw = bytes(range(256))[:160]  # one 20ms Twilio frame
        pcm = mulaw8k_to_pcm16k(mulaw)
        self.assertEqual(len(pcm), 160 * 2 * 2)  # 2x samples, 2 bytes each
        samples = array.array('h', pcm)
        self.assertEqual(len(samples), 320)
        self.assertTrue(all(-32768 <= s <= 32767 for s in samples))

    def test_downlink_decimation_math(self):
        pcm24k = sine_pcm16_8k(480)  # 480 samples stand-in
        mulaw = pcm24k_to_mulaw8k(pcm24k)
        self.assertEqual(len(mulaw), 160)  # 3:1 decimation

    def test_roundtrip_preserves_energy(self):
        from services.telephony_bridge import _pcm16_sample_to_mulaw
        pcm = sine_pcm16_8k(800)
        mulaw = bytes(_pcm16_sample_to_mulaw(s) for s in array.array('h', pcm))
        back = array.array('h', mulaw8k_to_pcm16k(mulaw))
        # mulaw8k_to_pcm16k doubles samples; compare against doubled original
        orig = array.array('h', pcm)
        doubled = array.array('h')
        for s in orig:
            doubled.append(s)
            doubled.append(s)
        rms = lambda xs: math.sqrt(sum(x * x for x in xs) / len(xs))
        self.assertLess(abs(rms(back) - rms(doubled)) / rms(doubled), 0.30)

    def test_mask_phone(self):
        self.assertEqual(mask_phone("+917845742951"), "+917...51")
        self.assertEqual(mask_phone(""), "unknown")


class TestTwiml(unittest.TestCase):
    def test_stream_twiml(self):
        twiml = generate_twilio_stream_twiml(
            "wss://example.ngrok.io/api/voice/twilio-stream",
            caller_phone="+911234567890",
            call_sid="CA123",
        )
        self.assertIn("<Stream", twiml)
        self.assertIn("wss://example.ngrok.io/api/voice/twilio-stream", twiml)
        self.assertIn("+911234567890", twiml)
        self.assertIn("CA123", twiml)

    def test_media_and_clear_events(self):
        ev = format_twilio_media_event(b"\x00\x01" * 80, "MZ123")
        self.assertEqual(ev["event"], "media")
        self.assertEqual(ev["streamSid"], "MZ123")
        base64.b64decode(ev["media"]["payload"])  # must be valid b64
        clr = format_twilio_clear_event("MZ123")
        self.assertEqual(clr, {"event": "clear", "streamSid": "MZ123"})


class TestBridgeLifecycle(unittest.IsolatedAsyncioTestCase):
    def make_bridge(self, **kw):
        sent = []
        sessions = []

        def factory(caller_phone="", caller_name="", **cbs):
            s = FakePhoneSession(caller_phone, caller_name, **cbs)
            sessions.append(s)
            return s

        ended = []

        async def on_end(summary):
            ended.append(summary)

        async def send_json(obj):
            sent.append(obj)

        bridge = TwilioCallBridge(send_json=send_json, session_factory=factory, on_call_end=on_end)
        return bridge, sent, sessions, ended

    async def test_full_call_flow(self):
        bridge, sent, sessions, ended = self.make_bridge()
        self.assertEqual(await bridge.handle_message({"event": "connected"}), "connected")
        # media before start is dropped, never crashes
        self.assertEqual(
            await bridge.handle_message({"event": "media", "media": {"payload": base64.b64encode(b"\xff" * 160).decode()}}),
            "dropped",
        )
        self.assertEqual(
            await bridge.handle_message({
                "event": "start", "streamSid": "MZ1",
                "start": {"customParameters": {"caller_phone": "+911234567890", "call_sid": "CA1"}},
            }),
            "start",
        )
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].greeted, 1)
        self.assertEqual(sessions[0].caller_phone, "+911234567890")
        # one 20ms Twilio frame -> 640B PCM16@16k forwarded
        payload = base64.b64encode(bytes(range(256))[:160]).decode()
        self.assertEqual(
            await bridge.handle_message({"event": "media", "media": {"payload": payload}}), "media")
        self.assertEqual(len(sessions[0].audio_chunks), 1)
        self.assertEqual(len(sessions[0].audio_chunks[0]), 640)
        # Gemini audio back out -> Twilio media event
        await bridge._on_gemini_audio(sine_pcm16_8k(480))
        self.assertEqual(sent[-1]["event"], "media")
        self.assertEqual(sent[-1]["streamSid"], "MZ1")
        # interruption -> clear event so queued playback stops
        await bridge._on_interrupted()
        self.assertEqual(sent[-1], {"event": "clear", "streamSid": "MZ1"})
        # hangup -> exactly one summary, session closed with source
        self.assertEqual(await bridge.handle_message({"event": "stop"}), "stop")
        self.assertEqual(len(ended), 1)
        self.assertEqual(ended[0]["caller_phone"], "+911234567890")
        self.assertEqual(ended[0]["status"], "completed")
        self.assertIn("two biryanis", ended[0]["transcript_summary"])
        self.assertEqual(sessions[0].close_sources, ["twilio_twilio_stop"])
        # double close is a no-op (no duplicate call records)
        await bridge.close(reason="again")
        self.assertEqual(len(ended), 1)

    async def test_confirm_captured_in_summary(self):
        bridge, sent, sessions, ended = self.make_bridge()
        await bridge.handle_message({
            "event": "start", "streamSid": "MZ2",
            "start": {"customParameters": {"caller_phone": "+911111111111", "call_sid": "CA2"}},
        })
        await bridge._on_tool_call("confirm_order", {}, {"status": "success", "order_id": "ORD-999"})
        await bridge.handle_message({"event": "stop"})
        self.assertEqual(ended[0]["order_id"], "ORD-999")
        self.assertEqual(ended[0]["sentiment"], "positive")

    async def test_unknown_and_mark_ignored(self):
        bridge, sent, sessions, ended = self.make_bridge()
        self.assertEqual(await bridge.handle_message({"event": "mark"}), "mark")
        self.assertEqual(await bridge.handle_message({"event": "weird"}), "ignored")
        self.assertEqual(await bridge.handle_message("not-a-dict"), "ignored")
        self.assertEqual(sessions, [])


if __name__ == "__main__":
    unittest.main()
