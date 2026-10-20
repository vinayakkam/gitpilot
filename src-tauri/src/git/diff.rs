//! Unified diff parsing and hunk extraction.

use serde::Serialize;
use ts_rs::TS;

/// Diffs bigger than this are truncated for display.
pub const MAX_DIFF_BYTES: usize = 8 * 1024 * 1024;
/// Upper bound on rendered lines per file (the UI virtualizes, but memory still matters).
pub const MAX_DIFF_LINES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// "\ No newline at end of file"
    NoNewline,
    /// Conflict marker (<<<<<<<, =======, >>>>>>>, |||||||)
    Marker,
    /// Inside a conflict: our side
    Ours,
    /// Inside a conflict: their side
    Theirs,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    /// The line ended in CRLF (shown as a subtle marker; content excludes the \r).
    pub crlf: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hunk {
    /// The full `@@ … @@` line; used to identify the hunk for partial staging.
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub section: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub binary: bool,
    pub new_file: bool,
    pub deleted_file: bool,
    pub renamed: bool,
    pub similarity: Option<u32>,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    pub hunks: Vec<Hunk>,
    pub additions: u32,
    pub deletions: u32,
    /// True when the diff was cut short because it is very large.
    pub truncated: bool,
    /// True when the file is a conflicted working file shown with conflict regions.
    pub conflict_view: bool,
    /// Hunk staging is possible for this diff (text, not truncated, not untracked/conflict).
    pub hunk_actions: bool,
}

fn strip_prefix_path(s: &str) -> Option<String> {
    let s = s.trim_end_matches('\t');
    if s == "/dev/null" {
        return None;
    }
    let s = unquote(s);
    Some(
        s.strip_prefix("a/")
            .or_else(|| s.strip_prefix("b/"))
            .unwrap_or(&s)
            .to_string(),
    )
}

