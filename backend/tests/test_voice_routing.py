"""Voice routing + state-transition tests (stdlib only, no mic/API credentials).

Run:  venv/bin/python -m unittest discover -s tests -v
Covers:
  - main.decode_audio_payload / main.extract_text_turn (pure routing helpers)
  - GeminiLiveSession greeting once-only
  - send_text_prompt success/failure/inactive paths (+diag correlation)
  - mic buffering/framing (25 x 256B -> one 6400B frame)
  - _handle_server_message routing for audio/transcript/turn/tool/interrupt,
    and isolation: one malformed message must not break subsequent ones
"""
import asyncio
import base64
import unittest

from services.gemini_live_client import GeminiLiveSession
from main import decode_audio_payload, extract_text_turn


class FakeLiveSession:
    """Mimics the google-genai AsyncSession surface used by GeminiLiveSession."""

    def __init__(self, fail_text=False, fail_tools=False):
        self.client_contents = []
        self.realtime_frames = []
        self.tool_responses = []
        self.audio_end_calls = 0
        self.fail_text = fail_text
        self.fail_tools = fail_tools

    async def send_client_content(self, turns=None, turn_complete=True):
        if self.fail_text:
            raise RuntimeError("simulated Gemini text failure")
        self.client_contents.append((turns, turn_complete))

    async def send_realtime_input(self, media=None, audio_stream_end=None, **kwargs):
        if media is not None:
            self.realtime_frames.append(bytes(media.data))
        if audio_stream_end:
            self.audio_end_calls += 1

    async def send_tool_response(self, function_responses=None):
        if self.fail_tools:
            raise RuntimeError("simulated tool-response failure")
        self.tool_responses.append(list(function_responses or []))


def make_session(**kw):
    s = GeminiLiveSession(caller_phone="+911234567890", caller_name="Tester")
    fake = FakeLiveSession(**kw)
    s.session = fake
    s.is_active = True
    diags = []
    s.on_diag = lambda payload: diags.append(payload) or asyncio.sleep(0)
    return s, fake, diags


class FakeTx:
    def __init__(self, text):
        self.text = text


class FakePart:
    def __init__(self, audio=None, text=None):
        self.inline_data = type("B", (), {"data": audio})() if audio else None
        self.text = text


class FakeModelTurn:
    def __init__(self, parts):
        self.parts = parts


class FakeServerContent:
    def __init__(self, **kw):
        self.interrupted = kw.get("interrupted", False)
        self.output_transcription = FakeTx(kw["out_tx"]) if kw.get("out_tx") else None
        self.input_transcription = FakeTx(kw["in_tx"]) if kw.get("in_tx") else None
        self.model_turn = kw.get("model_turn")
        self.turn_complete = kw.get("turn_complete", False)


class FakeFnCall:
    def __init__(self, name, args, cid):
        self.name = name
        self.args = args
        self.id = cid


class FakeToolCall:
    def __init__(self, calls):
        self.function_calls = calls


class FakeResponse:
    def __init__(self, server_content=None, tool_call=None):
        self.server_content = server_content
        self.tool_call = tool_call


class TestPureRouting(unittest.TestCase):
    def test_decode_valid(self):
        raw = b"\x01\x02" * 100
        self.assertEqual(decode_audio_payload(base64.b64encode(raw).decode()), raw)

    def test_decode_rejects(self):
        self.assertIsNone(decode_audio_payload(""))
        self.assertIsNone(decode_audio_payload("!!!not-base64!!!"))
        self.assertIsNone(decode_audio_payload(base64.b64encode(b"\x01\x02\x03").decode()))  # odd
        self.assertIsNone(decode_audio_payload(base64.b64encode(b"\x01\x02" * 70000).decode()))  # oversize

    def test_extract_text(self):
        self.assertEqual(extract_text_turn({"type": "text", "text": "  hello  "}), "hello")
        self.assertEqual(extract_text_turn({"type": "text"}), "")
        self.assertEqual(extract_text_turn({"text": 123}), "")
        self.assertEqual(extract_text_turn(None), "")
        self.assertEqual(extract_text_turn("text"), "")


