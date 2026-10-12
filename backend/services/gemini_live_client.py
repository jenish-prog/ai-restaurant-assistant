import os
import json
import asyncio
import logging
from typing import Dict, Any, Optional, Callable, Awaitable
from dotenv import load_dotenv
from google.genai import types
import google.genai as genai

from services.ordering_service import (
    get_live_menu,
    create_or_update_order_draft,
    calculate_order_total,
    confirm_and_place_order,
    log_call_record,
)
from services.whatsapp_service import send_whatsapp_order_confirmation

logger = logging.getLogger("gemini_live_client")

def get_gemini_api_key() -> str:
    load_dotenv(override=True)
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""

def get_model_id() -> str:
    load_dotenv(override=True)
    return os.getenv("GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-latest").strip()

SYSTEM_INSTRUCTION = """
You are the elite AI Voice Ordering Assistant for "Aura Dining & Kitchen" (Phone: +91 7845742951), an upscale restaurant in India.
Your voice is warm, natural, courteous, friendly, and efficient.

CORE PRINCIPLES & INSTRUCTIONS:
1. GREETING — EXACTLY ONCE PER CALL:
   - Greet ONLY in your very first spoken turn of the call, then NEVER greet again.
   - First-turn English greeting: "Welcome to Aura Dining! I am your AI ordering assistant. How may I help you today?"
   - First-turn Tamil greeting: "வணக்கம்! Aura Dining-க்கு வரவேற்கிறோம். நான் உங்கள் AI ஆர்டர் உதவியாளர். இன்று உங்களுக்கு என்ன உணவு வேண்டும்?"
   - From the second turn on, answer directly with NO greeting, NO self-introduction, NO "welcome" repetition.

2. BILINGUAL FLUENCY (TAMIL & ENGLISH):
   - You are fully fluent in Tamil, English, and Tanglish.
   - Automatically detect the customer's language. If they speak in Tamil, respond in clear, polite, natural Tamil.
   - If they speak English, respond in English. If they mix Tamil and English, adapt naturally.

3. REAL-TIME MENU TOOLS (NEVER FABRICATE PRICES OR DISHES):
   - When asked about available food, specials, or prices, call the `get_menu` tool.
   - All prices are strictly in Indian Rupees (₹ / INR).
   - If an item is unavailable or out of stock (e.g. Crispy Calamari Fritti), explain politely that it is sold out and recommend an alternative.

4. MANDATORY TOOL INVOCATION FOR ORDERS:
   - Whenever the caller requests food or items (e.g., "I want two chicken biryanis", "add a butter chicken"), YOU MUST ALWAYS CALL `create_order_draft` with the items immediately in the same turn. Do not merely verbally acknowledge; ALWAYS invoke `create_order_draft` so the backend computes the official price and 5% GST.
   - When `create_order_draft` returns the result, read back ONLY items with quantities and the grand total in Rupees (₹), then ask for confirmation.
   - If the caller changes the quantity or adds/removes items (e.g. "make that three chicken biryanis instead"), immediately call `create_order_draft` again with the new list of items, read the updated total, and ask for confirmation again.

5. MANDATORY EXPLICIT CONFIRMATION BEFORE PLACING ORDER:
   - NEVER call `confirm_order` unless the caller has explicitly said "Yes", "Confirm", "சரி", "ஆமா", "Proceed", or "Place the order".
   - Under no circumstances should an order be marked placed without calling `confirm_order` and receiving a success response.
   - Once `confirm_order` returns status "success" with an order ID (e.g., ORD-106), tell the caller their order number and estimated preparation time.

6. CONCISE, PHONE-FAST REPLIES (1-2 SENTENCES):
   - Answer in 1-2 short sentences. No filler, no introductions after the greeting, no narrating tools or processing.
   - Menu question: one-line summary from live tool data ("We have biryani, fried rice, dosa, and starters — what would you like?"), details only when asked.
   - One clarification question at a time; never repeat the welcome message.
   - Ordering read-back is essentials only: dish names with quantities + grand total + "Shall I confirm?" Skip subtotal/GST narration unless the caller asks.

7. LISTEN CAREFULLY & STAY ON TOPIC (PHONE-CALL ACCURACY):
   - Listen to the CURRENT user turn only. Never answer a previous question again.
   - If you are unsure what dish the caller named (noisy audio, Tamil/English mix), ALWAYS ask a short clarification ("Sorry, did you mean Chicken Biryani?") instead of guessing another dish.
   - After every tool result, read back the exact dish names and total from the result — never invent items.
   - One question at a time. After placing an order, ask "Anything else?" and wait for the reply.

8. PHONE-CALL SPEED:
   - Start answering as soon as you can; never wait to "say more".
   - Accuracy and explicit order confirmation always outrank speed.
"""

