require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { SYSTEM_PROMPT } = require('./system-prompt');
const { notifyMatt, addTranscript, getTranscript, summarizeCall } = require('./notify');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE = 'coral'; // OpenAI voice: alloy, echo, shimmer, ash, ballad, coral, sage, verse

if (!OPENAI_API_KEY) {
  console.error('[server] Missing OPENAI_API_KEY');
  process.exit(1);
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'reaves-voice-agent', mode: 'realtime' });
});

// Twilio webhook — incoming call
app.post('/twiml', (req, res) => {
  const host = req.headers.host;
  const wsProtocol = host.includes('localhost') ? 'ws' : 'wss';

  console.log(`[call] Incoming from ${req.body.From || 'unknown'}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsProtocol}://${host}/media-stream" />
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// Status callback
app.post('/status', (req, res) => {
  console.log(`[status] Call ${req.body.CallSid}: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/media-stream') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleMediaStream(ws);
    });
  } else {
    socket.destroy();
  }
});

/**
 * Handle a Twilio Media Stream WebSocket connection.
 * Bridges audio between Twilio and OpenAI Realtime API.
 */
function handleMediaStream(twilioWs) {
  let streamSid = null;
  let callSid = null;
  let latestMediaTimestamp = 0;
  let lastAssistantItem = null;
  let markQueue = [];
  let responseStartTimestamp = null;

  console.log('[ws] Twilio media stream connected');

  // Connect to OpenAI Realtime API
  const openAiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03',
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  // Initialize OpenAI session when connected
  openAiWs.on('open', () => {
    console.log('[openai] Connected to Realtime API');

    setTimeout(() => {
      // Configure session
      openAiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: { model: 'whisper-1' },
          voice: VOICE,
          instructions: SYSTEM_PROMPT,
          modalities: ['text', 'audio'],
          temperature: 0.7,
        },
      }));

      // Have Riley greet the caller
      openAiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: 'Greet the caller warmly. Say: "Hi, thanks for calling Reaves Holdings! This is Riley. How can I help you today?"',
          }],
        },
      }));
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    }, 100);
  });

  // Handle messages FROM OpenAI → send audio TO Twilio
  openAiWs.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case 'response.audio.delta':
          if (event.delta && streamSid) {
            // Send audio chunk to Twilio
            twilioWs.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: event.delta },
            }));

            if (!responseStartTimestamp) {
              responseStartTimestamp = latestMediaTimestamp;
            }

            // Send mark for interruption tracking
            if (twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify({
                event: 'mark',
                streamSid,
                mark: { name: 'responsePart' },
              }));
              markQueue.push('responsePart');
            }
          }
          break;

        case 'response.audio_transcript.done':
          console.log(`[openai] Riley said: "${event.transcript}"`);
          if (callSid && event.transcript) {
            addTranscript(callSid, 'riley', event.transcript);
          }
          break;

        case 'input_audio_buffer.speech_started':
          // Caller started talking — handle interruption
          handleInterruption();
          break;

        case 'response.output_item.added':
          if (event.item) {
            lastAssistantItem = event.item.id;
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          console.log(`[openai] Caller said: "${event.transcript}"`);
          if (callSid && event.transcript) {
            addTranscript(callSid, 'caller', event.transcript);
          }
          break;

        case 'error':
          console.error('[openai] Error:', event.error);
          break;

        case 'session.created':
        case 'session.updated':
          console.log(`[openai] ${event.type}`);
          break;

        case 'response.done':
          // Response complete
          break;

        default:
          // Ignore other event types
          break;
      }
    } catch (err) {
      console.error('[openai] Parse error:', err);
    }
  });

  openAiWs.on('error', (err) => {
    console.error('[openai] WebSocket error:', err);
  });

  openAiWs.on('close', () => {
    console.log('[openai] Disconnected');
  });

  // Handle messages FROM Twilio → send audio TO OpenAI
  twilioWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.event) {
        case 'start':
          streamSid = message.start.streamSid;
          callSid = message.start.callSid;
          console.log(`[twilio] Stream started: ${streamSid} (call: ${callSid})`);
          break;

        case 'media':
          latestMediaTimestamp = message.media.timestamp;
          // Forward audio to OpenAI
          if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: message.media.payload,
            }));
          }
          break;

        case 'mark':
          if (markQueue.length > 0) {
            markQueue.shift();
          }
          break;

        case 'stop':
          console.log(`[twilio] Stream stopped: ${streamSid}`);
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('[twilio] Parse error:', err);
    }
  });

  // When Twilio disconnects (call ended)
  twilioWs.on('close', () => {
    console.log(`[twilio] Call ended: ${callSid}`);
    openAiWs.close();

    // Send call summary to Matt
    if (callSid) {
      summarizeAndNotify(callSid);
    }
  });

  twilioWs.on('error', (err) => {
    console.error('[twilio] WebSocket error:', err);
  });

  /**
   * Handle caller interruption — clear Twilio audio buffer and truncate OpenAI response.
   */
  function handleInterruption() {
    if (markQueue.length > 0 && responseStartTimestamp != null) {
      const elapsedTime = latestMediaTimestamp - responseStartTimestamp;

      if (lastAssistantItem) {
        openAiWs.send(JSON.stringify({
          type: 'conversation.item.truncate',
          item_id: lastAssistantItem,
          content_index: 0,
          audio_end_ms: elapsedTime,
        }));
      }

      twilioWs.send(JSON.stringify({
        event: 'clear',
        streamSid,
      }));

      markQueue = [];
      lastAssistantItem = null;
      responseStartTimestamp = null;
    }
  }
}

/**
 * After call ends, summarize transcript and text Matt.
 */
async function summarizeAndNotify(callSid) {
  try {
    // Wait a moment for any final transcriptions to arrive
    await new Promise(resolve => setTimeout(resolve, 2000));

    const transcript = getTranscript(callSid);
    const summary = await summarizeCall(transcript);
    await notifyMatt(callSid, summary);
  } catch (err) {
    console.error('[notify] Error:', err);
  }
}

server.listen(PORT, () => {
  console.log(`[server] Reaves Voice Agent (Realtime) running on port ${PORT}`);
});
