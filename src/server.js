require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { handleWebSocket } = require('./ws-handler');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'reaves-voice-agent' });
});

// Twilio webhook — incoming call
app.post('/twiml', (req, res) => {
  const host = req.headers.host;
  const wsProtocol = host.includes('localhost') ? 'ws' : 'wss';
  const wsUrl = `${wsProtocol}://${host}/ws`;

  console.log(`[call] Incoming from ${req.body.From} → connecting to ${wsUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" voice="en-US-Journey-F" dtmfDetection="true" interruptible="true">
      <Language code="en-US" ttsProvider="google" sttProvider="google" />
    </ConversationRelay>
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// Twilio status callback (optional)
app.post('/status', (req, res) => {
  console.log(`[status] Call ${req.body.CallSid}: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// Create HTTP + WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleWebSocket(ws);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[server] Reaves Voice Agent running on port ${PORT}`);
});
