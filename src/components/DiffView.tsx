import React, { useState, useEffect, useMemo } from 'react';
import { useSessionContext } from '../context/AppContext';

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldNum: number | null;
  newNum: number | null;
}

function parseDiff(diffText: string): DiffHunk[] {
  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (hunkMatch) {
      current = { header: line, lines: [] };
      hunks.push(current);
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'remove', content: line.slice(1), oldNum: oldLine, newNum: null });
      oldLine++;
    } else if (line.startsWith(' ')) {
      current.lines.push({ type: 'context', content: line.slice(1), oldNum: oldLine, newNum: newLine });
      oldLine++;
      newLine++;
    } else if (line === '\\ No newline at end of file') {
      continue;
    }
  }

  return hunks;
}

function buildNewFileHunks(content: string): DiffHunk[] {
  const lines = content.split('\n');
  return [{
    header: `@@ -0,0 +1,${lines.length} @@ (new file)`,
    lines: lines.map((line, i) => ({
      type: 'add' as const,
      content: line,
      oldNum: null,
      newNum: i + 1,
    })),
  }];
}

interface DiffViewProps {
  filePath: string;
  version: number;
}

export function DiffView({ filePath, version }: DiffViewProps) {
  const { getRepoRootForFile } = useSessionContext();
  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const repoRoot = getRepoRootForFile(filePath);
    if (!repoRoot || !filePath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await window.api.getGitDiff(filePath, repoRoot);
        if (cancelled) return;

        if (result.isNew && result.content != null) {
          setHunks(buildNewFileHunks(result.content));
        } else if (result.diff) {
          setHunks(parseDiff(result.diff));
        } else {
          setHunks([]);
          setError('No changes detected');
        }
      } catch {
        if (!cancelled) setError('Failed to load diff');
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [filePath, version, getRepoRootForFile]);

  const maxLineNum = useMemo(() => {
    let max = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.oldNum && line.oldNum > max) max = line.oldNum;
        if (line.newNum && line.newNum > max) max = line.newNum;
      }
    }
    return max;
  }, [hunks]);

  const gutterWidth = Math.max(String(maxLineNum).length, 3);

  if (loading) {
    return <div className="diff-view-placeholder">Loading diff...</div>;
  }

  if (error) {
    return <div className="diff-view-placeholder">{error}</div>;
  }

  if (hunks.length === 0) {
    return <div className="diff-view-placeholder">No changes</div>;
  }

  return (
    <div className="diff-view">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line diff-line-${line.type}`}>
              <span className="diff-gutter diff-gutter-old" style={{ width: `${gutterWidth + 1}ch` }}>
                {line.oldNum ?? ''}
              </span>
              <span className="diff-gutter diff-gutter-new" style={{ width: `${gutterWidth + 1}ch` }}>
                {line.newNum ?? ''}
              </span>
              <span className="diff-sign">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span className="diff-content">{line.content}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
