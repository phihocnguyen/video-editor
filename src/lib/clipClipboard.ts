import {
  deleteClips,
  duplicateClips,
  pasteClips,
  snapshotClipsForClipboard,
} from "../domain";
import { useEditorUiStore, editFollowsLink } from "../stores/editorUiStore";
import { commitProjectChange } from "../stores/historyStore";
import { useProjectStore } from "../stores/projectStore";

export function copySelectedClips(): boolean {
  const ids = useEditorUiStore.getState().selectedClipIds;
  if (ids.length === 0) return false;
  const project = useProjectStore.getState().project;
  const snaps = snapshotClipsForClipboard(project, ids);
  if (snaps.length === 0) return false;
  useEditorUiStore.getState().setClipClipboard(snaps);
  useEditorUiStore
    .getState()
    .setStatusMessage(
      snaps.length === 1 ? "Copied clip" : `Copied ${snaps.length} clips`,
    );
  return true;
}

export function cutSelectedClips(): boolean {
  const ids = useEditorUiStore.getState().selectedClipIds;
  if (ids.length === 0) return false;
  if (!copySelectedClips()) return false;
  commitProjectChange((p) =>
    deleteClips(p, ids, { followLink: editFollowsLink(ids) }),
  );
  useEditorUiStore.getState().setSelectedClipIds([]);
  useEditorUiStore.getState().setStatusMessage("Cut clip(s)");
  return true;
}

export function pasteClipboardClips(atTicks?: number): boolean {
  const clipboard = useEditorUiStore.getState().clipClipboard;
  if (!clipboard || clipboard.length === 0) {
    useEditorUiStore.getState().setStatusMessage("Clipboard empty");
    return false;
  }
  const playhead =
    atTicks ?? useEditorUiStore.getState().playheadTicks;
  try {
    let newIds: string[] = [];
    commitProjectChange((p) => {
      const result = pasteClips(p, clipboard, playhead);
      newIds = result.newIds;
      return result.project;
    });
    useEditorUiStore.getState().setSelectedClipIds(newIds);
    useEditorUiStore
      .getState()
      .setStatusMessage(
        newIds.length === 1 ? "Pasted clip" : `Pasted ${newIds.length} clips`,
      );
    return true;
  } catch (error) {
    useEditorUiStore.getState().setStatusMessage(
      error instanceof Error ? error.message : "Paste failed",
    );
    return false;
  }
}

export function duplicateSelectedClips(): boolean {
  const ids = useEditorUiStore.getState().selectedClipIds;
  if (ids.length === 0) return false;
  try {
    let newIds: string[] = [];
    commitProjectChange((p) => {
      const result = duplicateClips(p, ids);
      newIds = result.newIds;
      return result.project;
    });
    useEditorUiStore.getState().setSelectedClipIds(newIds);
    useEditorUiStore.getState().setStatusMessage("Duplicated");
    return true;
  } catch (error) {
    useEditorUiStore.getState().setStatusMessage(
      error instanceof Error ? error.message : "Duplicate failed",
    );
    return false;
  }
}
