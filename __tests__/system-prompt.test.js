const { SYSTEM_PROMPT } = require('../src/system-prompt');

describe('System Prompt', () => {
  test('should export a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('should mention Reaves Holdings', () => {
    expect(SYSTEM_PROMPT).toContain('Reaves Holdings');
  });

  test('should mention Riley (the agent name)', () => {
    expect(SYSTEM_PROMPT).toContain('Riley');
  });

  test('should instruct to collect caller name and phone', () => {
    expect(SYSTEM_PROMPT).toContain('name');
    expect(SYSTEM_PROMPT).toContain('callback number');
  });

  test('should mention Florida counties', () => {
    expect(SYSTEM_PROMPT).toContain('Marion');
    expect(SYSTEM_PROMPT).toContain('Putnam');
  });

  test('should instruct not to discuss pricing', () => {
    expect(SYSTEM_PROMPT).toContain('Never discuss specific pricing');
  });
});
