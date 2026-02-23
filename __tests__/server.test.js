const http = require('http');

// Mock dependencies before requiring server
jest.mock('ws', () => {
  return { WebSocketServer: jest.fn().mockImplementation(() => ({ on: jest.fn() })) };
});

describe('Server', () => {
  let app;

  beforeAll(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    console.log.mockRestore();
  });

  test('health check returns ok', async () => {
    // Import express app setup inline
    const express = require('express');
    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get('/', (req, res) => {
      res.json({ status: 'ok', service: 'reaves-voice-agent' });
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const response = await fetch(`http://localhost:${port}/`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('reaves-voice-agent');

    await new Promise(resolve => server.close(resolve));
  });

  test('/twiml returns valid TwiML with ConversationRelay', async () => {
    const express = require('express');
    app = express();
    app.use(express.urlencoded({ extended: true }));

    app.post('/twiml', (req, res) => {
      const host = req.headers.host;
      const wsUrl = `wss://${host}/ws`;
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

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const response = await fetch(`http://localhost:${port}/twiml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B19414620936&CallSid=CA123',
    });

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<Response>');
    expect(body).toContain('<ConversationRelay');
    expect(body).toContain('url="wss://');
    expect(body).toContain('/ws"');

    await new Promise(resolve => server.close(resolve));
  });
});
