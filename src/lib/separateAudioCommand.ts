import { separateVideoSoundtrack } from "./projectActions";
import { commitProjectChange } from "../stores/historyStore";
import { useEditorUiStore } from "../stores/editorUiStore";
import { useProjectStore } from "../stores/projectStore";

/** Pull the selected video's soundtrack onto its own track. */
export async function separateSelectedVideoAudio(): Promise<void> {
  const ui = useEditorUiStore.getState();
  const project = useProjectStore.getState().project;
  const clip = project.clips.find((item) => {
    if (!ui.selectedClipIds.includes(item.id) || item.kind !== "media" || !item.assetId) {
      return false;
    }
    const asset = project.assets.find((candidate) => candidate.id === item.assetId);
    return asset?.kind === "video";
  });
  if (!clip) {
    ui.setStatusMessage("Select a video to separate its audio");
    return;
  }
  if (clip.linkedClipId && project.clips.some((item) => item.id === clip.linkedClipId)) {
    ui.setStatusMessage("Audio is already on its own track");
    return;
  }

  const beforeIds = new Set(project.clips.map((item) => item.id));
  ui.setStatusMessage("Separating audio…");
  try {
    const next = await separateVideoSoundtrack(project, clip.id);
    const created = next.clips.find((item) => !beforeIds.has(item.id));
    commitProjectChange(() => next);
    if (created) ui.setSelectedClipIds([created.id]);
    ui.setStatusMessage("Audio separated. Deleting the video leaves the soundtrack.");
  } catch (error) {
    ui.setStatusMessage(error instanceof Error ? error.message : "Could not separate audio");
  }
}