class TestGreetingOnce(unittest.IsolatedAsyncioTestCase):
    async def test_second_greeting_blocked(self):
        s, fake, diags = make_session()
        self.assertTrue(await s.send_greeting_once())
        self.assertFalse(await s.send_greeting_once())
        self.assertEqual(len(fake.client_contents), 1)
        turns, complete = fake.client_contents[0]
        self.assertTrue(complete)
        self.assertIn("Greet", turns["parts"][0]["text"])


class TestSendText(unittest.IsolatedAsyncioTestCase):
    async def test_success_path(self):
        s, fake, diags = make_session()
        self.assertTrue(await s.send_text_prompt("What food do you have?", cid="c1"))
        self.assertEqual(len(fake.client_contents), 1)
        turns, complete = fake.client_contents[0]
        self.assertTrue(complete)
        self.assertEqual(turns["role"], "user")
        events = [d["event"] for d in diags]
        self.assertIn("text_sent", events)

    async def test_failure_path_reports(self):
        s, fake, diags = make_session(fail_text=True)
        self.assertFalse(await s.send_text_prompt("hello", cid="c2"))
        events = [d["event"] for d in diags]
        self.assertIn("text_error", events)

    async def test_inactive_session_reports(self):
        s, fake, diags = make_session()
        s.is_active = False
        self.assertFalse(await s.send_text_prompt("hello", cid="c3"))
        events = [d["event"] for d in diags]
        self.assertIn("text_dropped", events)


class TestBufferFraming(unittest.IsolatedAsyncioTestCase):
    async def test_25_packets_one_frame(self):
        s, fake, _ = make_session()
        pkt = b"\x00\x01" * 128  # 256B
        for _ in range(25):
            await s.send_audio_chunk(pkt)
        self.assertEqual([len(f) for f in fake.realtime_frames], [6400])
        self.assertEqual(s.stats["audio_frames_in"], 25)
        self.assertEqual(s.stats["audio_frames_sent"], 1)

    async def test_end_of_turn_flushes_tail(self):
        s, fake, _ = make_session()
        await s.send_audio_chunk(b"\x00\x01" * 100)  # 200B < flush threshold
        self.assertEqual(fake.realtime_frames, [])
        await s.end_audio_stream()
        self.assertEqual([len(f) for f in fake.realtime_frames], [200])
        self.assertEqual(fake.audio_end_calls, 1)


class TestServerMessageRouting(unittest.IsolatedAsyncioTestCase):
    async def test_audio_transcript_turn_tool_interrupt(self):
        s, fake, diags = make_session()
        events = []
        s.on_audio_out = lambda b: events.append(("audio", len(b))) or asyncio.sleep(0)
        s.on_transcript = lambda who, tx: events.append(("tx", who, tx)) or asyncio.sleep(0)
        s.on_turn_complete = lambda: events.append(("turn",)) or asyncio.sleep(0)
        s.on_tool_call = lambda n, a, r: events.append(("tool", n)) or asyncio.sleep(0)
        s.on_interrupted = lambda: events.append(("intr",)) or asyncio.sleep(0)

        await s._handle_server_message(FakeResponse(FakeServerContent(interrupted=True)))
        await s._handle_server_message(FakeResponse(FakeServerContent(in_tx="two biryanis")))
        await s._handle_server_message(FakeResponse(FakeServerContent(out_tx="Sure")))
        await s._handle_server_message(FakeResponse(
            FakeServerContent(model_turn=FakeModelTurn([FakePart(audio=b"\x01\x02" * 10)]))))
        await s._handle_server_message(FakeResponse(FakeServerContent(turn_complete=True)))

        kinds = [e[0] for e in events]
        for k in ("intr", "tx", "audio", "turn"):
            self.assertIn(k, kinds)
        self.assertEqual(s.stats["input_transcripts"], 1)
        self.assertEqual(s.stats["turn_completes"], 1)
        self.assertEqual(s.stats["interrupts"], 1)

    async def test_tool_call_executes_and_responds(self):
        s, fake, _ = make_session()
        seen = []
        s.on_tool_call = lambda n, a, r: seen.append((n, r.get("status"))) or asyncio.sleep(0)
        resp = FakeResponse(
            server_content=FakeServerContent(),
            tool_call=FakeToolCall([FakeFnCall("get_menu", {}, "id-1")]),
        )
        await s._handle_server_message(resp)
        self.assertEqual(len(fake.tool_responses), 1)
        self.assertEqual(seen[0][0], "get_menu")
        self.assertEqual(s.stats["tool_calls"], 1)

    async def test_tool_response_failure_surfaced(self):
        s, fake, diags = make_session(fail_tools=True)
        resp = FakeResponse(
            server_content=FakeServerContent(),
            tool_call=FakeToolCall([FakeFnCall("get_menu", {}, "id-2")]),
        )
        await s._handle_server_message(resp)  # must not raise
        self.assertIn("tool_response_error", [d["event"] for d in diags])

    async def test_bad_message_isolated(self):
        s, fake, _ = make_session()
        got = []
        s.on_transcript = lambda who, tx: got.append(tx) or asyncio.sleep(0)

        class Exploding:
            @property
            def server_content(self):
                raise RuntimeError("malformed server message")

            @property
            def tool_call(self):
                raise RuntimeError("malformed server message")

        # Simulate the _receive_loop guard: one bad message, then a good one.
        for msg in (Exploding(), FakeResponse(FakeServerContent(out_tx="recovered"))):
            try:
                await s._handle_server_message(msg)
            except Exception:
                pass
        self.assertEqual(got, ["recovered"])


