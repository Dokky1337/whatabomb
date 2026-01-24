import { Color3 } from '@babylonjs/core'

export type MapSize = 'small' | 'medium' | 'large'
export type MapTheme = 'classic' | 'ice' | 'lava' | 'forest' | 'space'

export interface MapConfig {
  size: MapSize
  theme: MapTheme
  gridWidth: number
  gridHeight: number
  colors: {
    ground: Color3
    wall: Color3
    destructible: Color3
    ambient: Color3
  }
  name: string
  description: string
}

export const MAP_CONFIGS: Record<string, MapConfig> = {
  'small-classic': {
    size: 'small',
    theme: 'classic',
    gridWidth: 11,
    gridHeight: 11,
    name: 'Small Arena',
    description: 'Fast-paced battles in a compact space',
    colors: {
      ground: new Color3(0.15, 0.35, 0.15),
      wall: new Color3(0.5, 0.5, 0.5),
      destructible: new Color3(0.7, 0.6, 0.4),
      ambient: new Color3(0.1, 0.2, 0.1),
    },
  },
  'medium-classic': {
    size: 'medium',
    theme: 'classic',
    gridWidth: 17,
    gridHeight: 17,
    name: 'Classic Arena',
    description: 'The original battlefield',
    colors: {
      ground: new Color3(0.15, 0.35, 0.15),
      wall: new Color3(0.5, 0.5, 0.5),
      destructible: new Color3(0.7, 0.6, 0.4),
      ambient: new Color3(0.1, 0.2, 0.1),
    },
  },
  'medium-ice': {
    size: 'medium',
    theme: 'ice',
    gridWidth: 17,
    gridHeight: 17,
    name: 'Ice Arena',
    description: 'Frozen battlefield with icy colors',
    colors: {
      ground: new Color3(0.7, 0.85, 0.95),
      wall: new Color3(0.5, 0.7, 0.9),
      destructible: new Color3(0.8, 0.9, 1.0),
      ambient: new Color3(0.6, 0.7, 0.8),
    },
  },
  'medium-lava': {
    size: 'medium',
    theme: 'lava',
    gridWidth: 17,
    gridHeight: 17,
    name: 'Lava Arena',
    description: 'Volcanic battlefield with fiery colors',
    colors: {
      ground: new Color3(0.3, 0.1, 0.05),
      wall: new Color3(0.2, 0.2, 0.2),
      destructible: new Color3(0.6, 0.3, 0.1),
      ambient: new Color3(0.3, 0.1, 0.0),
    },
  },
  'medium-forest': {
    size: 'medium',
    theme: 'forest',
    gridWidth: 17,
    gridHeight: 17,
    name: 'Forest Arena',
    description: 'Natural battlefield with earthy colors',
    colors: {
      ground: new Color3(0.2, 0.4, 0.15),
      wall: new Color3(0.3, 0.25, 0.2),
      destructible: new Color3(0.5, 0.35, 0.2),
      ambient: new Color3(0.15, 0.25, 0.1),
    },
  },
  'small-ice': {
    size: 'small',
    theme: 'ice',
    gridWidth: 11,
    gridHeight: 11,
    name: 'Small Ice Arena',
    description: 'Quick frozen battles',
    colors: {
      ground: new Color3(0.7, 0.85, 0.95),
      wall: new Color3(0.5, 0.7, 0.9),
      destructible: new Color3(0.8, 0.9, 1.0),
      ambient: new Color3(0.6, 0.7, 0.8),
    },
  },
  'small-lava': {
    size: 'small',
    theme: 'lava',
    gridWidth: 11,
    gridHeight: 11,
    name: 'Small Lava Arena',
    description: 'Intense volcanic action',
    colors: {
      ground: new Color3(0.3, 0.1, 0.05),
      wall: new Color3(0.2, 0.2, 0.2),
      destructible: new Color3(0.6, 0.3, 0.1),
      ambient: new Color3(0.3, 0.1, 0.0),
    },
  },
  'small-forest': {
    size: 'small',
    theme: 'forest',
    gridWidth: 11,
    gridHeight: 11,
    name: 'Small Forest Arena',
    description: 'Quick woodland skirmishes',
    colors: {
      ground: new Color3(0.2, 0.4, 0.15),
      wall: new Color3(0.3, 0.25, 0.2),
      destructible: new Color3(0.5, 0.35, 0.2),
      ambient: new Color3(0.15, 0.25, 0.1),
    },
  },
  'medium-space': {
    size: 'medium',
    theme: 'space',
    gridWidth: 17,
    gridHeight: 17,
    name: 'Moon Base',
    description: 'Low gravity battles in the deep void',
    colors: {
      ground: new Color3(0.1, 0.05, 0.2), // Deep purple/black
      wall: new Color3(0.1, 0.8, 0.9), // Cyan neon
      destructible: new Color3(0.4, 0.4, 0.5), // Grey metal
      ambient: new Color3(0.1, 0.1, 0.3), // Blueish ambient
    },
  },
}

export function getMapConfig(key: string): MapConfig {
  return MAP_CONFIGS[key] || MAP_CONFIGS['medium-classic']
}

export function getAllMaps(): MapConfig[] {
  return Object.values(MAP_CONFIGS)
}

export function getMapsBySize(size: MapSize): MapConfig[] {
  return Object.values(MAP_CONFIGS).filter(map => map.size === size)
}

export function getMapsByTheme(theme: MapTheme): MapConfig[] {
  return Object.values(MAP_CONFIGS).filter(map => map.theme === theme)
}
