const twilio = require('twilio');

/**
 * Notify Matt about a completed call via SMS.
 */
async function notifyMatt(callSid, summary) {
  const mattPhone = process.env.MATT_PHONE || '+19414620936';

  // Send SMS via Twilio
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await client.messages.create({
        body: `📞 New call to Reaves Holdings:\n\n${summary}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: mattPhone,
      });

      console.log(`[notify] SMS sent to ${mattPhone}`);
    } catch (err) {
      console.error(`[notify] SMS failed:`, err.message);
    }
  } else {
    console.log(`[notify] No Twilio creds — skipping SMS. Summary:\n${summary}`);
  }
}

module.exports = { notifyMatt };