class FakeStreamSession(FakeLiveSession):
    """Mimics SDK semantics: each receive() call drains ONE turn, then returns."""

    def __init__(self, turns, **kw):
        super().__init__(**kw)
        self._turns = list(turns)
        self.receive_calls = 0

    async def receive(self):
        self.receive_calls += 1
        if self._turns:
            for msg in self._turns.pop(0):
                yield msg
        else:
            await asyncio.sleep(3600)  # idle: wait for next turn

    async def close(self):
        return None


class TestMultiTurnKeepalive(unittest.IsolatedAsyncioTestCase):
    async def test_turn_complete_does_not_end_session(self):
        """Regression: greeting turn_complete must NOT close the session."""
        s = GeminiLiveSession(caller_phone="+911234567890", caller_name="Tester")
        diags = []
        s.on_diag = lambda payload: diags.append(payload) or asyncio.sleep(0)
        s.on_turn_complete = lambda: asyncio.sleep(0)
        fake = FakeStreamSession([
            [FakeResponse(FakeServerContent(out_tx="Welcome", turn_complete=True))],
            [FakeResponse(FakeServerContent(out_tx="Here is the menu", turn_complete=True))],
        ])
        s.session = fake
        s.is_active = True
        task = asyncio.create_task(s._receive_loop())
        try:
            for _ in range(100):
                if s.stats["turn_completes"] >= 2:
                    break
                await asyncio.sleep(0.05)
            self.assertEqual(s.stats["turn_completes"], 2)
            self.assertGreaterEqual(fake.receive_calls, 2)
            self.assertTrue(s.is_active, "session must stay alive across turns")
            events = [d["event"] for d in diags]
            self.assertNotIn("session_closed_unexpectedly", events)
        finally:
            await s.close(source="test")
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def test_empty_stream_gives_up_with_error(self):
        class EmptySession(FakeLiveSession):
            def __init__(self):
                super().__init__()
                self.calls = 0

            async def receive(self):
                self.calls += 1
                return
                yield  # pragma: no cover - makes this an async generator

            async def close(self):
                return None

        s = GeminiLiveSession(caller_phone="+911234567890", caller_name="Tester")
        diags = []
        s.on_diag = lambda payload: diags.append(payload) or asyncio.sleep(0)
        fake = EmptySession()
        s.session = fake
        s.is_active = True
        await asyncio.wait_for(s._receive_loop(), timeout=10)
        self.assertFalse(s.is_active)
        events = [d["event"] for d in diags]
        self.assertIn("session_error", events)

    async def test_close_source_recorded(self):
        s, fake, _ = make_session()
        s._cm = None
        fake.close = lambda: asyncio.sleep(0)
        await s.close(source="browser_ws_closed")
        self.assertEqual(s._close_source, "browser_ws_closed")
        self.assertFalse(s.is_active)


if __name__ == "__main__":
    unittest.main()
