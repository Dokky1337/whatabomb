export interface DifficultyConfig {
  aiMoveSpeed: number // milliseconds between moves
  aiBombChance: number // 0-1 probability
  aiMinEscapeRoutes: number
  powerUpDropRate: number // 0-1 probability
  enemyStartingLives: number
  playerStartingLives: number
}

export const DIFFICULTY_CONFIGS: Record<'easy' | 'medium' | 'hard', DifficultyConfig> = {
  easy: {
    aiMoveSpeed: 1000, // Slower
    aiBombChance: 0.10, // Less aggressive
    aiMinEscapeRoutes: 2,
    powerUpDropRate: 0.5, // More power-ups
    enemyStartingLives: 2, // Fewer lives
    playerStartingLives: 4, // More lives
  },
  medium: {
    aiMoveSpeed: 800, // Normal
    aiBombChance: 0.15,
    aiMinEscapeRoutes: 2,
    powerUpDropRate: 0.4, // Normal
    enemyStartingLives: 3,
    playerStartingLives: 3,
  },
  hard: {
    aiMoveSpeed: 600, // Faster
    aiBombChance: 0.25, // More aggressive
    aiMinEscapeRoutes: 1, // Takes more risks
    powerUpDropRate: 0.3, // Fewer power-ups
    enemyStartingLives: 4, // More lives
    playerStartingLives: 3,
  },
}

export function getDifficultyConfig(difficulty: 'easy' | 'medium' | 'hard'): DifficultyConfig {
  return DIFFICULTY_CONFIGS[difficulty]
}
