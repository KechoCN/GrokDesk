export interface CompletionToken { kind: 'command' | 'mention'; query: string; start: number; end: number; }

/** Only complete standalone tokens; email addresses, URLs and IME preedit stay text. */
export function completionToken(value: string, caret: number): CompletionToken | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)([/@])([^\s@]*)$/.exec(before);
  if (!match) return null;
  if (match[1] === '/' && match[2].includes('/')) return null;
  const start = caret - match[2].length - 1;
  let end = caret;
  while (end < value.length && !/\s/.test(value[end])) end++;
  return { kind: match[1] === '/' ? 'command' : 'mention', query: match[2], start, end };
}

export function replaceCompletion(value: string, token: CompletionToken, insert: string) {
  return { value: value.slice(0, token.start) + insert + value.slice(token.end), caret: token.start + insert.length };
}

export function isCompositionKey(event: { isComposing?: boolean; keyCode?: number }, composing: boolean, endedAt: number, now = Date.now()) {
  return composing || event.isComposing === true || event.keyCode === 229 || now - endedAt < 100;
}
