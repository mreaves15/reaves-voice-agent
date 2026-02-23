const http = require('http');
const express = require('express');

describe('Server endpoints', () => {
  let app, server, port;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get('/', (req, res) => {
      res.json({ status: 'ok', service: 'reaves-voice-agent', mode: 'realtime' });
    });

    app.post('/twiml', (req, res) => {
      const host = req.headers.host;
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media-stream" />
  </Connect>
</Response>`;
      res.type('text/xml');
      res.send(twiml);
    });

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    console.log.mockRestore();
    await new Promise(resolve => server.close(resolve));
  });

  test('health check returns ok with realtime mode', async () => {
    const response = await fetch(`http://localhost:${port}/`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('reaves-voice-agent');
    expect(data.mode).toBe('realtime');
  });

  test('/twiml returns TwiML with Stream (not ConversationRelay)', async () => {
    const response = await fetch(`http://localhost:${port}/twiml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B19414620936&CallSid=CA123',
    });

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<Response>');
    expect(body).toContain('<Stream');
    expect(body).toContain('/media-stream');
    expect(body).not.toContain('ConversationRelay');
  });
});
