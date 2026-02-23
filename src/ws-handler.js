const { OpenAI } = require('openai');
const { SYSTEM_PROMPT } = require('./system-prompt');
const { notifyMatt } = require('./notify');

// Store conversations per call
const sessions = new Map();

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Handle a WebSocket connection from Twilio ConversationRelay.
 * Message types from Twilio:
 *   - setup: call connected, includes callSid
 *   - prompt: transcribed speech from caller
 *   - interrupt: caller started speaking mid-response
 *   - dtmf: keypad press
 *   - error: something went wrong
 */
function handleWebSocket(ws) {
  let callSid = null;
  let callerInfo = { name: null, phone: null, details: [] };

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'setup':
          callSid = message.callSid;
          console.log(`[ws] Setup for call: ${callSid}`);

          // Initialize conversation with system prompt
          sessions.set(callSid, [
            { role: 'system', content: SYSTEM_PROMPT },
          ]);

          // Send greeting
          sendText(ws, "Hi, thanks for calling Reaves Holdings! This is Riley. How can I help you today?", true);
          break;

        case 'prompt':
          console.log(`[ws] Caller said: "${message.voicePrompt}"`);
          await handlePrompt(ws, callSid, message.voicePrompt, callerInfo);
          break;

        case 'interrupt':
          console.log(`[ws] Caller interrupted`);
          // ConversationRelay handles stopping TTS automatically
          break;

        case 'dtmf':
          console.log(`[ws] DTMF: ${message.digit}`);
          break;

        case 'error':
          console.error(`[ws] Error:`, message);
          break;

        default:
          console.log(`[ws] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`[ws] Error handling message:`, err);
    }
  });

  ws.on('close', () => {
    console.log(`[ws] Call ended: ${callSid}`);
    if (callSid) {
      // Extract caller info from conversation and notify Matt
      const conversation = sessions.get(callSid);
      if (conversation && conversation.length > 2) {
        extractAndNotify(callSid, conversation, callerInfo);
      }
      sessions.delete(callSid);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ws] WebSocket error:`, err);
  });
}

/**
 * Handle a transcribed prompt from the caller.
 */
async function handlePrompt(ws, callSid, userText, callerInfo) {
  const conversation = sessions.get(callSid);
  if (!conversation) return;

  conversation.push({ role: 'user', content: userText });

  try {
    const openai = getOpenAI();
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversation,
      stream: true,
      max_completion_tokens: 200,
    });

    let fullResponse = '';
    let buffer = '';

    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (token) {
        buffer += token;
        fullResponse += token;

        // Send sentence-level chunks for natural speech
        if (isSentenceEnd(buffer)) {
          sendText(ws, buffer.trim(), false);
          buffer = '';
        }
      }
    }

    // Send any remaining buffer
    if (buffer.trim()) {
      sendText(ws, buffer.trim(), true);
    } else {
      // Signal last message
      sendText(ws, '', true);
    }

    conversation.push({ role: 'assistant', content: fullResponse });

    // Try to extract caller info from what they said
    extractCallerInfo(userText, callerInfo);

  } catch (err) {
    console.error(`[ws] OpenAI error:`, err);
    sendText(ws, "I'm sorry, I'm having a little trouble right now. Could you say that again?", true);
  }
}

/**
 * Check if buffer ends at a natural sentence boundary.
 */
function isSentenceEnd(text) {
  return /[.!?]\s*$/.test(text) || text.length > 150;
}

/**
 * Send a text message back to Twilio ConversationRelay for TTS.
 */
function sendText(ws, text, last) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: 'text',
      token: text,
      last: last,
    }));
  }
}

/**
 * Basic extraction of caller info from their speech.
 */
function extractCallerInfo(text, callerInfo) {
  // Store all caller utterances for context
  callerInfo.details.push(text);

  // Try to extract phone numbers (simple pattern)
  const phoneMatch = text.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phoneMatch) {
    callerInfo.phone = phoneMatch[0];
  }

  // Name extraction is handled by the AI in conversation
}

/**
 * After call ends, summarize and notify Matt.
 */
async function extractAndNotify(callSid, conversation, callerInfo) {
  try {
    const openai = getOpenAI();

    // Ask GPT to summarize the call
    const summary = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this phone call in 2-3 bullet points. Include: caller name (if given), phone number (if given), what they wanted, any property details mentioned. Be concise.',
        },
        ...conversation.filter(m => m.role !== 'system'),
      ],
      max_completion_tokens: 200,
    });

    const summaryText = summary.choices?.[0]?.message?.content || 'Call ended, no summary available.';
    console.log(`[notify] Call summary for ${callSid}:\n${summaryText}`);

    // Notify Matt
    await notifyMatt(callSid, summaryText);
  } catch (err) {
    console.error(`[notify] Failed to summarize/notify:`, err);
  }
}

module.exports = { handleWebSocket };
