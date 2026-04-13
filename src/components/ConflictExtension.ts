import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, Text, RangeSetBuilder, EditorState } from '@codemirror/state';

export interface ConflictBlock {
  index: number;
  ourMarkerLine: number;   // 1-based line of <<<<<<<
  sepLine: number;         // 1-based line of =======
  theirMarkerLine: number; // 1-based line of >>>>>>>
  ourLabel: string;
  theirLabel: string;
}

export function parseConflictBlocks(doc: Text): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let current: Partial<ConflictBlock> | null = null;
  let index = 0;

  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    if (text.startsWith('<<<<<<<')) {
      current = { index: index++, ourMarkerLine: i, ourLabel: text.slice(8).trim() || 'HEAD' };
    } else if (current != null && current.sepLine == null && text.startsWith('=======')) {
      current.sepLine = i;
    } else if (current != null && current.sepLine != null && text.startsWith('>>>>>>>')) {
      current.theirMarkerLine = i;
      current.theirLabel = text.slice(8).trim();
      blocks.push(current as ConflictBlock);
      current = null;
    }
  }

  return blocks;
}

export const conflictBlocksField = StateField.define<ConflictBlock[]>({
  create: (state) => parseConflictBlocks(state.doc),
  update: (blocks, tr) => (tr.docChanged ? parseConflictBlocks(tr.state.doc) : blocks),
});

type ResolveType = 'current' | 'incoming' | 'both';

function computeResolution(
  doc: Text,
  block: ConflictBlock,
  type: ResolveType,
): { from: number; to: number; insert: string } {
  const { ourMarkerLine, sepLine, theirMarkerLine } = block;
  const blockFrom = doc.line(ourMarkerLine).from;
  const blockTo = theirMarkerLine < doc.lines
    ? doc.line(theirMarkerLine + 1).from
    : doc.length;

  const oursLines: string[] = [];
  for (let l = ourMarkerLine + 1; l < sepLine; l++) oursLines.push(doc.line(l).text);

  const theirsLines: string[] = [];
  for (let l = sepLine + 1; l < theirMarkerLine; l++) theirsLines.push(doc.line(l).text);

  const lines =
    type === 'current' ? oursLines :
    type === 'incoming' ? theirsLines :
    [...oursLines, ...theirsLines];

  const isLastBlock = theirMarkerLine >= doc.lines;
  const insert = lines.length > 0
    ? lines.join('\n') + (isLastBlock ? '' : '\n')
    : (isLastBlock ? '' : '');

  return { from: blockFrom, to: blockTo, insert };
}

// Widget receives `view` via toDOM — no need to pass dispatch at construction time
class ConflictActionWidget extends WidgetType {
  constructor(private readonly blockIndex: number) { super(); }

  eq(other: ConflictActionWidget) {
    return other.blockIndex === this.blockIndex;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-conflict-actions';

    const label = document.createElement('span');
    label.className = 'cm-conflict-actions-label';
    label.textContent = 'Current Change';
    wrap.appendChild(label);

    const divider = () => {
      const d = document.createElement('span');
      d.className = 'cm-conflict-actions-divider';
      d.textContent = '|';
      return d;
    };

    const makeBtn = (text: string, type: ResolveType) => {
      const btn = document.createElement('button');
      btn.className = 'cm-conflict-btn';
      btn.textContent = text;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const block = view.state.field(conflictBlocksField).find((b) => b.index === this.blockIndex);
        if (!block) return;
        view.dispatch({ changes: computeResolution(view.state.doc, block, type) });
      });
      return btn;
    };

    wrap.appendChild(makeBtn('Accept Current', 'current'));
    wrap.appendChild(divider());
    wrap.appendChild(makeBtn('Accept Incoming', 'incoming'));
    wrap.appendChild(divider());
    wrap.appendChild(makeBtn('Accept Both', 'both'));

    return wrap;
  }

  ignoreEvent() { return true; }
}

function buildDecorations(state: EditorState): DecorationSet {
  const blocks = state.field(conflictBlocksField);
  if (blocks.length === 0) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    const { ourMarkerLine, sepLine, theirMarkerLine } = block;

    const ourFrom = state.doc.line(ourMarkerLine).from;
    const ourTo   = state.doc.line(ourMarkerLine).to;

    // <<<< marker line background + inline action widget at end of line
    builder.add(ourFrom, ourFrom, Decoration.line({ class: 'cm-conflict-marker-ours-line' }));
    builder.add(ourTo,   ourTo,   Decoration.widget({ widget: new ConflictActionWidget(block.index), side: 1 }));

    // "Ours" content lines
    for (let l = ourMarkerLine + 1; l < sepLine; l++) {
      const lf = state.doc.line(l).from;
      builder.add(lf, lf, Decoration.line({ class: 'cm-conflict-ours-line' }));
    }

    // ==== separator
    const sepFrom = state.doc.line(sepLine).from;
    builder.add(sepFrom, sepFrom, Decoration.line({ class: 'cm-conflict-sep-line' }));

    // "Theirs" content lines
    for (let l = sepLine + 1; l < theirMarkerLine; l++) {
      const lf = state.doc.line(l).from;
      builder.add(lf, lf, Decoration.line({ class: 'cm-conflict-theirs-line' }));
    }

    // >>>> marker line
    const theirFrom = state.doc.line(theirMarkerLine).from;
    builder.add(theirFrom, theirFrom, Decoration.line({ class: 'cm-conflict-marker-theirs-line' }));
  }

  return builder.finish();
}

// StateField (not ViewPlugin) — the only correct way to provide decorations
// that include widgets, per CM6 docs.
const conflictDecorationsField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (decs, tr) => {
    if (!tr.docChanged) return decs;
    return buildDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function navigateConflict(view: EditorView, direction: 'next' | 'prev') {
  const blocks = view.state.field(conflictBlocksField);
  if (blocks.length === 0) return;

  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;

  let target: ConflictBlock;
  if (direction === 'next') {
    target = blocks.find((b) => b.ourMarkerLine > cursorLine) ?? blocks[0];
  } else {
    const rev = [...blocks].reverse();
    target = rev.find((b) => b.theirMarkerLine < cursorLine) ?? blocks[blocks.length - 1];
  }

  const pos = view.state.doc.line(target.ourMarkerLine).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 60 }),
  });
}

export function conflictExtension() {
  return [conflictBlocksField, conflictDecorationsField];
}
