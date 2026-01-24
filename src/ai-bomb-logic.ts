import type { Grid } from './grid'

export interface BombPlacementDecision {
  shouldPlace: boolean
  reason: string
  escapeDirection?: { dx: number, dy: number }
}

export interface AIBombContext {
  enemyX: number
  enemyY: number
  playerX: number
  playerY: number
  grid: Grid
  gridWidth: number
  gridHeight: number
  bombs: Array<{ x: number; y: number; blastRadius: number }>
  blastRadius: number
  difficulty: 'easy' | 'medium' | 'hard'
}

const DIRECTIONS = [
  { dx: 0, dy: -1 },  // up
  { dx: 0, dy: 1 },   // down
  { dx: -1, dy: 0 },  // left
  { dx: 1, dy: 0 },   // right
]

/**
 * Check if a position is in the blast zone of a bomb
 */
function isInBlastZone(
  posX: number, 
  posY: number, 
  bombX: number, 
  bombY: number, 
  blastRadius: number,
  grid: Grid
): boolean {
  // On the bomb itself
  if (posX === bombX && posY === bombY) return true
  
  // Check horizontal
  if (posY === bombY) {
    const dist = Math.abs(posX - bombX)
    if (dist <= blastRadius) {
      // Check for blocking walls
      const step = posX > bombX ? 1 : -1
      for (let i = 1; i < dist; i++) {
        const checkX = bombX + step * i
        const tile = grid[bombY]?.[checkX]
        if (tile === 'wall' || tile === 'destructible') return false
      }
      return true
    }
  }
  
  // Check vertical
  if (posX === bombX) {
    const dist = Math.abs(posY - bombY)
    if (dist <= blastRadius) {
      // Check for blocking walls
      const step = posY > bombY ? 1 : -1
      for (let i = 1; i < dist; i++) {
        const checkY = bombY + step * i
        const tile = grid[checkY]?.[bombX]
        if (tile === 'wall' || tile === 'destructible') return false
      }
      return true
    }
  }
  
  return false
}

/**
 * Check if a position is dangerous from any active bomb
 */
export function isPositionSafe(
  x: number,
  y: number,
  grid: Grid,
  bombs: Array<{ x: number; y: number; blastRadius: number }>,
  additionalBomb?: { x: number; y: number; blastRadius: number }
): boolean {
  // Check all existing bombs
  for (const bomb of bombs) {
    if (isInBlastZone(x, y, bomb.x, bomb.y, bomb.blastRadius, grid)) {
      return false
    }
  }
  
  // Check additional hypothetical bomb
  if (additionalBomb && isInBlastZone(x, y, additionalBomb.x, additionalBomb.y, additionalBomb.blastRadius, grid)) {
    return false
  }
  
  return true
}

/**
 * Check if a tile is walkable (empty and no bomb)
 */
function canWalkTo(
  x: number, 
  y: number, 
  grid: Grid, 
  gridWidth: number, 
  gridHeight: number,
  bombs: Array<{ x: number; y: number; blastRadius: number }>
): boolean {
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return false
  if (grid[y][x] !== 'empty') return false
  if (bombs.some(b => b.x === x && b.y === y)) return false
  return true
}

/**
 * Find escape path using BFS - returns the FIRST STEP direction to take
 */
export function findEscapeDirection(
  startX: number,
  startY: number,
  grid: Grid,
  gridWidth: number,
  gridHeight: number,
  bombs: Array<{ x: number; y: number; blastRadius: number }>,
  newBomb?: { x: number; y: number; blastRadius: number }
): { dx: number, dy: number } | null {
  const allBombs = newBomb ? [...bombs, newBomb] : bombs
  
  // BFS to find safe tile
  const visited = new Set<string>()
  visited.add(`${startX},${startY}`)
  
  // Queue entries: [x, y, firstStepDx, firstStepDy]
  const queue: Array<[number, number, number, number]> = []
  
  // Add all valid adjacent tiles as starting points
  for (const dir of DIRECTIONS) {
    const nx = startX + dir.dx
    const ny = startY + dir.dy
    
    if (!canWalkTo(nx, ny, grid, gridWidth, gridHeight, allBombs)) continue
    
    visited.add(`${nx},${ny}`)
    queue.push([nx, ny, dir.dx, dir.dy])
  }
  
  // BFS - max 6 steps (bomb timer is ~2.5s, AI moves every ~0.6-1s)
  const MAX_DEPTH = 6
  let depth = 0
  let levelSize = queue.length
  let processed = 0
  
  while (queue.length > 0 && depth < MAX_DEPTH) {
    const [x, y, firstDx, firstDy] = queue.shift()!
    processed++
    
    // Check if this tile is safe
    if (isPositionSafe(x, y, grid, allBombs)) {
      return { dx: firstDx, dy: firstDy }
    }
    
    // Track BFS depth
    if (processed >= levelSize) {
      depth++
      levelSize = queue.length
      processed = 0
    }
    
    // Explore neighbors
    for (const dir of DIRECTIONS) {
      const nx = x + dir.dx
      const ny = y + dir.dy
      const key = `${nx},${ny}`
      
      if (visited.has(key)) continue
      if (!canWalkTo(nx, ny, grid, gridWidth, gridHeight, allBombs)) continue
      
      visited.add(key)
      queue.push([nx, ny, firstDx, firstDy]) // Keep tracking the FIRST step
    }
  }
  
  return null // No safe escape found
}