TOOLS_SCHEMA = [{
    'function_declarations': [
        {
            'name': 'get_menu',
            'description': 'Retrieve all live menu items with live Indian Rupee (INR ₹) prices and kitchen availability from restaurant database.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'category': {
                        'type': 'STRING',
                        'description': 'Optional menu category filter: Starters, Mains, Pizzas, Sides, Desserts, Beverages'
                    }
                }
            }
        },
        {
            'name': 'create_order_draft',
            'description': 'Create or update an order draft with requested dishes, validate item availability in DB, calculate 5% GST and delivery fee. Does NOT finalize or save the order.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'items': {
                        'type': 'ARRAY',
                        'description': 'List of menu items requested by caller',
                        'items': {
                            'type': 'OBJECT',
                            'properties': {
                                'name': {'type': 'STRING', 'description': 'Name of dish (e.g. Chicken Biryani, Truffle Mushroom Risotto)'},
                                'quantity': {'type': 'INTEGER', 'description': 'Quantity ordered'}
                            },
                            'required': ['name', 'quantity']
                        }
                    },
                    'order_type': {
                        'type': 'STRING',
                        'description': 'Order type: Delivery, Takeout, or Dine-in (default: Takeout)'
                    },
                    'customer_address': {
                        'type': 'STRING',
                        'description': 'Delivery address if order_type is Delivery'
                    },
                    'notes': {
                        'type': 'STRING',
                        'description': 'Special instructions or notes'
                    }
                },
                'required': ['items']
            }
        },
        {
            'name': 'calculate_order_total',
            'description': 'Calculate or retrieve the itemized breakdown, 5% GST tax, delivery charge, and grand total in INR (₹) for the current order draft.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'draft_id': {'type': 'STRING', 'description': 'The draft ID returned by create_order_draft'}
                },
                'required': ['draft_id']
            }
        },
        {
            'name': 'confirm_order',
            'description': 'Permanently save the confirmed order to the restaurant kitchen database. MUST ONLY be called AFTER the caller has explicitly confirmed the full order draft and total.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'draft_id': {'type': 'STRING', 'description': 'Draft ID returned from create_order_draft'},
                    'customer_confirmed': {'type': 'BOOLEAN', 'description': 'Must be True when customer explicitly says yes, confirm, சரி, or ஆமா'}
                },
                'required': ['draft_id', 'customer_confirmed']
            }
        },
        {
            'name': 'transfer_to_human',
            'description': 'Transfer the customer call to human restaurant staff if requested or if caller is frustrated.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'reason': {'type': 'STRING', 'description': 'Reason for human handoff'}
                },
                'required': ['reason']
            }
        }
    ]
}]

