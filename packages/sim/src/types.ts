import type { TerrainType, Transport } from '@avanpost/shared';

export interface TerrainRule {
  id: TerrainType;
  label: string;
  color: string;
  passable: boolean;
  cartPassable: boolean;
  moveCost: number;
  clearable: boolean;
  clearingWork: number;
  becomes: TerrainType | null;
}

export interface BiomeRule {
  id: string;
  label: string;
  tint: string;
  weight: number;
  terrainWeights: Partial<Record<TerrainType, number>>;
}

export interface GeneratedCell {
  x: number;
  y: number;
  type: TerrainType;
  obstacle: boolean;
  passable: boolean;
}

export interface GraphModifier {
  x: number;
  y: number;
  passable: boolean;
  moveCost?: number;
  cartPassable?: boolean;
}

export interface GraphCell {
  x: number;
  y: number;
  type: TerrainType;
}

export interface GraphEdge {
  key: string;
  x: number;
  y: number;
  cost: number;
}

export type WorldGraph = Map<string, GraphEdge[]>;

export interface ClearingJobState {
  id: string;
  workDone: number;
  workRequired: number;
}

export interface ClearingAdvance {
  id: string;
  workDone: number;
  completed: boolean;
}

export type { Transport };
