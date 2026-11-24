import type { ExteriorAngle } from "@/domain/design/renderRequest";
import type { CameraPose } from "./roomCamera";

/**
 * Moves the house's front camera to another side. The front pose looks across
 * a corner from the garden; "rear" stands on the opposite corner, and
 * "aerial" pulls back and climbs so the roof and plot are in view.
 */
export function exteriorAnglePose(pose: CameraPose, angle: ExteriorAngle = "front"): CameraPose {
  if (angle === "front") return pose;
  const dx = pose.eye.x - pose.target.x;
  const dy = pose.eye.y - pose.target.y;
  if (angle === "rear") return { ...pose, eye: { ...pose.eye, x: pose.target.x - dx, y: pose.target.y - dy } };
  const reach = Math.hypot(dx, dy);
  return { ...pose, eye: { x: pose.target.x + dx * 1.25, y: pose.target.y + dy * 1.25, z: pose.eye.z + reach * 0.75 }, target: { ...pose.target, z: 0.6 } };
}
