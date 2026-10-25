import { z } from 'zod';
export {
  AssetManifestValidationError,
  AssetManifestEntrySchema,
  BuildingDefinitionSchema,
  BuildingLevelSchema,
  CatalogEntrySchema,
  CatalogValidationError,
  CatalogVersionSchema,
  ItemDefinitionSchema,
  LocalCellSchema,
  PeaceCatalogSchema,
  PeaceAssetManifestSchema,
  ProfessionDefinitionSchema,
  RecipeDefinitionSchema,
  ResearchDefinitionSchema,
  parsePeaceAssetManifest,
  parsePeaceCatalog
} from './catalog.js';
export type {
  AssetManifestEntry,
  BuildingDefinition,
  CatalogEntry,
  CatalogVersion,
  ItemDefinition,
  PeaceCatalog,
  PeaceAssetManifest,
  ProfessionDefinition,
  RecipeDefinition,
  ResearchDefinition
} from './catalog.js';

export const GlobalCoordinateSchema = z.object({
  x: z.number().int().safe(),
  y: z.number().int().safe()
}).strict();
export type GlobalCoordinate = z.infer<typeof GlobalCoordinateSchema>;

export const CommandEnvelopeSchema = z.object({
  requestId: z.string().min(8).max(128),
  expectedWorldVersion: z.number().int().safe().nonnegative(),
  expectedGeometryVersion: z.number().int().safe().nonnegative()
}).strict();
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  instance: z.string().optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  requestId: z.string().min(8).max(128).optional()
}).strict();
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const WorldRevisionSchema = z.object({
  worldVersion: z.number().int().safe().nonnegative(),
  geometryVersion: z.number().int().safe().nonnegative(),
  serverTick: z.number().int().safe().nonnegative()
}).strict();
export type WorldRevision = z.infer<typeof WorldRevisionSchema>;

const EntityIdSchema = z.string().min(1).max(128);

export const PairingRequestSchema = z.object({
  code: z.string().min(1).max(128)
}).strict();
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

export const BuildIntentSchema = CommandEnvelopeSchema.extend({
  kind: z.literal('build'),
  buildingId: EntityIdSchema,
  anchor: GlobalCoordinateSchema
}).strict();
export type BuildIntent = z.infer<typeof BuildIntentSchema>;

export const AssignWorkIntentSchema = CommandEnvelopeSchema.extend({
  kind: z.literal('assign-work'),
  residentId: EntityIdSchema,
  workKind: z.enum(['gather', 'haul', 'build', 'clear', 'dig', 'craft', 'research']),
  targetId: EntityIdSchema
}).strict();
export type AssignWorkIntent = z.infer<typeof AssignWorkIntentSchema>;

const PreviewCellSchema = z.object({
  coordinate: GlobalCoordinateSchema,
  fillType: z.enum(['air', 'solid']),
  materialId: EntityIdSchema.optional()
}).strict();

const PreviewBuildingSchema = z.object({
  visualKey: EntityIdSchema,
  buildingId: EntityIdSchema,
  anchor: GlobalCoordinateSchema,
  state: z.enum(['planned', 'foundation', 'scaffold', 'complete', 'idle', 'operating', 'blocked'])
}).strict();

const PreviewActorSchema = z.object({
  visualKey: EntityIdSchema,
  position: GlobalCoordinateSchema,
  visualState: z.enum(['idle', 'walk', 'work', 'carry', 'dig', 'climb', 'study'])
}).strict();

export const ReadOnlyWorldPreviewSchema = z.object({
  revision: WorldRevisionSchema,
  cells: z.array(PreviewCellSchema),
  buildings: z.array(PreviewBuildingSchema),
  actors: z.array(PreviewActorSchema),
  resourceTotals: z.array(z.object({ itemId: EntityIdSchema, quantity: z.number().int().safe().nonnegative() }).strict())
}).strict();
export type ReadOnlyWorldPreview = z.infer<typeof ReadOnlyWorldPreviewSchema>;

export const PeaceCommandSchema = CommandEnvelopeSchema.extend({
  kind: z.enum(['collect-wood', 'deliver-wood', 'build-cabin'])
}).strict();
export type PeaceCommand = z.infer<typeof PeaceCommandSchema>;

export const PeaceWorldSnapshotSchema = z.object({
  revision: WorldRevisionSchema,
  resources: z.object({ wood: z.number().int().safe().nonnegative() }).strict(),
  tree: z.object({ position: GlobalCoordinateSchema, remaining: z.number().int().safe().nonnegative() }).strict(),
  worker: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    position: GlobalCoordinateSchema,
    visualState: z.enum(['idle', 'walk', 'work', 'carry']),
    cargo: z.number().int().safe().nonnegative()
  }).strict(),
  buildings: z.array(z.object({
    id: z.string().min(1),
    kind: z.literal('cabin'),
    anchor: GlobalCoordinateSchema,
    state: z.literal('complete')
  }).strict())
}).strict();
export type PeaceWorldSnapshot = z.infer<typeof PeaceWorldSnapshotSchema>;