class GeminiLiveSession:
    """
    Manages an active Google Gemini Multimodal Live session over WebSocket.
    Transfers bidirectional audio and executes real-time function calls.
    """
    def __init__(
        self,
        caller_phone: str = "+91 7845742951",
        caller_name: str = "Valued Caller",
        call_id: Optional[str] = None,
        on_audio_out: Optional[Callable[[bytes], Awaitable[None]]] = None,
        on_transcript: Optional[Callable[[str, str], Awaitable[None]]] = None,
        on_tool_call: Optional[Callable[[str, Dict[str, Any], Dict[str, Any]], Awaitable[None]]] = None,
        on_interrupted: Optional[Callable[[], Awaitable[None]]] = None,
        on_turn_complete: Optional[Callable[[], Awaitable[None]]] = None,
        on_diag: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None
    ):
        self.caller_phone = caller_phone
        self.caller_name = caller_name
        self.call_id = call_id
        self.on_audio_out = on_audio_out
        self.on_transcript = on_transcript
        self.on_tool_call = on_tool_call
        self.on_interrupted = on_interrupted
        self.on_turn_complete = on_turn_complete
        self.on_diag = on_diag
        self.session = None
        self.is_active = False
        self.current_draft_id = None
        self._receive_task = None
        self._flush_task = None
        self._close_source: Optional[str] = None  # exact initiator of cleanup
        self.transcript_history = []
        self.last_error = None
        self.greeting_sent = False
        # Batch tiny 8ms mic packets into ~200ms frames before hitting the
        # Gemini API: fewer requests = lower latency + cleaner transcription.
        self._audio_buffer = bytearray()
        self._audio_lock = asyncio.Lock()
        self._flush_bytes = 6400  # 200ms @ 16kHz 16-bit mono
        self._min_partial_bytes = 960  # 30ms — periodic flusher floor
        self._flush_interval = 0.08  # 80ms tail flush
        # Diagnostics counters (no audio content, no secrets).
        self.stats: Dict[str, int] = {
            "audio_frames_in": 0,
            "audio_bytes_in": 0,
            "audio_frames_sent": 0,
            "audio_bytes_sent": 0,
            "audio_chunks_out": 0,
            "input_transcripts": 0,
            "output_transcripts": 0,
            "turn_completes": 0,
            "interrupts": 0,
            "tool_calls": 0,
        }
        # Per-turn latency marks (perf_counter seconds, keyed by cid).
        # t_recv = backend received final input; t_first_event/t_first_audio =
        # first Gemini response/audio for that turn. No text/audio logged.
        self._turn_marks: Dict[str, Dict[str, float]] = {}
        self._active_cid: Optional[str] = None

    def mark_turn_received(self, cid: Optional[str], kind: str = "text"):
        """t1: backend received the finalized turn (text msg or audio_end)."""
        import time as _time
        if not cid:
            return
        now = _time.perf_counter()
        marks: Dict[str, float] = {"t_recv": now, "kind": kind}
        if kind == "voice":
            # First audio byte arrived BEFORE audio_end: carry it over so the
            # voice timeline starts at first byte, not at the end signal.
            pending = self._turn_marks.pop("__voice_audio", None)
            if pending and "t_first" in pending:
                marks["t_audio_first_rx"] = pending["t_first"]
                dt = (now - pending["t_first"]) * 1000
                logger.info(f"VOICE cid={cid} first_byte->end_signal={dt:.0f}ms")
        self._turn_marks[cid] = marks
        self._active_cid = cid

    def note_voice_audio_rx(self):
        """Stamps first audio byte of the in-progress utterance (pre-end-signal)."""
        import time as _time
        e = self._turn_marks.setdefault("__voice_audio", {})
        if "t_first" not in e:
            e["t_first"] = _time.perf_counter()

    async def note_input_transcription(self):
        """Partial (first text) vs final (last text before turn end) timing."""
        import time as _time
        now = _time.perf_counter()
        key = self._active_cid or "__voice_stream"
        m = self._turn_marks.setdefault(key, {})
        if "t_first_in_tx" not in m:
            m["t_first_in_tx"] = now
            base = m.get("t_recv")
            suffix = f" (+{(now - base) * 1000:.0f}ms after recv)" if base else " (streaming, no end signal yet)"
            logger.info(f"VOICE partial transcription first text cid={key}{suffix}")
        m["t_last_in_tx"] = now

    async def _mark_response_event(self, is_audio: bool):
        """t2/t3: first Gemini response event / first audio for active turn."""
        import time as _time
        cid = self._active_cid
        if not cid:
            return
        marks = self._turn_marks.get(cid)
        if not marks:
            return
        now = _time.perf_counter()
        if "t_first_event" not in marks:
            marks["t_first_event"] = now
            dt = (now - marks["t_recv"]) * 1000
            logger.info(f"TURN cid={cid} kind={marks.get('kind')} recv->first_event={dt:.0f}ms")
        if is_audio and "t_first_audio" not in marks:
            marks["t_first_audio"] = now
            dt = (now - marks["t_recv"]) * 1000
            dev = (now - marks["t_first_event"]) * 1000 if "t_first_event" in marks else 0
            logger.info(f"TURN cid={cid} kind={marks.get('kind')} recv->first_audio={dt:.0f}ms (event->audio={dev:.0f}ms)")
            await self._emit_diag("turn_latency", {
                "cid": cid,
                "kind": marks.get("kind"),
                "ms_recv_to_event": round((marks["t_first_event"] - marks["t_recv"]) * 1000),
                "ms_recv_to_audio": round(dt),
            })

    async def _emit_diag(self, event: str, extra: Optional[Dict[str, Any]] = None):
        payload: Dict[str, Any] = {"type": "diag", "event": event, "stats": dict(self.stats)}
        if extra:
            payload.update(extra)
        await self._invoke_cb(self.on_diag, payload)

    async def start(self) -> bool:
        """Initializes and connects the live Gemini session."""
        api_key = get_gemini_api_key()
        if not api_key:
            self.last_error = "GEMINI_API_KEY is not configured in backend/.env"
            logger.warning(self.last_error)
            return False

        model_id = get_model_id()
        logger.info(f"Connecting to Gemini Live API with model: {model_id}...")

        client = genai.Client(
            api_key=api_key,
            http_options={'api_version': 'v1alpha'}
        )

        config = types.LiveConnectConfig(
            response_modalities=['AUDIO'],
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]
            ),
            tools=TOOLS_SCHEMA,
            output_audio_transcription=types.AudioTranscriptionConfig(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            # Phone-call tuning: detect speech start/end fast, let the caller
            # barge in (feels like a real call instead of walkie-talkie).
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                    prefix_padding_ms=100,
                    # 350ms: fast turn-taking while tolerating natural Tamil/
                    # English/Tanglish pauses (measured tradeoff; see TURN logs).
                    silence_duration_ms=350,
                ),
                activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            ),
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
                )
            )
        )

        try:
            # Connect live session via async context manager
            self._cm = client.aio.live.connect(model=model_id, config=config)
            self.session = await self._cm.__aenter__()
            self.is_active = True
            self._close_source = None
            if self._receive_task and not self._receive_task.done():
                logger.warning("Receive task already running; not starting a second reader.")
            else:
                self._receive_task = asyncio.create_task(self._receive_loop())
            if not self._flush_task or self._flush_task.done():
                self._flush_task = asyncio.create_task(self._periodic_flush_loop())
            masked = f"{(self.caller_phone or '')[:4]}...{(self.caller_phone or '')[-2:]}"
            logger.info(f"Gemini Live session OPEN model={model_id} caller={masked}.")
            await self._emit_diag("session_open", {"model": model_id})
            return True
        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Failed to connect Gemini Live session with model {model_id}: {e}")
            self.is_active = False
            return False

    async def send_greeting_once(self) -> bool:
        """Speaks the welcome greeting exactly once per Gemini session.

        Must be called once by the WebSocket handler after connect. Guarded by
        greeting_sent so reconnects/re-renders can never replay it.
        Uses send_client_content (the supported text path for this SDK).
        """
        if self.greeting_sent or not self.is_active or not self.session:
            return False
        self.greeting_sent = True
        try:
            await self.session.send_client_content(
                turns={
                    "role": "user",
                    "parts": [{
                        "text": "Greet the caller briefly as the Aura Dining AI assistant and ask what they would like to order. One greeting only."
                    }],
                },
                turn_complete=True,
            )
            logger.info("Greeting turn sent (once).")
            await self._emit_diag("greeting_sent")
            return True
        except Exception as e:
            logger.error(f"Error sending greeting turn: {e}")
            self.greeting_sent = False
            await self._emit_diag("greeting_error", {"error": str(e)[:200]})
            return False

    async def send_audio_chunk(self, pcm16k_bytes: bytes):
        """Buffers user microphone audio and flushes ~200ms frames to Gemini."""
        if not self.is_active or not self.session:
            return

        self.stats["audio_frames_in"] += 1
        self.stats["audio_bytes_in"] += len(pcm16k_bytes)
        self.note_voice_audio_rx()
        async with self._audio_lock:
            self._audio_buffer.extend(pcm16k_bytes)
            if len(self._audio_buffer) < self._flush_bytes:
                return
            frame = bytes(self._audio_buffer)
            self._audio_buffer.clear()

        try:
            await self.session.send_realtime_input(
                media=types.Blob(
                    data=frame,
                    mime_type="audio/pcm;rate=16000"
                )
            )
            self.stats["audio_frames_sent"] += 1
            self.stats["audio_bytes_sent"] += len(frame)
        except Exception as e:
            logger.error(f"Error streaming audio to Gemini Live: {e}")

    async def _periodic_flush_loop(self):
        """Flushes partial mic tails every 80ms so pauses don't truncate words.

        Without this, audio below _flush_bytes sits buffered while server VAD
        already fires → truncated transcription ("heard another question").
        """
        try:
            while self.is_active:
                await asyncio.sleep(self._flush_interval)
                if not self.is_active or not self.session:
                    break
                async with self._audio_lock:
                    if len(self._audio_buffer) < self._min_partial_bytes:
                        continue
                    frame = bytes(self._audio_buffer)
                    self._audio_buffer.clear()
                try:
                    await self.session.send_realtime_input(
                        media=types.Blob(data=frame, mime_type="audio/pcm;rate=16000")
                    )
                    self.stats["audio_frames_sent"] += 1
                    self.stats["audio_bytes_sent"] += len(frame)
                except Exception as e:
                    logger.error(f"Error in periodic audio flush: {e}")
        except asyncio.CancelledError:
            pass

    async def _flush_audio_buffer(self):
        async with self._audio_lock:
            if not self._audio_buffer:
                return None
            frame = bytes(self._audio_buffer)
            self._audio_buffer.clear()
        return frame

    async def end_audio_stream(self):
        """Flushes leftover mic audio, then notifies Gemini the turn ended."""
        if not self.is_active or not self.session:
            return
        try:
            remainder = await self._flush_audio_buffer()
            if remainder:
                await self.session.send_realtime_input(
                    media=types.Blob(data=remainder, mime_type="audio/pcm;rate=16000")
                )
            await self.session.send_realtime_input(audio_stream_end=True)
        except Exception as e:
            logger.error(f"Error ending audio stream to Gemini Live: {e}")

    async def send_text_prompt(self, text: str, cid: Optional[str] = None) -> bool:
        """Sends a typed user turn via the supported text path.

        Uses send_client_content (not the deprecated session.send). Returns
        True only if Gemini accepted it; failures emit a diag error so the
        frontend never sits in PROCESSING forever. `cid` correlates logs.
        """
        if not self.is_active or not self.session:
            await self._emit_diag("text_dropped", {"cid": cid, "reason": "session_inactive"})
            return False
        tag = f" cid={cid}" if cid else ""
        logger.info(f"Gemini input: text turn ({len(text)} chars){tag}.")
        try:
            self.mark_turn_received(cid, kind="text")
            await self.session.send_client_content(
                turns={"role": "user", "parts": [{"text": text}]},
                turn_complete=True,
            )
            await self._emit_diag("text_sent", {"cid": cid})
            return True
        except Exception as e:
            logger.error(f"Error sending text to Gemini Live{tag}: {e}")
            await self._emit_diag("text_error", {"cid": cid, "error": str(e)[:200]})
            return False

    async def _invoke_cb(self, cb, *args):
        """Safely invokes a callback whether it is an async coroutine or synchronous function."""
        if cb is None:
            return
        try:
            if asyncio.iscoroutinefunction(cb):
                await cb(*args)
            else:
                res = cb(*args)
                if asyncio.iscoroutine(res):
                    await res
        except Exception as e:
            logger.error(f"Error in callback: {e}")

    async def _receive_loop(self):
        """Keeps ONE reader on the Gemini stream for the whole conversation.

        SDK fact (google-genai 2.29.0, live.AsyncSession.receive): the async
        generator RETURNS after each turn-complete / IDLE interaction. A single
        `async for ... receive()` therefore dies after the greeting turn while
        the server-side session is still alive. The supported multi-turn
        pattern is to call receive() again for the next turn — that is what
        the outer `while self.is_active` does here. turn_complete NEVER closes
        the session; only disconnect / error / close() does.
        """
        empty_passes = 0
        try:
            while self.is_active:
                messages = 0
                try:
                    # One receive() call drains exactly one server turn, then
                    # returns. We re-enter below to await the following turn.
                    async for response in self.session.receive():
                        messages += 1
                        empty_passes = 0
                        try:
                            await self._handle_server_message(response)
                        except Exception as e:
                            import traceback
                            logger.error(f"Error handling Gemini Live message: {e}\n{traceback.format_exc()}")
                            await self._emit_diag("message_error", {"error": str(e)[:200]})
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    import traceback
                    logger.error(f"Error in Gemini Live receive loop: {e}\n{traceback.format_exc()}")
                    await self._emit_diag("session_error", {"error": str(e)[:200]})
                    break
                if not self.is_active:
                    break
                if messages == 0:
                    # Generator ended with zero yields: transport likely gone
                    # (a clean turn end always yields >= 1 message first).
                    empty_passes += 1
                    logger.warning(f"Gemini receive() drained empty ({empty_passes}/3).")
                    if empty_passes >= 3:
                        logger.error("Gemini receive stream ended repeatedly with no messages; closing session.")
                        await self._emit_diag("session_error", {"error": "receive stream ended"})
                        break
                    await asyncio.sleep(0.5)
                    continue
                logger.info("Gemini Live: turn drained, session stays open for next turn.")
        except asyncio.CancelledError:
            pass
        finally:
            was_active = self.is_active
            self.is_active = False
            if was_active:
                # Loop died while session was supposed to be alive: unexpected.
                # close_source names who asked for cleanup (None = nobody did).
                logger.error(f"Gemini receive loop exited unexpectedly (close_source={self._close_source}).")
                await self._emit_diag("session_closed_unexpectedly")

    async def _handle_server_message(self, response):
        """Handles one LiveServerMessage: audio, transcripts, tools, turn end."""
        await self._mark_response_event(is_audio=False)
        server_content = response.server_content

        if server_content:
            # Check for interruption
            if server_content.interrupted:
                self.stats["interrupts"] += 1
                logger.info("Gemini Live: user interruption (barge-in).")
                await self._emit_diag("interrupted")
                await self._invoke_cb(self.on_interrupted)

            # Transcribed speech from AI
            if server_content.output_transcription and server_content.output_transcription.text:
                tx = server_content.output_transcription.text
                if tx:
                    self.stats["output_transcripts"] += 1
                    self.transcript_history.append(("ai", tx))
                    await self._emit_diag("output_transcript")
                    await self._invoke_cb(self.on_transcript, "ai", tx)

            # Transcribed speech from User Microphone
            if server_content.input_transcription and server_content.input_transcription.text:
                tx = server_content.input_transcription.text
                if tx:
                    self.stats["input_transcripts"] += 1
                    self.transcript_history.append(("customer", tx))
                    await self.note_input_transcription()
                    await self._emit_diag("input_transcript")
                    await self._invoke_cb(self.on_transcript, "customer", tx)

            # Model Audio output & direct text
            if server_content.model_turn:
                for part in server_content.model_turn.parts:
                    if part.inline_data and part.inline_data.data:
                        # 24kHz PCM audio from Gemini — forward immediately,
                        # never buffered: first audible byte matters most.
                        self.stats["audio_chunks_out"] += 1
                        await self._mark_response_event(is_audio=True)
                        await self._invoke_cb(self.on_audio_out, part.inline_data.data)

                    if part.text and not part.text.startswith("**Crafting"):
                        clean_text = part.text.strip()
                        if clean_text:
                            self.stats["output_transcripts"] += 1
                            await self._emit_diag("output_transcript")
                            await self._invoke_cb(self.on_transcript, "ai", clean_text)

            if server_content.turn_complete:
                self.stats["turn_completes"] += 1
                import time as _time
                cid = self._active_cid
                vkey = cid if (cid and cid in self._turn_marks) else "__voice_stream"
                vm = self._turn_marks.get(vkey, {})
                if cid and cid in self._turn_marks:
                    dt = (_time.perf_counter() - self._turn_marks[cid]["t_recv"]) * 1000
                    logger.info(f"TURN cid={cid} recv->turn_complete={dt:.0f}ms")
                if "t_first_in_tx" in vm and "t_last_in_tx" in vm:
                    f = (vm["t_last_in_tx"] - vm["t_first_in_tx"]) * 1000
                    base = vm.get("t_recv")
                    anchor = f" (after recv: first=+{(vm['t_first_in_tx'] - base) * 1000:.0f}ms)" if base else " (hands-free stream)"
                    logger.info(f"VOICE cid={vkey} partial->final transcription={f:.0f}ms{anchor}")
                if vkey == "__voice_stream":
                    self._turn_marks.pop("__voice_stream", None)
                self._active_cid = None
                # Bound memory: keep only recent turn marks.
                if len(self._turn_marks) > 20:
                    for old in list(self._turn_marks)[:-20]:
                        del self._turn_marks[old]
                logger.info("Gemini Live: turn_complete.")
                await self._emit_diag("turn_complete")
                await self._invoke_cb(self.on_turn_complete)

        # 2. Check for Tool / Function Calls
        tool_call = response.tool_call
        if tool_call and tool_call.function_calls:
            function_responses = []
            for call in tool_call.function_calls:
                name = call.name
                args = call.args or {}
                call_id = call.id
                logger.info(f"Gemini requested tool call '{name}' with args {args}")

                import time as _ttime
                _tool_start = _ttime.perf_counter()
                res = await self._execute_tool(name, args)
                _tool_ms = (_ttime.perf_counter() - _tool_start) * 1000

                # Notify callback so frontend UI sees real-time tool execution
                self.stats["tool_calls"] += 1
                logger.info(f"Tool '{name}' took={_tool_ms:.1f}ms -> {str(res)[:200]}")
                await self._emit_diag("tool_call", {"name": name, "ms": round(_tool_ms, 1)})
                await self._invoke_cb(self.on_tool_call, name, args, res)

                function_responses.append(
                    types.FunctionResponse(
                        name=name,
                        id=call_id,
                        response={"result": res}
                    )
                )

            # Send tool results back to Gemini Live on the SAME session.
            # If this send fails the model waits forever -> emit diag + log.
            if function_responses and self.session:
                try:
                    await self.session.send_tool_response(
                        function_responses=function_responses
                    )
                    logger.info(f"Tool responses sent ({len(function_responses)}).")
                except Exception as e:
                    import traceback
                    logger.error(f"Failed to send tool response: {e}\n{traceback.format_exc()}")
                    await self._emit_diag("tool_response_error", {"error": str(e)[:200]})

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Executes server-side tool functions."""
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        elif not isinstance(args, dict):
            args = {}

        if name in ("get_menu", "get_live_menu"):
            category = args.get("category")
            return get_live_menu(category)

        elif name in ("create_order_draft", "create_or_update_order_draft"):
            items = args.get("items", [])
            order_type = args.get("order_type", "Takeout")
            customer_address = args.get("customer_address")
            notes = args.get("notes")

            draft_result = create_or_update_order_draft(
                items=items,
                order_type=order_type,
                customer_name=self.caller_name,
                customer_phone=self.caller_phone,
                customer_address=customer_address,
                notes=notes,
                draft_id=self.current_draft_id
            )
            if draft_result.get("status") == "success":
                self.current_draft_id = draft_result.get("draft_id")
            return draft_result

        elif name == "calculate_order_total":
            draft_id = args.get("draft_id") or self.current_draft_id
            return calculate_order_total(draft_id)

        elif name in ("confirm_order", "confirm_and_place_order"):
            draft_id = args.get("draft_id") or self.current_draft_id
            caller_confirmed = bool(args.get("customer_confirmed") or args.get("caller_confirmed", False))

            result = confirm_and_place_order(
                draft_id=draft_id,
                caller_confirmed=caller_confirmed,
                call_id=self.call_id
            )

            # Trigger WhatsApp confirmation asynchronously upon success
            if result.get("status") == "success" and result.get("order_id"):
                # Fresh draft for the NEXT order — otherwise the next
                # "I want ..." reuses the already-confirmed draft and the AI
                # repeats the old order instead of starting a new one.
                self.current_draft_id = None
                order_id = result["order_id"]
                items_str = f"Order #{order_id} via Aura Dining AI Voice Assistant"
                asyncio.create_task(
                    send_whatsapp_order_confirmation(
                        to_phone=self.caller_phone,
                        order_id=order_id,
                        customer_name=self.caller_name,
                        items_summary=items_str,
                        total_amount=result.get("total_inr", 0.0),
                        order_type=result.get("order_type", "Takeout"),
                        estimated_time=result.get("estimated_time", "20-30 mins")
                    )
                )

            return result

        elif name == "transfer_to_human":
            reason = args.get("reason", "Caller requested restaurant staff")
            logger.warning(f"Transferring call to human staff: {reason}")
            log_call_record(
                caller_phone=self.caller_phone,
                caller_name=self.caller_name,
                status="abandoned",
                sentiment="neutral",
                transcript_summary=f"Transferred to staff. Reason: {reason}",
                notes="Staff handoff triggered by Gemini Live AI"
            )
            return {
                "status": "transfer_initiated",
                "message": "Transferring caller to restaurant staff at +91 7845742951. Please hold on."
            }

        return {"status": "error", "message": f"Unknown tool: {name}"}

    async def close(self, source: str = "close()"):
        """Closes the live session cleanly. `source` names the exact caller
        (browser disconnect, handler error, reconnect) for structured logs."""
        self._close_source = source
        self.is_active = False
        if self._receive_task:
            self._receive_task.cancel()
        if self._flush_task:
            self._flush_task.cancel()
        if hasattr(self, '_cm') and self._cm:
            try:
                await self._cm.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Gemini session __aexit__ ({source}): {e}")
        elif self.session:
            try:
                await self.session.close()
            except Exception as e:
                logger.warning(f"Gemini session close ({source}): {e}")
        masked = f"{(self.caller_phone or '')[:4]}...{(self.caller_phone or '')[-2:]}"
        logger.info(f"Gemini Live session CLOSE source={source} caller={masked} stats={self.stats}")
        await self._emit_diag("session_close")
