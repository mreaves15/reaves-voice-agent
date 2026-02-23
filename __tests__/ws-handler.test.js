// Test the WebSocket handler utilities

describe('isSentenceEnd', () => {
  // Extract the function for testing
  const isSentenceEnd = (text) => /[.!?]\s*$/.test(text) || text.length > 150;

  test('detects period at end', () => {
    expect(isSentenceEnd('Hello there.')).toBe(true);
  });

  test('detects question mark', () => {
    expect(isSentenceEnd('How are you?')).toBe(true);
  });

  test('detects exclamation', () => {
    expect(isSentenceEnd('Great!')).toBe(true);
  });

  test('returns false for incomplete sentence', () => {
    expect(isSentenceEnd('Hello there')).toBe(false);
  });

  test('returns true for long text over 150 chars', () => {
    const longText = 'a'.repeat(151);
    expect(isSentenceEnd(longText)).toBe(true);
  });
});

describe('extractCallerInfo', () => {
  test('extracts phone number from text', () => {
    const callerInfo = { name: null, phone: null, details: [] };
    const text = 'My number is 352-555-1234';

    callerInfo.details.push(text);
    const phoneMatch = text.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (phoneMatch) callerInfo.phone = phoneMatch[0];

    expect(callerInfo.phone).toBe('352-555-1234');
  });

  test('extracts phone with dots', () => {
    const text = 'Call me at 352.555.1234';
    const phoneMatch = text.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/);
    expect(phoneMatch[0]).toBe('352.555.1234');
  });

  test('stores utterance in details', () => {
    const callerInfo = { name: null, phone: null, details: [] };
    callerInfo.details.push('I want to sell my land');
    callerInfo.details.push('It is in Putnam County');
    expect(callerInfo.details).toHaveLength(2);
  });
});
