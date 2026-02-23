const { addTranscript, getTranscript } = require('../src/notify');

describe('Transcript tracking', () => {
  test('stores and retrieves transcripts', () => {
    addTranscript('call-1', 'caller', 'I want to sell my land');
    addTranscript('call-1', 'riley', 'Great! What county is it in?');
    addTranscript('call-1', 'caller', 'Putnam County');

    const transcript = getTranscript('call-1');
    expect(transcript).toHaveLength(3);
    expect(transcript[0]).toEqual({ role: 'caller', text: 'I want to sell my land' });
    expect(transcript[1]).toEqual({ role: 'riley', text: 'Great! What county is it in?' });
    expect(transcript[2]).toEqual({ role: 'caller', text: 'Putnam County' });
  });

  test('getTranscript clears after retrieval', () => {
    addTranscript('call-2', 'caller', 'Hello');
    getTranscript('call-2');
    const second = getTranscript('call-2');
    expect(second).toEqual([]);
  });

  test('returns empty array for unknown call', () => {
    const transcript = getTranscript('nonexistent');
    expect(transcript).toEqual([]);
  });
});
