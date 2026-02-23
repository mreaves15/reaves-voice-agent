const twilio = require('twilio');

// Store transcripts per call
const callTranscripts = new Map();

/**
 * Add a line to a call's transcript.
 */
function addTranscript(callSid, role, text) {
  if (!callTranscripts.has(callSid)) {
    callTranscripts.set(callSid, []);
  }
  callTranscripts.get(callSid).push({ role, text });
}

/**
 * Get and clear transcript for a call.
 */
function getTranscript(callSid) {
  const transcript = callTranscripts.get(callSid) || [];
  callTranscripts.delete(callSid);
  return transcript;
}

/**
 * Summarize a call transcript using OpenAI.
 */
async function summarizeCall(transcript) {
  if (transcript.length === 0) return 'Call received but no conversation captured.';

  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const conversationText = transcript
      .map(t => `${t.role === 'caller' ? 'Caller' : 'Riley'}: ${t.text}`)
      .join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this phone call in 2-4 bullet points. Include: caller name (if given), their phone number (if given), what they wanted, any property details. Be concise. Use plain text, no markdown.',
        },
        { role: 'user', content: conversationText },
      ],
      max_completion_tokens: 250,
    });

    return response.choices?.[0]?.message?.content || 'Call summary unavailable.';
  } catch (err) {
    console.error('[summary] OpenAI error:', err.message);
    // Fallback: just send raw transcript snippets
    return transcript.slice(0, 5).map(t => `${t.role}: ${t.text}`).join('\n');
  }
}

/**
 * Notify Matt about a completed call via SMS.
 */
async function notifyMatt(callSid, summary) {
  const mattPhone = process.env.MATT_PHONE || '+19414620936';

  console.log(`[notify] Call ${callSid} summary:\n${summary}`);

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      // Truncate if too long for SMS (1600 char limit)
      const smsBody = `📞 Reaves Holdings call:\n\n${summary}`.slice(0, 1590);

      await client.messages.create({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: mattPhone,
      });

      console.log(`[notify] SMS sent to ${mattPhone}`);
    } catch (err) {
      console.error(`[notify] SMS failed:`, err.message);
    }
  }
}

module.exports = { notifyMatt, addTranscript, getTranscript, summarizeCall };
