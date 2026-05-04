import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSessionContext } from '../context/AppContext';

interface BranchData {
  local: string[];
  remote: string[];
  current: string;
}

type Item =
  | { kind: 'create'; name: string }
  | { kind: 'header'; label: string }
  | { kind: 'local'; name: string; isCurrent: boolean }
  | { kind: 'remote'; name: string; shortName: string };

export function BranchSwitcher() {
  const { gitRepoRoot, refreshGitStatus } = useSessionContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState<BranchData>({ local: [], remote: [], current: '' });
  const [loading, setLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('kraft:open-branch-switcher', handler);
    return () => window.removeEventListener('kraft:open-branch-switcher', handler);
  }, []);

  useEffect(() => {
    if (!open || !gitRepoRoot) return;
    setLoading(true);
    setCheckoutError(null);
    window.api.gitListBranches(gitRepoRoot)
      .then(result => { setBranches(result); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, gitRepoRoot]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    setCheckoutError(null);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const localSet = useMemo(() => new Set(branches.local), [branches.local]);

  const q = query.trim().toLowerCase();

  const items = useMemo<Item[]>(() => {
    const filteredLocal = branches.local.filter(b => !q || b.toLowerCase().includes(q));
    const filteredRemote = branches.remote.filter(r => {
      const short = r.replace(/^[^/]+\//, '');
      return !localSet.has(short) && (!q || r.toLowerCase().includes(q));
    });

    const result: Item[] = [];

    if (q) {
      const exactLocal = branches.local.includes(query.trim());
      const exactRemote = branches.remote.some(r => r.replace(/^[^/]+\//, '') === query.trim());
      if (!exactLocal && !exactRemote) {
        result.push({ kind: 'create', name: query.trim() });
      }
    }

    if (filteredLocal.length > 0) {
      result.push({ kind: 'header', label: 'local' });
      for (const b of filteredLocal) {
        result.push({ kind: 'local', name: b, isCurrent: b === branches.current });
      }
    }

    if (filteredRemote.length > 0) {
      result.push({ kind: 'header', label: 'remote' });
      for (const r of filteredRemote) {
        result.push({ kind: 'remote', name: r, shortName: r.replace(/^[^/]+\//, '') });
      }
    }

    return result;
  }, [q, query, branches, localSet]);

  const selectableIndices = useMemo(
    () => items.reduce<number[]>((acc, item, i) => { if (item.kind !== 'header') acc.push(i); return acc; }, []),
    [items]
  );

  useEffect(() => { setSelectedIndex(selectableIndices[0] ?? 0); }, [q]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const execute = useCallback(async (item: Item) => {
    if (item.kind === 'header' || isChecking || !gitRepoRoot) return;
    if (item.kind === 'local' && item.isCurrent) { setOpen(false); return; }

    setCheckoutError(null);
    setIsChecking(true);

    let result: { success: boolean; error: string | null };
    if (item.kind === 'create') {
      result = await window.api.gitCreateBranch(gitRepoRoot, item.name);
    } else if (item.kind === 'local') {
      result = await window.api.gitCheckoutBranch(gitRepoRoot, item.name);
    } else {
      result = await window.api.gitCheckoutBranch(gitRepoRoot, item.shortName);
    }

    setIsChecking(false);

    if (result.success) {
      setOpen(false);
      refreshGitStatus();
    } else {
      setCheckoutError(result.error || 'Branch switch failed');
    }
  }, [gitRepoRoot, refreshGitStatus, isChecking]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(cur => {
        const pos = selectableIndices.indexOf(cur);
        return pos < selectableIndices.length - 1 ? selectableIndices[pos + 1] : cur;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(cur => {
        const pos = selectableIndices.indexOf(cur);
        return pos > 0 ? selectableIndices[pos - 1] : cur;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) execute(item);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="branch-switcher-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="branch-switcher"
        role="dialog"
        aria-label="Switch branch"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="branch-switcher-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Select branch or type to create new…"
          disabled={isChecking}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="branch-switcher-list" ref={listRef}>
          {loading ? (
            <div className="branch-switcher-empty">Loading branches…</div>
          ) : items.length === 0 ? (
            <div className="branch-switcher-empty">
              {q ? 'No matching branches' : 'No branches found'}
            </div>
          ) : (
            items.map((item, index) => {
              if (item.kind === 'header') {
                return (
                  <div key={`header-${item.label}`} className="branch-switcher-section">
                    {item.label}
                  </div>
                );
              }
              return (
                <div
                  key={`${item.kind}-${item.name}`}
                  data-index={index}
                  className={`branch-switcher-item${index === selectedIndex ? ' active' : ''}${isChecking ? ' disabled' : ''}`}
                  onMouseEnter={() => !isChecking && setSelectedIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execute(item)}
                >
                  {item.kind === 'create' ? (
                    <>
                      <span className="branch-switcher-create-icon">+</span>
                      <span className="branch-switcher-create-label">
                        Create new branch: <strong>{item.name}</strong>
                      </span>
                    </>
                  ) : item.kind === 'local' ? (
                    <>
                      <span className="branch-switcher-check">{item.isCurrent ? '✓' : ''}</span>
                      <span className="branch-switcher-name">{item.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="branch-switcher-check" />
                      <span className="branch-switcher-name">{item.shortName}</span>
                      <span className="branch-switcher-remote-tag">remote</span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
        {checkoutError && (
          <div className="branch-switcher-error">{checkoutError}</div>
        )}
      </div>
    </div>
  );
}