/// Undoes git's C-style quoting ("a\tb", "\303\251", …) for paths.
fn unquote(s: &str) -> String {
    if !(s.starts_with('"') && s.ends_with('"') && s.len() >= 2) {
        return s.to_string();
    }
    let inner = &s.as_bytes()[1..s.len() - 1];
    let mut out = Vec::with_capacity(inner.len());
    let mut i = 0;
    while i < inner.len() {
        let c = inner[i];
        if c == b'\\' && i + 1 < inner.len() {
            let n = inner[i + 1];
            match n {
                b'n' => out.push(b'\n'),
                b't' => out.push(b'\t'),
                b'"' => out.push(b'"'),
                b'\\' => out.push(b'\\'),
                b'0'..=b'7' if i + 3 < inner.len() + 1 => {
                    let oct =
                        std::str::from_utf8(&inner[i + 1..(i + 4).min(inner.len())]).unwrap_or("0");
                    out.push(u8::from_str_radix(oct, 8).unwrap_or(b'?'));
                    i += 4;
                    continue;
                }
                other => out.push(other),
            }
            i += 2;
        } else {
            out.push(c);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_range(r: &str) -> (u32, u32) {
    let r = r.trim_start_matches(['-', '+']);
    let mut it = r.split(',');
    let start = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let len = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    (start, len)
}

fn parse_hunk_header(line: &str) -> Option<Hunk> {
    // @@ -a,b +c,d @@ section
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let ranges = &rest[..end];
    let section = rest[end + 3..].trim().to_string();
    let mut parts = ranges.split(' ');
    let (os, ol) = parse_range(parts.next()?);
    let (ns, nl) = parse_range(parts.next()?);
    Some(Hunk {
        header: line.trim_end_matches('\r').to_string(),
        old_start: os,
        old_lines: ol,
        new_start: ns,
        new_lines: nl,
        section,
        lines: Vec::new(),
    })
}

/// Parses `git diff` output. Multiple files are returned in order.
pub fn parse(raw: &[u8]) -> Vec<FileDiff> {
    let truncated_input = raw.len() > MAX_DIFF_BYTES;
    let raw = &raw[..raw.len().min(MAX_DIFF_BYTES)];
    let text = String::from_utf8_lossy(raw);
    let mut files: Vec<FileDiff> = Vec::new();
    let mut cur: Option<FileDiff> = None;
    let mut in_hunk = false;
    let (mut old_no, mut new_no) = (0u32, 0u32);
    let mut line_count = 0usize;

    for line in text.split_inclusive('\n') {
        let crlf = line.ends_with("\r\n");
        let line = line.trim_end_matches('\n').trim_end_matches('\r');

        if line.starts_with("diff --git ") || line.starts_with("diff --cc ") {
            if let Some(f) = cur.take() {
                files.push(f);
            }
            cur = Some(FileDiff {
                hunk_actions: true,
                ..FileDiff::default()
            });
            in_hunk = false;
            continue;
        }
        let Some(f) = cur.as_mut() else { continue };

        if line.starts_with("@@ ") {
            if let Some(h) = parse_hunk_header(line) {
                old_no = h.old_start;
                new_no = h.new_start;
                f.hunks.push(h);
                in_hunk = true;
            }
            continue;
        }

        if in_hunk {
            if f.truncated {
                continue;
            }
            line_count += 1;
            if line_count > MAX_DIFF_LINES {
                f.truncated = true;
                f.hunk_actions = false;
                continue;
            }
            let Some(h) = f.hunks.last_mut() else {
                continue;
            };
            let (kind, content) = match line.as_bytes().first() {
                Some(b'+') => (LineKind::Add, &line[1..]),
                Some(b'-') => (LineKind::Del, &line[1..]),
                Some(b' ') => (LineKind::Context, &line[1..]),
                Some(b'\\') => (LineKind::NoNewline, line),
                None => (LineKind::Context, ""),
                _ => {
                    // Not a hunk line: the hunk ended (shouldn't happen inside one file).
                    in_hunk = false;
                    continue;
                }
            };
            let (o, n) = match kind {
                LineKind::Add => {
                    f.additions += 1;
                    new_no += 1;
                    (None, Some(new_no - 1))
                }
                LineKind::Del => {
                    f.deletions += 1;
                    old_no += 1;
                    (Some(old_no - 1), None)
                }
                LineKind::Context => {
                    old_no += 1;
                    new_no += 1;
                    (Some(old_no - 1), Some(new_no - 1))
                }
                _ => (None, None),
            };
            h.lines.push(DiffLine {
                kind,
                content: content.to_string(),
                old_no: o,
                new_no: n,
                crlf,
            });
            continue;
        }

        // Extended header lines
        if let Some(v) = line.strip_prefix("--- ") {
            f.old_path = strip_prefix_path(v);
        } else if let Some(v) = line.strip_prefix("+++ ") {
            f.new_path = strip_prefix_path(v);
        } else if let Some(v) = line.strip_prefix("rename from ") {
            f.renamed = true;
            f.old_path = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("rename to ") {
            f.renamed = true;
            f.new_path = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("similarity index ") {
            f.similarity = v.trim_end_matches('%').parse().ok();
        } else if let Some(v) = line.strip_prefix("new file mode ") {
            f.new_file = true;
            f.new_mode = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("deleted file mode ") {
            f.deleted_file = true;
            f.old_mode = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("old mode ") {
            f.old_mode = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("new mode ") {
            f.new_mode = Some(v.to_string());
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            f.binary = true;
            f.hunk_actions = false;
            if let Some(rest) = line.strip_prefix("Binary files ") {
                // "Binary files a/x and b/y differ"
                if let Some((a, b)) = rest.trim_end_matches(" differ").split_once(" and ") {
                    f.old_path = f.old_path.take().or_else(|| strip_prefix_path(a));
                    f.new_path = f.new_path.take().or_else(|| strip_prefix_path(b));
                }
            }
        }
    }
    if let Some(f) = cur.take() {
        files.push(f);
    }
    if truncated_input {
        if let Some(last) = files.last_mut() {
            last.truncated = true;
            last.hunk_actions = false;
        }
    }
    files
}

/// Returns `(file_header, hunks)` as raw byte slices from a single-file diff.
/// Used to build a patch for one hunk without re-encoding any content.
pub fn split_raw_hunks(raw: &[u8]) -> Option<(&[u8], Vec<&[u8]>)> {
    let mut starts = Vec::new();
    let mut pos = 0;
    while pos < raw.len() {
        if raw[pos..].starts_with(b"@@ ") {
            starts.push(pos);
        }
        match raw[pos..].iter().position(|&b| b == b'\n') {
            Some(n) => pos += n + 1,
            None => break,
        }
    }
    let first = *starts.first()?;
    let header = &raw[..first];
    let mut hunks = Vec::new();
    for (i, &s) in starts.iter().enumerate() {
        let e = starts.get(i + 1).copied().unwrap_or(raw.len());
        hunks.push(&raw[s..e]);
    }
    Some((header, hunks))
}

/// Builds a one-hunk patch whose `@@` line matches `hunk_header` exactly.
pub fn patch_for_hunk(raw: &[u8], hunk_header: &str) -> Option<Vec<u8>> {
    let (header, hunks) = split_raw_hunks(raw)?;
    let wanted = hunk_header.trim_end();
    let hunk = hunks.into_iter().find(|h| {
        let first = h.split(|&b| b == b'\n').next().unwrap_or(&[]);
        String::from_utf8_lossy(first).trim_end() == wanted
    })?;
    let mut patch = header.to_vec();
    patch.extend_from_slice(hunk);
    if !patch.ends_with(b"\n") {
        patch.push(b'\n');
    }
    Some(patch)
}

/// Builds a one-hunk patch that contains only the selected lines (indices into the hunk's lines).
///
/// Forward (staging from the unstaged diff): unselected additions are dropped and unselected
/// deletions become context. Reverse (unstaging from the staged diff, applied with `--reverse`):
/// unselected additions become context and unselected deletions are dropped.
pub fn patch_for_lines(
    raw: &[u8],
    hunk_header: &str,
    selected: &[u32],
    reverse: bool,
) -> Option<Vec<u8>> {
    let (header, hunks) = split_raw_hunks(raw)?;
    let wanted = hunk_header.trim_end();
    let hunk = hunks.into_iter().find(|h| {
        let first = h.split(|&b| b == b'\n').next().unwrap_or(&[]);
        String::from_utf8_lossy(first).trim_end() == wanted
    })?;
    let mut parts = hunk.split(|&b| b == b'\n');
    let head_line = parts.next()?;
    let mut body: Vec<&[u8]> = parts.collect();
    if body.last().is_some_and(|l| l.is_empty()) {
        body.pop();
    }

    let sel: std::collections::HashSet<u32> = selected.iter().copied().collect();

    // A diff line plus the "\ No newline at end of file" marker that may follow it.
    struct Item<'a> {
        idx: u32,
        line: &'a [u8],
        marker: Option<&'a [u8]>,
    }
    let mut items: Vec<Item> = Vec::new();
    for (i, line) in body.iter().enumerate() {
        if line.first() == Some(&b'\\') {
            if let Some(last) = items.last_mut() {
                last.marker = Some(line);
            }
            continue;
        }
        items.push(Item {
            idx: i as u32,
            line,
            marker: None,
        });
    }

    let mut out: Vec<Vec<u8>> = Vec::new();
    let (mut old_n, mut new_n, mut picked) = (0u32, 0u32, 0u32);
    let emit = |item: &Item, as_context: bool, out: &mut Vec<Vec<u8>>| {
        let mut l = item.line.to_vec();
        if as_context {
            l[0] = b' ';
        }
        out.push(l);
        if let Some(m) = item.marker {
            out.push(m.to_vec());
        }
    };

    // Walk change blocks (runs of - and + lines). Within a block, deletion k pairs with addition k,
    // so keeping a deletion while staging a replacement leaves lines in their natural order.
    let mut i = 0;
    while i < items.len() {
        let first = items[i].line.first().copied().unwrap_or(b' ');
        if first != b'-' && first != b'+' {
            old_n += 1;
            new_n += 1;
            emit(&items[i], false, &mut out);
            i += 1;
            continue;
        }
        let mut dels = Vec::new();
        let mut adds = Vec::new();
        while i < items.len() {
            match items[i].line.first() {
                Some(b'-') => dels.push(i),
                Some(b'+') => adds.push(i),
                _ => break,
            }
            i += 1;
        }
        for k in 0..dels.len().max(adds.len()) {
            if let Some(&d) = dels.get(k) {
                if sel.contains(&items[d].idx) {
                    picked += 1;
                    old_n += 1;
                    emit(&items[d], false, &mut out);
                } else if !reverse {
                    // Not staging this deletion: the line stays.
                    old_n += 1;
                    new_n += 1;
                    emit(&items[d], true, &mut out);
                }
            }
            if let Some(&a) = adds.get(k) {
                if sel.contains(&items[a].idx) {
                    picked += 1;
                    new_n += 1;
                    emit(&items[a], false, &mut out);
                } else if reverse {
                    // Not unstaging this addition: it stays in the index.
                    old_n += 1;
                    new_n += 1;
                    emit(&items[a], true, &mut out);
                }
            }
        }
    }
    if picked == 0 {
        return None;
    }

    // Rewrite the counts in "@@ -a,b +c,d @@ section" (git apply --recount also tolerates them).
    let head = String::from_utf8_lossy(head_line);
    let h = parse_hunk_header(head.trim_end_matches('\r'))?;
    let section = if h.section.is_empty() {
        String::new()
    } else {
        format!(" {}", h.section)
    };
    let new_head = format!(
        "@@ -{},{} +{},{} @@{}",
        h.old_start, old_n, h.new_start, new_n, section
    );

    let mut patch = header.to_vec();
    patch.extend_from_slice(new_head.as_bytes());
    patch.push(b'\n');
    for l in out {
        patch.extend_from_slice(&l);
        patch.push(b'\n');
    }
    Some(patch)
}

/// Builds a diff for an untracked file by reading it, without invoking git.
pub fn untracked_file_diff(path: &str, content: &[u8]) -> FileDiff {
    let mut f = FileDiff {
        new_path: Some(path.to_string()),
        new_file: true,
        hunk_actions: false,
        ..FileDiff::default()
    };
    let probe = &content[..content.len().min(8000)];
    if probe.contains(&0) {
        f.binary = true;
        return f;
    }
    if content.is_empty() {
        return f;
    }
    let shown = &content[..content.len().min(MAX_DIFF_BYTES)];
    f.truncated = content.len() > MAX_DIFF_BYTES;
    let text = String::from_utf8_lossy(shown);
    let mut lines = Vec::new();
    for (i, l) in text.split_inclusive('\n').enumerate() {
        if i >= MAX_DIFF_LINES {
            f.truncated = true;
            break;
        }
        let crlf = l.ends_with("\r\n");
        lines.push(DiffLine {
            kind: LineKind::Add,
            content: l.trim_end_matches('\n').trim_end_matches('\r').to_string(),
            old_no: None,
            new_no: Some(i as u32 + 1),
            crlf,
        });
    }
    let no_newline = !text.ends_with('\n');
    let n = lines.len() as u32;
    f.additions = n;
    if no_newline && !f.truncated {
        lines.push(DiffLine {
            kind: LineKind::NoNewline,
            content: "\\ No newline at end of file".into(),
            old_no: None,
            new_no: None,
            crlf: false,
        });
    }
    f.hunks.push(Hunk {
        header: format!("@@ -0,0 +1,{n} @@"),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: n,
        section: String::new(),
        lines,
    });
    f
}

/// Shows a conflicted working file with its conflict regions classified.
pub fn conflict_file_view(path: &str, content: &[u8]) -> FileDiff {
    let mut f = FileDiff {
        new_path: Some(path.to_string()),
        conflict_view: true,
        hunk_actions: false,
        ..FileDiff::default()
    };
    if content[..content.len().min(8000)].contains(&0) {
        f.binary = true;
        return f;
    }
    let text = String::from_utf8_lossy(&content[..content.len().min(MAX_DIFF_BYTES)]);
    #[derive(PartialEq)]
    enum S {
        Out,
        Ours,
        Base,
        Theirs,
    }
    let mut state = S::Out;
    let mut lines = Vec::new();
    for (i, l) in text.split_inclusive('\n').enumerate() {
        if i >= MAX_DIFF_LINES {
            f.truncated = true;
            break;
        }
        let crlf = l.ends_with("\r\n");
        let c = l.trim_end_matches('\n').trim_end_matches('\r');
        let kind = if c.starts_with("<<<<<<<") {
            state = S::Ours;
            LineKind::Marker
        } else if c.starts_with("|||||||") && state == S::Ours {
            state = S::Base;
            LineKind::Marker
        } else if c.starts_with("=======") && (state == S::Ours || state == S::Base) {
            state = S::Theirs;
            LineKind::Marker
        } else if c.starts_with(">>>>>>>") && state == S::Theirs {
            state = S::Out;
            LineKind::Marker
        } else {
            match state {
                S::Out | S::Base => LineKind::Context,
                S::Ours => LineKind::Ours,
                S::Theirs => LineKind::Theirs,
            }
        };
        lines.push(DiffLine {
            kind,
            content: c.to_string(),
            old_no: None,
            new_no: Some(i as u32 + 1),
            crlf,
        });
    }
    let n = lines.len() as u32;
    f.hunks.push(Hunk {
        header: String::new(),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: n,
        section: String::new(),
        lines,
    });
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = concat!(
        "diff --git a/src/main.rs b/src/main.rs\n",
        "index 1111111..2222222 100644\n",
        "--- a/src/main.rs\n",
        "+++ b/src/main.rs\n",
        "@@ -1,3 +1,4 @@ fn main() {\n",
        " line one\n",
        "-line two\n",
        "+line 2\n",
        "+line 2b\n",
        " line three\n",
        "@@ -10,2 +11,2 @@\n",
        " ten\n",
        "-eleven\r\n",
        "+ELEVEN\r\n",
        "\\ No newline at end of file\n",
    )
    .as_bytes();

    #[test]
    fn parses_hunks_and_line_numbers() {
        let files = parse(SAMPLE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.new_path.as_deref(), Some("src/main.rs"));
        assert_eq!(f.hunks.len(), 2);
        assert_eq!((f.additions, f.deletions), (3, 2));
        let h = &f.hunks[0];
        assert_eq!(h.section, "fn main() {");
        assert_eq!(h.lines[1].kind, LineKind::Del);
        assert_eq!(h.lines[1].old_no, Some(2));
        assert_eq!(h.lines[3].new_no, Some(3));
        assert_eq!(h.lines[4].old_no, Some(3));
        assert_eq!(h.lines[4].new_no, Some(4));
        let h2 = &f.hunks[1];
        assert!(h2.lines[1].crlf);
        assert_eq!(h2.lines[1].content, "eleven");
        assert_eq!(h2.lines[3].kind, LineKind::NoNewline);
    }

    #[test]
    fn builds_single_hunk_patch_byte_exact() {
        let p = patch_for_hunk(SAMPLE, "@@ -10,2 +11,2 @@").unwrap();
        let s = String::from_utf8(p).unwrap();
        assert!(s.starts_with("diff --git a/src/main.rs"));
        assert!(s.contains("-eleven\r\n"));
        assert!(!s.contains("line two"));
        assert!(patch_for_hunk(SAMPLE, "@@ -99 +99 @@").is_none());
    }

    #[test]
    fn builds_line_patches() {
        // Hunk 1 lines: 0 " line one", 1 "-line two", 2 "+line 2", 3 "+line 2b", 4 " line three"
        let p = String::from_utf8(
            patch_for_lines(SAMPLE, "@@ -1,3 +1,4 @@ fn main() {", &[3], false).unwrap(),
        )
        .unwrap();
        assert!(p.contains("@@ -1,3 +1,4 @@ fn main() {\n"));
        assert!(
            p.contains("\n line two\n"),
            "unselected deletion becomes context"
        );
        assert!(!p.contains("+line 2\n"), "unselected addition dropped");
        assert!(p.contains("+line 2b\n"));

        let r = String::from_utf8(
            patch_for_lines(SAMPLE, "@@ -1,3 +1,4 @@ fn main() {", &[1], true).unwrap(),
        )
        .unwrap();
        assert!(r.contains("-line two\n"));
        assert!(
            r.contains("\n line 2\n") && r.contains("\n line 2b\n"),
            "reverse: unselected additions become context"
        );
        assert!(
            r.contains("@@ -1,5 +1,4 @@"),
            "two additions became context on the old side"
        );

        // Only context selected → nothing to apply.
        assert!(patch_for_lines(SAMPLE, "@@ -1,3 +1,4 @@ fn main() {", &[0], false).is_none());
        // CRLF preserved; "no newline" marker follows its kept line.
        let c =
            String::from_utf8(patch_for_lines(SAMPLE, "@@ -10,2 +11,2 @@", &[2], false).unwrap())
                .unwrap();
        assert!(c.contains("+ELEVEN\r\n\\ No newline"));
        assert!(c.contains(" eleven\r\n"));
    }

    #[test]
    fn detects_binary_and_rename() {
        let raw = b"diff --git a/a.png b/b.png\nsimilarity index 90%\nrename from a.png\nrename to b.png\nBinary files a/a.png and b/b.png differ\n";
        let f = &parse(raw)[0];
        assert!(f.binary && f.renamed);
        assert_eq!(f.old_path.as_deref(), Some("a.png"));
        assert_eq!(f.new_path.as_deref(), Some("b.png"));
        assert_eq!(f.similarity, Some(90));
    }

    #[test]
    fn untracked_and_conflict_views() {
        let f = untracked_file_diff("x.txt", b"a\nb");
        assert_eq!(f.additions, 2);
        assert_eq!(f.hunks[0].lines.last().unwrap().kind, LineKind::NoNewline);
        assert!(untracked_file_diff("x.bin", b"\0\x01").binary);

        let c = conflict_file_view(
            "c.txt",
            b"top\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\n",
        );
        let kinds: Vec<_> = c.hunks[0].lines.iter().map(|l| l.kind).collect();
        assert_eq!(
            kinds,
            vec![
                LineKind::Context,
                LineKind::Marker,
                LineKind::Ours,
                LineKind::Marker,
                LineKind::Theirs,
                LineKind::Marker
            ]
        );
    }

    #[test]
    fn unquotes_paths() {
        assert_eq!(unquote("\"a\\tb\""), "a\tb");
        assert_eq!(unquote("\"caf\\303\\251\""), "café");
    }
}
