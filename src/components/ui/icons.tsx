import type { SVGProps } from "react";

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type IconProps = SVGProps<SVGSVGElement>;

export const SelectIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 3.5 18.5 11l-6 1.6-3 5.9z" />
  </svg>
);

export const WallIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="10.5" width="18" height="3" rx="0.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Corner brackets: a space defined by the walls around it. */
export const RoomIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <path d="M11 4h2M11 20h2M4 11v2M20 11v2" />
  </svg>
);

export const OutlineIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 4h9v6h7v10H4z" />
    <circle cx="4" cy="4" r="1.6" fill="currentColor" />
    <circle cx="13" cy="10" r="1.6" fill="currentColor" />
  </svg>
);

export const DoorIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 20V4" />
    <path d="M5 4a14 14 0 0 1 14 16" />
    <path d="M3 20h18" />
  </svg>
);

export const WindowIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M12 7v10M8.5 12h7" />
  </svg>
);

export const StairsIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 20v-5h5v-5h5V5h6v5h-5v5h-5v5z" />
  </svg>
);

export const ColumnIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </svg>
);

export const CloudIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7.5 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.7 4.7 0 0 0 7.5 18.5z" />
  </svg>
);

export const UsersIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </svg>
);

/** Filled arrowhead pointing up: plan north. */
export const NorthArrowIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3 19 20l-7-3.5L5 20z" fill="currentColor" strokeWidth={1.2} />
  </svg>
);

export const ExpandIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </svg>
);

export const ShrinkIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
  </svg>
);

/** Frame with a centred target: fit the plan to the view. */
export const FitIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

export const RedoIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MinusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
);

export const GridIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17" />
  </svg>
);

export const MagnetIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5.5 4h4v7a2.5 2.5 0 0 0 5 0V4h4v7a6.5 6.5 0 0 1-13 0z" />
    <path d="M5.5 8h4M14.5 8h4" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

export const FileIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4" />
  </svg>
);

export const LayersIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity={0.55} />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ShareIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v6h14v-6" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
);

/** Mirror along the wall: moves the hinge to the other jamb. */
export const FlipHingeIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3v18" strokeDasharray="2 2.5" />
    <path d="M8 7 4 12l4 5V7zM16 7l4 5-4 5V7z" />
  </svg>
);

/** Mirror across the wall: swings the leaf to the other side. */
export const FlipSwingIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 12h18" strokeDasharray="2 2.5" />
    <path d="M7 8 12 4l5 4H7zM7 16l5 4 5-4H7z" />
  </svg>
);

export const HouseMark = (p: IconProps) => (
  <svg {...base} strokeWidth={1.9} {...p}>
    <path d="M4 11 12 4.5l8 6.5" />
    <path d="M6.5 9.5V19.5h11V9.5" />
    <path d="M12 19.5v-5h3.5" />
  </svg>
);

export const SparkleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7L4.5 11l5.7-1.9z" />
    <path d="M19 3v3M17.5 4.5h3" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.2h8.4a1 1 0 0 1 1 1V18.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
  </svg>
);

export const TemplateIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9.5 12 6.5l4 3V15H8z" />
    <path d="M7.5 17.5h9" />
  </svg>
);

export const HelpIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7" />
    <path d="M12 16.8v.2" strokeWidth={2.2} />
  </svg>
);

export const SettingsIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const PlayCircleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10.2 8.8v6.4l5-3.2z" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const MoreIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/** A blank frame with corner and edge ticks: drawing from scratch. */
export const BlankCanvasIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.4} {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="0.5" />
    <path d="M12 4.5v3M12 16.5v3M3.5 12h3M17.5 12h3" />
  </svg>
);

/** A house outline with a dimension line: entering measurements. */
export const DimensionsIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.4} {...p}>
    <path d="M4.5 11.5 12 5l7.5 6.5" />
    <path d="M6.5 10v7.5h11V10" />
    <path d="M4 20.5h16M4 19.5v2M20 19.5v2" />
  </svg>
);

