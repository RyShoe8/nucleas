import { describe, expect, it } from 'vitest';
import { applyFilePatch, parsePatch, PatchError } from './applyPatch';

// Fixtures are real `git diff` output.
const MULTI_FILE = `diff --git a/a.txt b/a.txt
index 4083766..56511a3 100644
--- a/a.txt
+++ b/a.txt
@@ -1,10 +1,11 @@
 line1
-line2
+LINE2
 line3
 line4
 line5
 line6
 line7
 line8
-line9
+line9 changed
 line10
+line11
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index f4dc545..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-keep
-remove me
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..5786b13
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+brand
+new
diff --git a/nonl.txt b/nonl.txt
index e224518..c05d2eb 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1 +1,2 @@
-no newline end
\\ No newline at end of file
+no newline end
+now has one
`;

const DROP_NEWLINE = `diff --git a/x.txt b/x.txt
index de98044..1c943a9 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 a
 b
-c
+c
\\ No newline at end of file
`;

const TWO_HUNKS = `diff --git a/y.txt b/y.txt
index b03757e..390076c 100644
--- a/y.txt
+++ b/y.txt
@@ -1,5 +1,5 @@
 a
-b
+B
 c
 d
 e
@@ -11,6 +11,6 @@ j
 k
 l
 m
-n
+N
 o
 p
`;

const A_TXT = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';

describe('applying git patches', () => {
  it('parses modified, deleted and new files', () => {
    const files = parsePatch(MULTI_FILE);
    expect(files.map((f) => [f.path, f.kind])).toEqual([
      ['a.txt', 'modify'],
      ['gone.txt', 'delete'],
      ['new.txt', 'add'],
      ['nonl.txt', 'modify'],
    ]);
  });

  it('applies edits, deletions and new files exactly as git would', () => {
    const [a, gone, added, nonl] = parsePatch(MULTI_FILE);
    expect(applyFilePatch(A_TXT, a)).toBe('line1\nLINE2\nline3\nline4\nline5\nline6\nline7\nline8\nline9 changed\nline10\nline11\n');
    expect(applyFilePatch('keep\nremove me\n', gone)).toBeNull();
    expect(applyFilePatch(null, added)).toBe('brand\nnew\n');
    expect(applyFilePatch('no newline end', nonl)).toBe('no newline end\nnow has one\n');
  });

  it('handles removing the final newline and several hunks in one file', () => {
    expect(applyFilePatch('a\nb\nc\n', parsePatch(DROP_NEWLINE)[0])).toBe('a\nb\nc');
    const y = 'abcdefghijklmnop'.split('').join('\n') + '\n';
    expect(applyFilePatch(y, parsePatch(TWO_HUNKS)[0])).toBe('a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nN\no\np\n');
  });

  it('refuses when the file changed since the base commit, instead of guessing', () => {
    const [a] = parsePatch(MULTI_FILE);
    expect(() => applyFilePatch(A_TXT.replace('line3', 'someone else edited this'), a)).toThrow(PatchError);
    expect(() => applyFilePatch(null, a)).toThrow(/does not exist/);
    expect(() => applyFilePatch('already here\n', parsePatch(MULTI_FILE)[2])).toThrow(/already exists/);
  });

  it('refuses binary changes and renames', () => {
    expect(() => parsePatch('diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n')).toThrow(/Binary/);
    expect(() => parsePatch('diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n')).toThrow(/Renames/);
  });
});
