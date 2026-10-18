import { describe, it, expect } from 'vitest';
import { parseWksProtocol, type WksProtocolMap } from './wks-protocol-manager.js';

describe('parseWksProtocol', () => {
  it('returns an empty map for an empty string', () => {
    expect(parseWksProtocol('')).toEqual({});
  });

  it('returns an empty map for whitespace-only input', () => {
    expect(parseWksProtocol('   \n  \n  ')).toEqual({});
  });

  it('returns an empty map for input with no recognised headings', () => {
    const md = `
# Some random text
More content here.
`;
    expect(parseWksProtocol(md)).toEqual({});
  });

  it('parses a single recognised section', () => {
    const md = `
# architect:
- Design components
- Define interfaces
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: '- Design components\n- Define interfaces',
    });
  });

  it('parses multiple recognised sections', () => {
    const md = `
# master-orchestrator:
- If there is defect send it to programmer.

# business-analyst:
- write detailed requirement for each page.
- Write how the data is shown.

# architect:
- Design the system.
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      'master-orchestrator': '- If there is defect send it to programmer.',
      'business-analyst': '- write detailed requirement for each page.\n- Write how the data is shown.',
      architect: '- Design the system.',
    });
  });

  it('strips heading-colon whitespace variations', () => {
    const md = `
# architect :
- content
`;
    // The regex /^#\s+([a-z][a-z-]*):\s*$/ requires the colon directly after
    // the key with optional trailing spaces. A space BEFORE the colon like
    // "architect :" won't match — that's the intended strict behaviour.
    const map = parseWksProtocol(md);
    expect(map).toEqual({});
  });

  it('trims trailing blank lines from section bodies', () => {
    const md = `
# architect:
Line one

Line three


`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: 'Line one\n\nLine three',
    });
  });

  it('preserves internal blank lines but trims trailing ones', () => {
    const md = `
# programmer:
Implement the design.

Follow conventions.


`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      programmer: 'Implement the design.\n\nFollow conventions.',
    });
  });

  it('skips unknown headings and continues at next recognised heading', () => {
    const md = `
# unknown-heading:
This should be skipped.

# architect:
Keep this.
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: 'Keep this.',
    });
  });

  it('skips content between unknown headings', () => {
    const md = `
# unknown-heading:
Skipped content.

Also skipped.

# architect:
Kept content.

# another-unknown:
More skipped.

# programmer:
Also kept.
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: 'Kept content.',
      programmer: 'Also kept.',
    });
  });

  it('handles an empty section body gracefully (empty string value)', () => {
    const md = `
# architect:
# programmer:
Write code.
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: '',
      programmer: 'Write code.',
    });
  });

  it('returns empty body for a section at end of file with no content', () => {
    const md = `# architect:`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({
      architect: '',
    });
  });

  it('recognises all known roles plus master-orchestrator', () => {
    const md = `
# requirements-analyst:
req content

# architect:
arch content

# programmer:
prog content

# refactorer:
ref content

# tester:
test content

# ui-api-tester:
ui content

# technical-writer:
tw content

# devops:
dev content

# conversation:
conv content

# business-analyst:
ba content

# master-orchestrator:
mo content
`;
    const map = parseWksProtocol(md);
    expect(Object.keys(map)).toHaveLength(11);
    expect(map).toEqual({
      'requirements-analyst': 'req content',
      architect: 'arch content',
      programmer: 'prog content',
      refactorer: 'ref content',
      tester: 'test content',
      'ui-api-tester': 'ui content',
      'technical-writer': 'tw content',
      devops: 'dev content',
      conversation: 'conv content',
      'business-analyst': 'ba content',
      'master-orchestrator': 'mo content',
    });
  });

  it('handles the exact wks_protocol.md format from enhance001.md', () => {
    const md = `# master-orchestrator:

- If there is defect send ut to programmer to fix and tester to retest.

# requirements-analyst:
# business-analyst:
- write detailed requirement for each page, include page, subpage actionable element and data requirement.
- Write how the data is shown like view, list, detail, editable, update and delete, sortable, searchable, data navigation with next and previous.

# architect:
# programmer:
# refactorer:
# tester:

- Test deployment to docker any issue generate defect detailed the RCA of the issue.



# ui-api-tester:
# tester:
# technical-writer:
# devops:
# conversation:`;

    const map = parseWksProtocol(md);

    // master-orchestrator has one bullet (leading blank line is preserved per spec)
    expect(map['master-orchestrator']).toBe(
      '\n- If there is defect send ut to programmer to fix and tester to retest.'
    );

    // business-analyst has the full content
    expect(map['business-analyst']).toBe(
      '- write detailed requirement for each page, include page, subpage actionable element and data requirement.\n- Write how the data is shown like view, list, detail, editable, update and delete, sortable, searchable, data navigation with next and previous.'
    );

    // In the original format, architect, programmer, refactorer are consecutive
    // empty headings, flushed before tester collects content. The first # tester:
    // collects the docker bullet. However, there's a SECOND # tester: heading later
    // that overwrites the map entry (last heading wins). So tester ends up empty.
    expect(map['architect']).toBe('');
    expect(map['programmer']).toBe('');
    expect(map['refactorer']).toBe('');
    // The first # tester: heading collected the docker bullet, but then a second
    // # tester: heading later in the file overwrote it with an empty section.
    expect(map['tester']).toBe('');

    // ui-api-tester is also empty (it's flushed before the second # tester:)
    expect(map['requirements-analyst']).toBe('');
    expect(map['ui-api-tester']).toBe('');
    expect(map['technical-writer']).toBe('');
    expect(map['devops']).toBe('');
    expect(map['conversation']).toBe('');
  });

  it('handles content that comes after an empty section heading but before the next heading', () => {
    const md = `
# architect:
- shared point one
- shared point two

# programmer:
`;
    const map = parseWksProtocol(md);
    expect(map['architect']).toBe('- shared point one\n- shared point two');
    expect(map['programmer']).toBe('');
  });

  it('ignores headings not in RECOGNISED_KEYS even if they look plausible', () => {
    const md = `
# security-analyst:
Check security.

# architect:
Design.
`;
    const map = parseWksProtocol(md);
    expect(map).toEqual({ architect: 'Design.' });
    expect((map as Record<string, string | undefined>)['security-analyst']).toBeUndefined();
  });
});