/** A picture with an upload arrow: importing a plan. */
export const ImportPlanIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.4} {...p}>
    <path d="M14.5 3.5H5.5v17h13V7.5z" />
    <path d="M14.5 3.5v4h4" />
    <path d="m7.5 17.5 3-3.5 2 2 1.5-1.5 2.5 3" />
    <path d="M15.5 13V9.5M14 11l1.5-1.5L17 11" />
  </svg>
);

/** A frame with a pencil: drawing from scratch. */
export const DrawIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.4} {...p}>
    <path d="M13 4.5H4.5v15h15V11" />
    <path d="M4.5 9.5H7M9.5 4.5V7" />
    <path d="m11 15.5.6-2.6 6.8-6.8a1.4 1.4 0 0 1 2 2l-6.8 6.8z" />
  </svg>
);

/** A framed picture: importing an existing plan. */
export const ImageIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.4} {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m4 18 5.5-5 3.5 3 2.5-2 4.5 4" />
  </svg>
);

/** A box with a plus: adding to an existing building. */
export const ExtensionIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.5} {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="1" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

/** A small building with windows: garages, studios and other buildings. */
export const OutbuildingIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={1.5} {...p}>
    <path d="M5 20.5V4.5h9v16M14 9.5h5v11M3.5 20.5h17" />
    <path d="M8 8h3M8 11.5h3M8 15h3M16.5 13h.5M16.5 16h.5" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={2.2} {...p}>
    <path d="m6 12.5 4 4 8-9" />
  </svg>
);

export const UploadIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M4.5 14.5v5h15v-5" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.6L20 16" />
    <path d="M20 20v-4h-4" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const BedIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 15h18" />
    <path d="M6 9V6.5A1.5 1.5 0 0 1 7.5 5h9A1.5 1.5 0 0 1 18 6.5V9" />
  </svg>
);

export const BathIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" />
    <path d="M6 12V5.5A1.5 1.5 0 0 1 9 5.5" />
    <path d="M7 19l-1 2M17 19l1 2" />
  </svg>
);

/** A floor area: a square with corner ticks. */
export const AreaIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
    <path d="M9 9h6v6H9z" opacity={0.5} />
  </svg>
);

export const SofaIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    <path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z" />
    <path d="M5 18v2M19 18v2" />
  </svg>
);

export const DeskIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 9h18M5 9v11M19 9v11M14 9v6h5" />
    <path d="M8 9V5h5v4" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
);

export const SwapIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 8h14l-3-3M20 16H6l3 3" />
  </svg>
);

export const SendIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M21 3 10 14" />
    <path d="m21 3-7 18-4-7-7-4z" />
  </svg>
);

export const TargetIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const ArmchairIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 11V7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4" />
    <path d="M4 12a2 2 0 0 1 4 0v2h8v-2a2 2 0 0 1 4 0v6H4z" />
    <path d="M6 18v2M18 18v2" />
  </svg>
);

export const LeafIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" />
    <path d="M5 19 13 11" />
  </svg>
);

export const VariationsIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="11" height="11" rx="1.5" />
    <path d="M17 7h2.5A1.5 1.5 0 0 1 21 8.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 7 19.5V17" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </svg>
);

export const OrbitIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <path d="M12 3v18" opacity={0.5} />
    <path d="m18 6 3 2-3.4.8" />
  </svg>
);

export const PanIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3v18M3 12h18" />
    <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
  </svg>
);

export const WalkIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="13" cy="4.5" r="1.8" />
    <path d="m9 21 2.5-6 2.5 2v4M10 10.5l3-2.5 2.5 3 3 1M13 8l-1.5 7M8 12l2-1.5" />
  </svg>
);

export const InteriorIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 15h6v5M14 9h6" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const AerialIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 15 12 19l8-4-8-4z" />
    <path d="M12 3v6M9.5 6.5 12 9l2.5-2.5" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const BulbIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </svg>
);

export const PaletteIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1.1.2-2.2 1.4-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ExteriorIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 11 12 4l9 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5h4v5" />
    <path d="M2 20h20" />
  </svg>
);
