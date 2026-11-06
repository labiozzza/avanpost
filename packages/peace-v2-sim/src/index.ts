export { toGlobalCoordinate, toSectorCoordinate } from './coordinates.js';
export type { SectorCoordinate } from './coordinates.js';
export {
  G6_TERRITORY_CATALOG,
  deterministicSectorSeed,
  createClearingJob,
  updateClearingJobCompletion,
  assignClearingJobToResident,
  ensureTerritoryWorld,
  hashSectorCell,
  isSectorAdjacentToOwner,
  refreshTerritoryStates,
  scheduleClearingJobs,
  startSectorExpansion,
  startCellExpansion,
  unlockSector,
  sectorBoundsFor,
  sectorCoordinatesFor,
  sectorIdFor
} from './territory.js';
export { G33_STONE_BALANCE } from './g33-stone-config.js';
export { G72_PROFESSION_CATALOG, G72_SCHOOL_IDS, g72SchoolBuildingConfig, resolveG72Profession } from './g72-professions.js';
export type { G72ProfessionRecipe, G72SchoolId } from './g72-professions.js';
export {
  G6_2_UNDERGROUND_BALANCE,
  advanceLadderConstruction,
  advanceUndergroundWork,
  advanceUndergroundPlans,
  createLadder,
  demolishLadder,
  dispatchUndergroundJobs,
  ensureUndergroundWorld,
  ensureUndergroundDepth,
  generatedGeology,
  isUndergroundTunnel,
  canSafelyRelocateLadder,
  queueExcavation,
  queueUndergroundMining,
  previewUndergroundRoute,
  queueUndergroundRoute,
  cancelUndergroundRoute,
  undergroundCell,
  undergroundWorkPoint
} from './underground.js';
export {
  advancePopulation,
  ensurePopulationState,
  housingSummary,
  populationCanAdvance,
  redistributeResidentsToHousing,
  residentHasWork,
  awardCivilianExperience
} from './population.js';
export {
  undergroundConnectionMask,
  undergroundGeologyTileForCell,
  undergroundFloorLine,
  undergroundTileForMask
} from './underground-routing.js';
export type { UndergroundFailure, UndergroundResult } from './underground.js';
export {
  BUILDING_LAYOUT_VERSION,
  BUILDING_CELL_SIZE,
  BUILDING_ART_GEOMETRY,
  STORAGE_ART_GEOMETRY,
  buildingVisualCollisionWidth,
  PEACE_BUILDING_LAYOUTS,
  footprintCells,
  findSurfacePath,
  isSupportedUndergroundPosition,
  validateBuildingLayout,
  buildingAccessibility,
  occupiedFootprintCells,
  occupiedCellsForWorld,
  buildingEntrancePoints,
  buildingWorkPoints,
  storageEntrance,
  storageEntrancePoints,
  storageWorkPoints,
  storageWorkPoint,
  layoutForBuilding,
  isSchoolBuildingKind,
  schoolIdForBuildingKind,
  coordinateKey,
  expansionBatchConnectsToHome,
  preparedTerritoryConnectedToHome,
  disconnectedPreparedTerritory
} from './layout.js';
export type { PeaceBuildingLayout, BuildingArtGeometry, LayoutValidationResult, BuildingLayoutReason, BuildingLayoutFailure } from './layout.js';
export {
  advanceSettlement,
  cancelUnstartedBuildOrder,
  demolishBuilding,
  demolishStorage,
  createBuildCabinOrder,
  createBuildCabinTask,
  createBuildWorkshopOrder,
  createBuildSchoolOrder,
  startG72Training,
  cancelG72Training,
  createBuildWorkshopTask,
  createDeliveryTask,
  createGatherWoodTask,
  createGatherStoneTask,
  createStoneDeliveryTask,
  moveBuildOrder,
  scheduleWorkOrders,
  validateCabinPlacement,
  validateCabinOrderPlacement,
  validateWorkshopOrderPlacement,
  PEACE_V2_TICK_INTERVAL_MS,
  CABIN_FOOTPRINT,
  CABIN_BUILD_TICKS,
  WOOD_GATHER_TICKS,
  WOOD_LOADING_TICKS,
  WOOD_UNLOADING_TICKS,
  WOOD_REGROWTH_TICKS,
  COPPICE_REGROWTH_TICKS,
  WOOD_CABIN_COST,
  WORKSHOP_BUILD_TICKS,
  WORKSHOP_MATERIALS,
  PROPOSED_WAREHOUSE_BALANCE,
  SCHOOL_TRAINING_CAPACITY,
  STONE_MINER_ROLE,
  STONE_NODE_CONFIG
} from './settlement.js';
export type { CabinPlacementValidation, PlacementReason, DemolitionReason, DemolitionValidation } from './settlement.js';
