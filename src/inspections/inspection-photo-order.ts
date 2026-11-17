import { DAMAGE_SHOT_ID } from "./inspection-photo.entity.js";
/**
 * The viewing order of an inspection's photos: the shots by position, each followed by its close-ups by number (D112), then the
 * free-standing damage photos of an inspection made before D112, by number. Shared by the staff page, the ZIP and the PDF.
 */
export function sortPhotos<
  T extends { shotId: string; parentShotId: string | null; position: number },
>(photos: T[], shotPosition: ReadonlyMap<string, number>): T[] {
  const key = (photo: T): [number, number, number] => {
    if (photo.shotId !== DAMAGE_SHOT_ID) {
      return [0, shotPosition.get(photo.shotId) ?? 0, 0];
    }
    if (photo.parentShotId) {
      return [0, shotPosition.get(photo.parentShotId) ?? 0, photo.position];
    }
    return [1, 0, photo.position];
  };
  return [...photos].sort((a, b) => {
    const [a1, a2, a3] = key(a);
    const [b1, b2, b3] = key(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });
}

/**
 * The file name of a photo without extension, as downloads and the ZIP use it: `05_EXT_FRONT` for a shot,
 * `05_EXT_FRONT_damage_2` for its second close-up (D112), `damage_3` for an old free-standing damage photo.
 */
export function photoFileStem(
  photo: { shotId: string; parentShotId: string | null; position: number },
  shotPosition: ReadonlyMap<string, number>,
): string {
  const shotStem = (shotId: string) =>
    `${String(shotPosition.get(shotId) ?? 0).padStart(2, "0")}_${shotId}`;
  if (photo.shotId !== DAMAGE_SHOT_ID) return shotStem(photo.shotId);
  if (photo.parentShotId) {
    return `${shotStem(photo.parentShotId)}_damage_${photo.position}`;
  }
  return `damage_${photo.position}`;
}
