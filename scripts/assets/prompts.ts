import { STYLE_WORDS } from "@/domain/design/renderRequest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import type { FurnitureKind } from "@/domain/plan/types";
import type { InteriorStyle } from "@/domain/project/schema";

/** Bump when the wording changes, so cached reference pictures are made again. */
export const PROMPT_VERSION = 2;

/** What each piece is, in enough words that the picture shows the right thing. */
const WHAT: Record<FurnitureKind, string> = {
  sofa_3: "three-seat sofa with a low back, arms and loose seat cushions",
  sofa_2: "two-seat sofa with a low back, arms and loose seat cushions",
  armchair: "upholstered lounge armchair with arms",
  coffee_table: "low rectangular coffee table with a solid top, about knee height and much wider than it is tall",
  tv_unit: "low media console with closed storage, no television",
  bookcase: "tall open bookcase with a few books and objects on its shelves, shown on its own with no wall or room behind it",
  dining_set_4: "small rectangular dining table for four, about 130 cm long, with exactly four matching chairs: two tucked in along the front long side and two along the back long side, and no chairs at the ends",
  dining_set_6: "long rectangular dining table with three chairs tucked in along each long side, six chairs in all",
  sideboard: "long low sideboard with cabinet doors",
  kitchen_run: "run of fitted kitchen base units with a worktop, sink and hob",
  kitchen_island: "freestanding kitchen island with a worktop",
  fridge: "tall freestanding fridge freezer in brushed steel",
  bed_single: "single bed with an upholstered headboard, made with a duvet and a pillow",
  bed_double: "double bed with an upholstered headboard, made with a duvet, two pillows and a throw at the foot",
  bed_king: "king-size bed with an upholstered headboard, made with a duvet, two pillows and a throw at the foot",
  bedside_table: "small bedside table with a drawer",
  wardrobe: "tall double wardrobe with two doors",
  chest_of_drawers: "chest of drawers with three wide drawers",
  desk: "simple writing desk with an office chair tucked in at the front",
  bath: "white rectangular bath with a wooden side panel and a deck-mounted tap, shown on its own as a single object with no wall, tiles or floor round it",
  shower: "square walk-in shower tray with a glass screen",
  toilet: "white close-coupled toilet with the lid down",
  basin: "white washbasin on a freestanding vanity unit with a tap, shown on its own with no wall behind it",
  washing_machine: "white front-loading washing machine",
  worktop: "utility worktop on base cupboards",
  shelving: "tall open metal shelving unit",
  car: "generic modern family hatchback car in mid grey, not any real make or model, with no badges, logos or number plates",
  plant: "large leafy indoor plant in a ceramic floor pot",
};

/** The woods, fabrics and metals a style gives furniture, so the pieces of one style look like a set. */
const MATERIALS: Record<InteriorStyle, string> = {
  warm_minimal: "natural oak, oatmeal linen and bouclé, warm white, brushed brass details",
  modern: "smoked walnut, mid-grey woven fabric, matte black metal, white lacquer",
  scandinavian: "pale ash and birch, light grey wool, white, soft natural textiles",
  industrial: "dark stained timber, charcoal fabric, cognac leather, black steel",
  farmhouse: "honey-toned rustic oak, cream and stone linen, aged brass, painted wood",
  coastal: "whitewashed oak, sand and pale blue linen, rattan and cane",
};

const dims = (kind: FurnitureKind) => {
  const { width, depth, height } = FURNITURE_CATALOG[kind];
  return `${Math.round(width * 100)} cm wide, ${Math.round(depth * 100)} cm deep and ${Math.round(height * 100)} cm high`;
};

/**
 * The prompt for one piece's reference picture. The picture feeds an
 * image-to-3D service, so it shows one whole object, in a three-quarter view,
 * on a plain background, with nothing else in frame.
 */
export function referencePrompt(kind: FurnitureKind, style: InteriorStyle | "any"): string {
  const look = style === "any" ? "a neutral contemporary design" : `a ${STYLE_WORDS[style]} look: ${MATERIALS[style]}`;
  return [
    `A product photograph of a single unbranded ${WHAT[kind]}, about ${dims(kind)}, in ${look}.`,
    "The whole object is in frame and centred, seen in a three-quarter view from the front left and slightly above, at about 20 degrees.",
    "Isolated on a plain seamless light grey (#e8e8e8) studio background with soft, even, diffuse studio light and a faint shadow under it. No lighting equipment, backdrop edges or props visible.",
    "Realistic materials and proportions. No other objects, no room, no people, no text, no logos, no watermark.",
  ].join(" ");
}