/**
 * Get a safe move direction for normal movement (not in danger)
 * Returns null if no safe moves exist
 */
export function getSafeMove(
  x: number,
  y: number,
  grid: Grid,
  gridWidth: number,
  gridHeight: number,
  bombs: Array<{ x: number; y: number; blastRadius: number }>,
  preferredDx?: number,
  preferredDy?: number
): { dx: number, dy: number } | null {
  const safeMoves: Array<{ dx: number, dy: number }> = []
  
  for (const dir of DIRECTIONS) {
    const nx = x + dir.dx
    const ny = y + dir.dy
    
    if (!canWalkTo(nx, ny, grid, gridWidth, gridHeight, bombs)) continue
    if (!isPositionSafe(nx, ny, grid, bombs)) continue
    
    safeMoves.push(dir)
  }
  
  if (safeMoves.length === 0) return null
  
  // If we have a preferred direction, try to use it
  if (preferredDx !== undefined && preferredDy !== undefined) {
    const preferred = safeMoves.find(m => m.dx === preferredDx && m.dy === preferredDy)
    if (preferred) return preferred
  }
  
  // Return random safe move
  return safeMoves[Math.floor(Math.random() * safeMoves.length)]
}

/**
 * MAIN AI DECISION: Should the AI place a bomb?
 * Returns decision with escape direction if bomb should be placed
 */
export function shouldAIPlaceBomb(context: AIBombContext): BombPlacementDecision {
  const { enemyX, enemyY, playerX, playerY, grid, gridWidth, gridHeight, bombs, blastRadius, difficulty } = context
  
  // SAFETY CHECK 1: Never place if standing on a bomb
  if (bombs.some(b => b.x === enemyX && b.y === enemyY)) {
    return { shouldPlace: false, reason: 'Standing on bomb' }
  }
  
  // SAFETY CHECK 2: Never place if currently in danger
  if (!isPositionSafe(enemyX, enemyY, grid, bombs)) {
    return { shouldPlace: false, reason: 'Currently in danger' }
  }
  
  // SAFETY CHECK 3: Find escape route BEFORE deciding to place
  const hypotheticalBomb = { x: enemyX, y: enemyY, blastRadius }
  const escapeDir = findEscapeDirection(enemyX, enemyY, grid, gridWidth, gridHeight, bombs, hypotheticalBomb)
  
  if (!escapeDir) {
    return { shouldPlace: false, reason: 'No escape route' }
  }
  
  // Now we know escape is possible - check if we SHOULD place a bomb
  const distToPlayer = Math.abs(enemyX - playerX) + Math.abs(enemyY - playerY)
  
  // Check if player would be in blast zone
  const playerInBlast = isInBlastZone(playerX, playerY, enemyX, enemyY, blastRadius, grid)
  
  // Check for nearby destructibles (to farm powerups)
  let breaksCrate = false
  const directions = [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}]
  for(const dir of directions) {
    const checkX = enemyX + dir.dx
    const checkY = enemyY + dir.dy
    if (grid[checkY] && grid[checkY][checkX] === 'destructible') {
      breaksCrate = true
      break
    }
  }

  // Difficulty-based decision making
  let shouldPlace = false
  let reason = ''
  
  switch (difficulty) {
    case 'easy':
      // Very passive - only bomb if player is right next to us
      if (playerInBlast && distToPlayer <= 1) {
        shouldPlace = Math.random() < 0.25
        reason = 'Player adjacent'
      } else if (breaksCrate && Math.random() < 0.05) {
         shouldPlace = true
         reason = 'Breaking crate (Low rate)'
      } else if (Math.random() < 0.005) {
        shouldPlace = true
        reason = 'Random'
      }
      break
      
    case 'medium':
      if (playerInBlast) {
        shouldPlace = true
        reason = 'Player in blast range'
      } else if (breaksCrate && Math.random() < 0.3) {
        shouldPlace = true
        reason = 'Breaking crate for powerups'
      } else if (distToPlayer <= 3 && Math.random() < 0.15) {
        shouldPlace = true
        reason = 'Close to player'
      } else if (Math.random() < 0.02) {
        shouldPlace = true
        reason = 'Strategic'
      }
      break
      
    case 'hard':
      if (playerInBlast) {
        shouldPlace = true
        reason = 'Player in blast range'
      } else if (breaksCrate && Math.random() < 0.6) {
        shouldPlace = true
        reason = 'Aggressively farming crates'
      } else if (distToPlayer <= 4 && Math.random() < 0.3) {
        shouldPlace = true
        reason = 'Pressuring player'
      } else if (Math.random() < 0.04) {
        shouldPlace = true
        reason = 'Aggressive'
      }
      break
  }
  
  if (shouldPlace) {
    return { shouldPlace: true, reason, escapeDirection: escapeDir }
  }
  
  return { shouldPlace: false, reason: 'Waiting' }
}

// Export for backwards compatibility
export function getEscapeDirection(
  x: number,
  y: number,
  grid: Grid,
  gridWidth: number,
  gridHeight: number,
  bombs: Array<{ x: number; y: number; blastRadius: number }>
): { dx: number, dy: number } | null {
  return findEscapeDirection(x, y, grid, gridWidth, gridHeight, bombs)
}

export function isPositionDangerousFromBombs(
  x: number,
  y: number,
  bombs: Array<{ x: number; y: number; blastRadius: number }>,
  grid: Grid
): boolean {
  return !isPositionSafe(x, y, grid, bombs)
}
