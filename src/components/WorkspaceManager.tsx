import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VscStarEmpty, VscStarFull, VscTrash, VscCheck, VscChromeClose } from 'react-icons/vsc';
import { useSessionContext, useUIContext } from '../context/AppContext';
import type { SavedWorkspaceMeta } from '../types';

// ── Save dialog ───────────────────────────────────────────────────────────────

function SaveWorkspaceDialog({ onSave, onCancel }: {
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="workspace-manager-backdrop" onClick={onCancel}>
      <div className="workspace-manager-dialog" onClick={e => e.stopPropagation()}>
        <div className="workspace-manager-dialog__title">Save Workspace</div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="workspace-manager-dialog__input"
            placeholder="Workspace name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
          />
          <div className="workspace-manager-dialog__actions">
            <button type="button" className="workspace-manager-btn workspace-manager-btn--secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="workspace-manager-btn workspace-manager-btn--primary" disabled={!name.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Load dialog ───────────────────────────────────────────────────────────────

function LoadWorkspaceDialog({ workspaces, defaultWorkspace, onLoad, onDelete, onSetDefault, onCancel }: {
  workspaces: SavedWorkspaceMeta[];
  defaultWorkspace: string | null;
  onLoad: (filename: string) => void;
  onDelete: (filename: string) => void;
  onSetDefault: (filename: string | null) => void;
  onCancel: () => void;
}) {
  const [confirmingFilename, setConfirmingFilename] = useState<string | null>(null);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="workspace-manager-backdrop" onClick={onCancel}>
      <div className="workspace-manager-dialog workspace-manager-dialog--list" onClick={e => e.stopPropagation()}>
        <div className="workspace-manager-dialog__title">Manage Workspaces</div>
        {workspaces.length === 0 ? (
          <div className="workspace-manager-empty">No saved workspaces yet.</div>
        ) : (
          <ul className="workspace-manager-list">
            {workspaces.map(ws => {
              const isDefault = ws.filename === defaultWorkspace;
              const isConfirming = confirmingFilename === ws.filename;
              return (
                <li
                  key={ws.filename}
                  className={[
                    'workspace-manager-list__item',
                    isDefault ? 'workspace-manager-list__item--default' : '',
                    isConfirming ? 'workspace-manager-list__item--confirming' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={isConfirming ? undefined : () => onLoad(ws.filename)}
                >
                  <div className="workspace-manager-list__info">
                    <span className="workspace-manager-list__name">{ws.name}</span>
                    <div className="workspace-manager-list__meta">
                      {ws.createdAt && (
                        <span className="workspace-manager-list__date">{formatDate(ws.createdAt)}</span>
                      )}
                      {isDefault && (
                        <span className="workspace-manager-list__default-badge">default</span>
                      )}
                    </div>
                  </div>
                  <div className="workspace-manager-list__actions" onClick={e => e.stopPropagation()}>
                    {isConfirming ? (
                      <>
                        <span className="workspace-manager-delete-label">Delete?</span>
                        <button
                          className="workspace-manager-icon-btn workspace-manager-icon-btn--confirm"
                          onClick={() => { onDelete(ws.filename); setConfirmingFilename(null); }}
                          title="Confirm delete"
                        >
                          <VscCheck />
                        </button>
                        <button
                          className="workspace-manager-icon-btn"
                          onClick={() => setConfirmingFilename(null)}
                          title="Cancel"
                        >
                          <VscChromeClose />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={`workspace-manager-icon-btn${isDefault ? ' workspace-manager-icon-btn--accent' : ''}`}
                          onClick={() => onSetDefault(isDefault ? null : ws.filename)}
                          title={isDefault ? 'Remove as default' : 'Set as default (loads on startup)'}
                        >
                          {isDefault ? <VscStarFull /> : <VscStarEmpty />}
                        </button>
                        <button
                          className="workspace-manager-icon-btn workspace-manager-icon-btn--trash"
                          onClick={() => setConfirmingFilename(ws.filename)}
                          title="Delete workspace"
                        >
                          <VscTrash />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="workspace-manager-dialog__actions">
          <button className="workspace-manager-btn workspace-manager-btn--secondary" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Public hook ───────────────────────────────────────────────────────────────

export type WorkspaceManagerMode = 'save' | 'load' | null;

export function WorkspaceManager({ mode, onClose }: { mode: WorkspaceManagerMode; onClose: () => void }) {
  const { saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace } = useSessionContext();
  const { settings, updateSettings } = useUIContext();
  const [workspaces, setWorkspaces] = useState<SavedWorkspaceMeta[]>([]);

  const refresh = useCallback(async () => {
    setWorkspaces(await listWorkspaces());
  }, [listWorkspaces]);

  useEffect(() => {
    if (mode === 'load') refresh();
  }, [mode, refresh]);

  if (!mode) return null;

  const handleSave = async (name: string) => {
    await saveWorkspace(name);
    window.api?.refreshDockMenu?.();
    onClose();
  };

  const handleLoad = async (filename: string) => {
    await loadWorkspace(filename);
    onClose();
  };

  const handleDelete = async (filename: string) => {
    await deleteWorkspace(filename);
    // If we deleted the default workspace, clear the default setting
    if (settings.defaultWorkspace === filename) {
      updateSettings({ defaultWorkspace: null });
    }
    window.api?.refreshDockMenu?.();
    setWorkspaces(prev => prev.filter(ws => ws.filename !== filename));
  };

  const handleSetDefault = (filename: string | null) => {
    updateSettings({ defaultWorkspace: filename });
  };

  if (mode === 'save') {
    return <SaveWorkspaceDialog onSave={handleSave} onCancel={onClose} />;
  }

  return (
    <LoadWorkspaceDialog
      workspaces={workspaces}
      defaultWorkspace={settings.defaultWorkspace ?? null}
      onLoad={handleLoad}
      onDelete={handleDelete}
      onSetDefault={handleSetDefault}
      onCancel={onClose}
    />
  );
}
