import { FLARE_TEXTURE_DATA_URI } from './assets'
import './style.css'
import { isMobile, haptic, setHapticsEnabled } from './device'
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  Matrix,
  Scene,
  ParticleSystem,
  Texture,
  Animation,
  DynamicTexture,
  DirectionalLight,
  GlowLayer,
  ShadowGenerator,
  TransformNode,
} from '@babylonjs/core'
import { createMainMenu, createPauseMenu, showCountdown, type GameMode } from './menu'

import { SoundManager } from './sound-manager'
import { StatisticsManager } from './statistics'
import { SettingsManager } from './settings'
import { createSettingsMenu } from './settings-menu'
import { createStatsScreen } from './stats-screen'
import { GameStateManager } from './game-state'
import { getDifficultyConfig } from './difficulty'
import { AchievementsManager } from './achievements'
import { createAchievementsScreen, showAchievementNotification } from './achievements-screen'
import { createTutorialScreen } from './tutorial'
import { createMapSelectionScreen } from './map-selection'
import { getMapConfig, type MapConfig, type MapTheme } from './maps'
import { showHitIndicator } from './visual-effects'
import { shouldAIPlaceBomb, getEscapeDirection, isPositionSafe } from './ai-bomb-logic'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App container not found')
}

// Create a full-screen canvas for Babylon to render into
const canvas = document.createElement('canvas')
canvas.id = 'game-canvas'
app.innerHTML = ''
app.appendChild(canvas)

// Global game state
let currentEngine: Engine | null = null
let currentScene: Scene | null = null
let isPaused = false

// Global managers
const statsManager = new StatisticsManager()
const settingsManager = new SettingsManager()
setHapticsEnabled(settingsManager.getSettings().haptics)
const gameStateManager = new GameStateManager()
const achievementsManager = new AchievementsManager()
let soundManager: SoundManager | null = null

// Map configuration - default to small map on mobile, medium on PC
let currentMapConfig: MapConfig = getMapConfig(isMobile() ? 'small-classic' : 'medium-classic')

// Basic grid settings (can be tuned later to match Playing With Fire 2)
// Total number of tiles horizontally/vertically (including outer walls)
// 17x17 gives a larger, classic odd-sized arena.
let GRID_WIDTH = 17
let GRID_HEIGHT = 17
const TILE_SIZE = 1

type TileType = 'empty' | 'wall' | 'destructible'

type Grid = TileType[][]

type PowerUpType = 'extraBomb' | 'largerBlast' | 'kick' | 'throw' | 'speed' | 'shield' | 'pierce' | 'ghost' | 'powerBomb' | 'lineBomb'

interface PowerUp {
  x: number
  y: number
  type: PowerUpType
  mesh: any
}

interface Bomb {
  x: number
  y: number
  timer: number
  mesh: any
  blastRadius: number
  ownerId?: number // -1 for player 1, -2 for player 2, 0+ for enemies
}

interface Enemy {
  x: number
  y: number
  mesh: any
  moveTimer: number
  lives: number
  invulnerable: boolean
  invulnerableTimer: number
  // Smooth movement visual position
  visualX?: number
  visualZ?: number
}

function createGrid(width: number, height: number, paddingBottom: number = 0, theme: MapTheme = 'classic'): Grid {
  const grid: Grid = []
  const totalHeight = height + paddingBottom

  for (let y = 0; y < totalHeight; y++) {
    const row: TileType[] = []
    
    // If we're in the padding area (bottom of map on mobile), just leave empty
    if (y >= height) {
      for (let x = 0; x < width; x++) {
        row.push('empty')
      }
      grid.push(row)
      continue
    }

    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1
      const isInnerPillar = x % 2 === 0 && y % 2 === 0

      if (isBorder) {
        row.push('wall')
      } else if (isInnerPillar) {
        // Theme-specific pillar variations
        if (theme === 'ice') {
          // Ice: remove some inner pillars to create open frozen lakes
          const cx = width / 2, cy = height / 2
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          row.push(dist < Math.min(width, height) * 0.25 ? 'empty' : 'wall')
        } else if (theme === 'lava') {
          // Lava: keep all pillars (tight dangerous corridors)
          row.push('wall')
        } else if (theme === 'space' || theme === 'moon') {
          // Space/Moon: remove alternate pillars for more open feel
          row.push((x + y) % 4 === 0 ? 'wall' : 'empty')
        } else {
          row.push('wall')
        }
      } else {
        // Theme-specific destructible density & extra walls
        if (theme === 'lava') {
          // Lava: add "lava channels" - extra walls forming corridors
          const isChannel = (y % 4 === 1 && x > 3 && x < width - 4 && x % 6 === 0) ||
                            (x % 4 === 1 && y > 3 && y < height - 4 && y % 6 === 0)
          if (isChannel) {
            row.push('wall')
          } else {
            row.push(Math.random() < 0.75 ? 'destructible' : 'empty')
          }
        } else if (theme === 'ice') {
          // Ice: less clutter, more open space
          row.push(Math.random() < 0.6 ? 'destructible' : 'empty')
        } else if (theme === 'forest') {
          // Forest: organic clusters - higher density near pillars, clearings elsewhere
          const nearPillar = (x > 0 && row[x - 1] === 'wall') ||
                             (y > 0 && grid[y - 1] && grid[y - 1][x] === 'wall')
          row.push(Math.random() < (nearPillar ? 0.92 : 0.65) ? 'destructible' : 'empty')
        } else if (theme === 'space' || theme === 'moon') {
          // Space: rooms and corridors - create open "rooms" with destructible walls between them
          const inRoom = (x % 5 >= 1 && x % 5 <= 3 && y % 5 >= 1 && y % 5 <= 3)
          if (inRoom) {
            row.push(Math.random() < 0.35 ? 'destructible' : 'empty') // Open rooms
          } else {
            row.push(Math.random() < 0.85 ? 'destructible' : 'empty') // Dense corridors
          }
        } else {
          // Classic: standard Bomberman density
          row.push(Math.random() < 0.8 ? 'destructible' : 'empty')
        }
      }
    }
    grid.push(row)
  }

  // --- Add theme-specific structural features ---
  if (theme === 'forest') {
    // Add some small "clearing" circles
    const clearings = 2 + Math.floor(Math.random() * 2)
    for (let c = 0; c < clearings; c++) {
      const cx = 3 + Math.floor(Math.random() * (width - 6))
      const cy = 3 + Math.floor(Math.random() * (height - 6))
      const r = 1.5 + Math.random()
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy
          if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1) {
            if (Math.sqrt(dx * dx + dy * dy) <= r && grid[ny][nx] === 'destructible') {
              grid[ny][nx] = 'empty'
            }
          }
        }
      }
    }
  }

  if (theme === 'moon') {
    // Add "crater" rings - circular wall patterns
    const craters = 1 + Math.floor(Math.random() * 2)
    for (let c = 0; c < craters; c++) {
      const cx = 4 + Math.floor(Math.random() * (width - 8))
      const cy = 4 + Math.floor(Math.random() * (height - 8))
      const r = 2.5
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = cx + dx, ny = cy + dy
          if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1) {
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist >= r - 0.5 && dist <= r + 0.5 && !(nx % 2 === 0 && ny % 2 === 0)) {
              grid[ny][nx] = 'destructible'
            } else if (dist < r - 0.5) {
              grid[ny][nx] = 'empty'
            }
          }
        }
      }
    }
  }

  // Ensure the top-left corner has some free tiles for player spawn
  const playerSafeSpots: Array<[number, number]> = [
    [1, 1],
    [1, 2],
    [2, 1],
  ]
  for (const [x, y] of playerSafeSpots) {
    if (grid[y] && grid[y][x]) {
      grid[y][x] = 'empty'
    }
  }

  // Ensure all enemy spawn corners have free tiles
  const enemySafeSpots: Array<[number, number]> = [
    // Bottom-right corner (enemy 1)
    [width - 2, height - 2],
    [width - 2, height - 3],
    [width - 3, height - 2],
    // Bottom-left corner (enemy 2)
    [1, height - 2],
    [1, height - 3],
    [2, height - 2],
    // Top-right corner (enemy 3)
    [width - 2, 1],
    [width - 2, 2],
    [width - 3, 1],
    // Bottom-center (enemy 4)
    [Math.floor(width / 2), height - 2],
    [Math.floor(width / 2) - 1, height - 2],
    [Math.floor(width / 2) + 1, height - 2],
  ]
  for (const [x, y] of enemySafeSpots) {
    if (grid[y] && grid[y][x]) {
      grid[y][x] = 'empty'
    }
  }

  return grid
}

function gridToWorld(x: number, y: number): Vector3 {
  return new Vector3(
    (x - GRID_WIDTH / 2 + 0.5) * TILE_SIZE,
    TILE_SIZE / 2,
    (y - GRID_HEIGHT / 2 + 0.5) * TILE_SIZE,
  )
}

// Reusable Vector3 for hot-path gridToWorld calls (avoids per-frame allocation)
const _tmpGridVec = new Vector3()
function gridToWorldInPlace(x: number, y: number, out: Vector3): Vector3 {
  out.copyFromFloats(
    (x - GRID_WIDTH / 2 + 0.5) * TILE_SIZE,
    TILE_SIZE / 2,
    (y - GRID_HEIGHT / 2 + 0.5) * TILE_SIZE,
  )
  return out
}

// Helper: set visibility on all child meshes of a TransformNode
function setCharacterVisibility(root: TransformNode, value: number) {
  const meshes = (root as any)._cachedChildMeshes || root.getChildMeshes()
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].visibility = value
  }
}

function createScene(engine: Engine, gameMode: GameMode): Scene {
  const scene = new Scene(engine)
  
  // Update grid size from map config
  GRID_WIDTH = currentMapConfig.gridWidth
  GRID_HEIGHT = currentMapConfig.gridHeight
  
  // Initialize sound manager
  soundManager = new SoundManager()
  soundManager.createPlaceholderSounds()
  
  // Load all sound effect files (WAV format)
  try {
    soundManager.loadSound('bomb-place', '/sounds/bomb-place.wav', { volume: 0.5 })
    soundManager.loadSound('explosion', '/sounds/explosion.wav', { volume: 0.6 })
    soundManager.loadSound('powerup', '/sounds/powerup.wav', { volume: 0.5 })
    soundManager.loadSound('victory', '/sounds/victory.wav', { volume: 0.7 })
    soundManager.loadSound('defeat', '/sounds/defeat.wav', { volume: 0.7 })
    soundManager.loadSound('game-start', '/sounds/game-start.wav', { volume: 0.6 })
    soundManager.loadSound('death', '/sounds/death.wav', { volume: 0.6 })
    soundManager.loadSound('menu-select', '/sounds/menu-select.wav', { volume: 0.4 })
    soundManager.loadSound('menu-click', '/sounds/menu-click.wav', { volume: 0.5 })
    soundManager.loadSound('kick', '/sounds/kick.wav', { volume: 0.5 })
    soundManager.loadSound('throw', '/sounds/throw.wav', { volume: 0.5 })
    soundManager.loadSound('countdown-tick', '/sounds/countdown-tick.wav', { volume: 0.5 })
    soundManager.loadSound('bgm', '/sounds/bgm.wav', { loop: true, isMusic: true })
  } catch (e) {
    console.log('Sound files not found - run: node scripts/generate-sounds.js')
  }
  
  // Apply settings
  const settings = settingsManager.getSettings()
  if (soundManager) {
    soundManager.setMusicVolume(settings.musicVolume)
    soundManager.setSFXVolume(settings.sfxVolume)
  }
  
  // Track game session for achievements
  let sessionEnemiesDefeated = 0
  let sessionBlocksDestroyed = 0
  let sessionPowerUpsCollected = 0
  let sessionDamageTaken = 0
  const sessionPowerUpTypes = new Set<string>()
  
  // Get difficulty configuration
  const difficultyConfig = getDifficultyConfig(settings.difficulty)
  
  // Initialize game mode specific state
  gameStateManager.reset()
  if (gameMode === 'time-attack') {
    gameStateManager.initTimeAttack(180000, 5000) // 3 minutes, 5 sec bonus per kill
  }

  // Camera: straight down for flat top-down view
  const maxDimension = Math.max(GRID_WIDTH, GRID_HEIGHT)
  const cameraRadius = maxDimension * 1.2
  
  // On mobile for larger maps, offset the camera up so bottom row isn't covered by controls
  const isLargeMap = GRID_HEIGHT >= 17
  // Negative Z moves camera target up, shifting the visible world down (showing more of top, less of bottom)
  // We want to shift the world UP on screen (so bottom row moves away from controls)
  // That means we need the camera to look at a point with NEGATIVE Z offset
  // (Disabled since we use padding now)
  const mobileVerticalOffset = 0
  
  const camera = new ArcRotateCamera(
    'camera',
    0, // Horizontal angle
    0, // Vertical angle (straight down)
    cameraRadius,
    new Vector3(0, 0, mobileVerticalOffset),
    scene,
  )
  
  // Use orthographic camera for flat 2D look
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  
  const halfWorldWidth = (GRID_WIDTH * TILE_SIZE) / 2
  const halfWorldHeight = (GRID_HEIGHT * TILE_SIZE) / 2
  
  // Mobile zoom adjustment: Reduce the visible area slightly to make everything bigger
  // A zoom factor < 1.0 means zooming in (showing less area)
  // A zoom factor > 1.0 means zooming out (showing more area)
  // User feedback V1.1: "Increase area of game a bit to get a bit more out of display"
  // Previous V1.0 was 0.6. Increasing to 0.75 to show more area.
  // User feedback V1.2: "Adjust the game area a bit more" -> Increasing to 0.85
  // For larger maps on mobile, zoom in more (0.75) to make tiles bigger
  
  let zoomFactor = 1.0
  if (isMobile()) {
    zoomFactor = isLargeMap ? 0.70 : 0.85
  } 
  
  const margin = TILE_SIZE * 0.4
  // Extra vertical margin for mobile controls - larger margin for larger maps
  const bottomMarginMobile = isLargeMap ? TILE_SIZE * 3.5 : TILE_SIZE * 2.0

  // Apply zoom by modifying the boundaries
  // Note: changing halfWorldWidth effectively changes the viewing frustum size
  
  // Calculate viewport dimensions in world units (based on playable area)
  const viewportHalfWidth = (halfWorldWidth + margin) * zoomFactor
  const viewportHalfHeight = (halfWorldHeight + margin) * zoomFactor
  
  // Add padding to the camera bottom view
  const bottomPaddingWorld = isMobile() ? (4 * TILE_SIZE) * zoomFactor : 0

  camera.orthoLeft = -viewportHalfWidth
  camera.orthoRight = viewportHalfWidth
  // Extend bottom to include controls area without shrinking the game
  camera.orthoBottom = -viewportHalfHeight - (isMobile() ? bottomMarginMobile * zoomFactor : 0) - bottomPaddingWorld
  camera.orthoTop = viewportHalfHeight

  // Fix the camera so the player can't rotate/zoom
  camera.inputs.clear()
  
  // Screen shake function
  const activeShakeIntervals: ReturnType<typeof setInterval>[] = []
  function screenShake(intensity: number = 0.3, duration: number = 200) {
    if (!settingsManager.getSettings().screenShake) return
    
    const originalPosition = camera.position.clone()
    const shakeStart = Date.now()
    
    const shakeInterval = setInterval(() => {
      const elapsed = Date.now() - shakeStart
      if (elapsed >= duration) {
        camera.position.copyFrom(originalPosition)
        clearInterval(shakeInterval)
        const idx = activeShakeIntervals.indexOf(shakeInterval)
        if (idx !== -1) activeShakeIntervals.splice(idx, 1)
        return
      }
      
      const progress = elapsed / duration
      const currentIntensity = intensity * (1 - progress)
      
      camera.position.x = originalPosition.x + (Math.random() - 0.5) * currentIntensity
      camera.position.y = originalPosition.y + (Math.random() - 0.5) * currentIntensity
      camera.position.z = originalPosition.z + (Math.random() - 0.5) * currentIntensity
    }, 16)
    activeShakeIntervals.push(shakeInterval)
  }

  // Clean up timers on scene dispose
  scene.onDisposeObservable.add(() => {
    activeShakeIntervals.forEach(clearInterval)
    activeShakeIntervals.length = 0
  })

  // Better lighting for 3D effect
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.5
  
  // Add directional light for shadows
  const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), scene)
  dirLight.position = new Vector3(20, 40, 20)
  dirLight.intensity = 0.8
  
  const shadowGenerator = new ShadowGenerator(1024, dirLight)
  shadowGenerator.useBlurExponentialShadowMap = true
  shadowGenerator.blurKernel = 32
  
  // Add Glow Layer for neon effect
  const glowLayer = new GlowLayer("glow", scene)
  glowLayer.intensity = 0.3

  // Materials (using map theme colors)
  // Materials (using map theme colors) — only create materials actually used
  const wallMaterial = new StandardMaterial('wallMat', scene)
  wallMaterial.diffuseColor = currentMapConfig.colors.wall
  wallMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
  wallMaterial.specularPower = 32

  // Create map geometry
  const paddingBottom = isMobile() ? 4 : 0
  const grid = createGrid(GRID_WIDTH, GRID_HEIGHT, paddingBottom, currentMapConfig.theme)
  
  // Note: We do NOT update global GRID_HEIGHT here so game logic (spawns/borders) 
  // stays within playable area. Visuals will handle the extra rows.
  
  const destructibleMeshes: Map<string, any> = new Map()

  // Helper to create a procedural texture
  const createTexture = (color: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const tex = new DynamicTexture('tex-' + color + Math.random(), 128, scene, true)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 128, 128)
    draw(ctx)
    tex.update()
    return tex
  }

  // Create crate/barrel texture (theme-specific)
  const theme = currentMapConfig.theme
  const createDestructibleTexture = (theme: string) => {
    return createTexture('#8B4513', (ctx) => {
      const w = 128, h = 128
      if (theme === 'ice') {
        // ICE: Frosted ice block
        ctx.fillStyle = '#b8dff0'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillRect(8, 8, w - 16, h - 16)
        // Crack lines
        ctx.strokeStyle = 'rgba(180,220,240,0.8)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(20, 30); ctx.lineTo(60, 50); ctx.lineTo(110, 35)
        ctx.moveTo(30, 90); ctx.lineTo(70, 70); ctx.lineTo(100, 95)
        ctx.stroke()
        // Frost sparkles
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        for (let i = 0; i < 8; i++) {
          ctx.beginPath()
          ctx.arc(15 + Math.random() * 98, 15 + Math.random() * 98, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme === 'lava') {
        // LAVA: Volcanic rock with glowing cracks
        ctx.fillStyle = '#2a1a1a'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#1a0a0a'
        ctx.fillRect(6, 6, w - 12, h - 12)
        // Glowing magma cracks
        ctx.strokeStyle = '#ff4400'
        ctx.lineWidth = 3
        ctx.shadowColor = '#ff6600'
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.moveTo(10, 40); ctx.lineTo(45, 55); ctx.lineTo(50, 90)
        ctx.moveTo(70, 10); ctx.lineTo(80, 50); ctx.lineTo(120, 70)
        ctx.stroke()
        ctx.shadowBlur = 0
        // Pumice holes
        ctx.fillStyle = '#0a0505'
        for (let i = 0; i < 5; i++) {
          ctx.beginPath()
          ctx.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 3 + Math.random() * 3, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme === 'forest') {
        // FOREST: Log / bush texture
        ctx.fillStyle = '#3a5a20'
        ctx.fillRect(0, 0, w, h)
        // Leaf clusters
        ctx.fillStyle = '#4a7a28'
        for (let i = 0; i < 12; i++) {
          ctx.beginPath()
          ctx.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 12, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = '#2a4a15'
        for (let i = 0; i < 8; i++) {
          ctx.beginPath()
          ctx.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 8, 0, Math.PI * 2)
          ctx.fill()
        }
        // Highlights
        ctx.fillStyle = 'rgba(120,200,60,0.3)'
        for (let i = 0; i < 6; i++) {
          ctx.beginPath()
          ctx.arc(Math.random() * w, Math.random() * h, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme === 'space') {
        // SPACE: Supply crate with markings
        ctx.fillStyle = '#3a3a4a'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#2a2a3a'
        ctx.fillRect(8, 8, w - 16, h - 16)
        // Caution stripes
        ctx.fillStyle = '#ccaa20'
        for (let i = 0; i < 6; i++) {
          ctx.save()
          ctx.translate(w / 2, h / 2)
          ctx.rotate(-Math.PI / 4)
          ctx.fillRect(-80, -64 + i * 24, 160, 8)
          ctx.restore()
        }
        // Corner bolts
        ctx.fillStyle = '#666'
        const r = 4
        ctx.beginPath(); ctx.arc(14, 14, r, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w - 14, 14, r, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(14, h - 14, r, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w - 14, h - 14, r, 0, Math.PI * 2); ctx.fill()
      } else if (theme === 'moon') {
        // MOON: Regolith / dust pile
        ctx.fillStyle = '#6a6a70'
        ctx.fillRect(0, 0, w, h)
        // Dusty texture spots
        for (let i = 0; i < 20; i++) {
          const shade = 80 + Math.floor(Math.random() * 40)
          ctx.fillStyle = `rgb(${shade},${shade},${shade + 5})`
          ctx.beginPath()
          ctx.arc(Math.random() * w, Math.random() * h, 5 + Math.random() * 10, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.strokeStyle = 'rgba(90,90,95,0.5)'
        ctx.lineWidth = 1
        ctx.strokeRect(10, 10, w - 20, h - 20)
      } else {
        // CLASSIC: Wooden crate
        ctx.fillStyle = '#654321'
        ctx.fillRect(10, 0, 10, 128)
        ctx.fillRect(40, 0, 10, 128)
        ctx.fillRect(70, 0, 10, 128)
        ctx.fillRect(100, 0, 10, 128)
        ctx.fillRect(0, 10, 128, 10)
        ctx.fillRect(0, 108, 128, 10)
        ctx.fillStyle = '#d97706'
        ctx.beginPath()
        ctx.arc(64, 64, 30, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fcd34d'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(64, 64, 25, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(0, 0, 20, 20)
        ctx.fillRect(108, 0, 20, 20)
        ctx.fillRect(0, 108, 20, 20)
        ctx.fillRect(108, 108, 20, 20)
      }
    })
  }

  const crateMaterial = new StandardMaterial('crateMat', scene)
  crateMaterial.diffuseTexture = createDestructibleTexture(theme)
  crateMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
  if (theme === 'ice') {
    crateMaterial.alpha = 0.85
    crateMaterial.specularColor = new Color3(0.6, 0.6, 0.6)
    crateMaterial.specularPower = 64
  }

  // Theme-specific wall texture
  const createWallTexture = (theme: string) => {
    return createTexture('#555', (ctx) => {
      const w = 128, h = 128
      if (theme === 'ice') {
        // Crystal ice pillar
        ctx.fillStyle = '#8ab8d0'
        ctx.fillRect(0, 0, w, h)
        const grad = ctx.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, 'rgba(200,230,255,0.5)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.2)')
        grad.addColorStop(1, 'rgba(180,210,240,0.5)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
        // Crystal facets
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 30); ctx.lineTo(64, 50); ctx.lineTo(128, 20)
        ctx.moveTo(0, 80); ctx.lineTo(64, 65); ctx.lineTo(128, 90)
        ctx.stroke()
      } else if (theme === 'lava') {
        // Dark obsidian with orange veins
        ctx.fillStyle = '#1a1010'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#252015'
        ctx.fillRect(4, 4, w - 8, h - 8)
        // Glowing veins
        ctx.strokeStyle = '#cc3300'
        ctx.lineWidth = 2
        ctx.shadowColor = '#ff4400'
        ctx.shadowBlur = 4
        ctx.beginPath()
        ctx.moveTo(0, 64); ctx.lineTo(30, 50); ctx.lineTo(60, 70); ctx.lineTo(128, 55)
        ctx.stroke()
        ctx.shadowBlur = 0
      } else if (theme === 'forest') {
        // Tree bark
        ctx.fillStyle = '#4a3020'
        ctx.fillRect(0, 0, w, h)
        // Bark grain lines
        ctx.strokeStyle = '#3a2515'
        ctx.lineWidth = 3
        for (let i = 0; i < 8; i++) {
          const y = 8 + i * 15
          ctx.beginPath()
          ctx.moveTo(0, y); ctx.lineTo(40, y + 4); ctx.lineTo(90, y - 2); ctx.lineTo(128, y + 3)
          ctx.stroke()
        }
        // Knot
        ctx.fillStyle = '#2a1a0a'
        ctx.beginPath()
        ctx.ellipse(64, 64, 12, 18, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#3a2515'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (theme === 'space') {
        // Metal panel
        ctx.fillStyle = '#4a4a5a'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#3a3a4a'
        ctx.fillRect(6, 6, w - 12, h - 12)
        // Panel seams
        ctx.strokeStyle = '#2a2a3a'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h)
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2)
        ctx.stroke()
        // Rivets
        ctx.fillStyle = '#666'
        const rv = 3
        ctx.beginPath(); ctx.arc(12, 12, rv, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w - 12, 12, rv, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(12, h - 12, rv, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w - 12, h - 12, rv, 0, Math.PI * 2); ctx.fill()
        // Vent glow
        ctx.fillStyle = 'rgba(0,200,255,0.15)'
        ctx.fillRect(20, h / 2 - 3, w - 40, 6)
      } else if (theme === 'moon') {
        // Moon rock / regolith block
        ctx.fillStyle = '#5a5a60'
        ctx.fillRect(0, 0, w, h)
        // Rocky texture
        for (let i = 0; i < 15; i++) {
          const shade = 70 + Math.floor(Math.random() * 30)
          ctx.fillStyle = `rgb(${shade},${shade},${shade + 3})`
          ctx.beginPath()
          ctx.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 12, 0, Math.PI * 2)
          ctx.fill()
        }
        // Impact pock marks
        ctx.fillStyle = '#454550'
        for (let i = 0; i < 4; i++) {
          ctx.beginPath()
          ctx.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 4 + Math.random() * 5, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        // CLASSIC: Stone brick
        ctx.fillStyle = '#707078'
        ctx.fillRect(0, 0, w, h)
        // Brick mortar lines
        ctx.strokeStyle = '#55555a'
        ctx.lineWidth = 4
        // Horizontal mortar
        ctx.beginPath()
        ctx.moveTo(0, h * 0.33); ctx.lineTo(w, h * 0.33)
        ctx.moveTo(0, h * 0.66); ctx.lineTo(w, h * 0.66)
        ctx.stroke()
        // Vertical mortar (offset per row)
        ctx.beginPath()
        ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h * 0.33)
        ctx.moveTo(w * 0.25, h * 0.33); ctx.lineTo(w * 0.25, h * 0.66)
        ctx.moveTo(w * 0.75, h * 0.33); ctx.lineTo(w * 0.75, h * 0.66)
        ctx.moveTo(w * 0.5, h * 0.66); ctx.lineTo(w * 0.5, h)
        ctx.stroke()
        // Subtle stone grain
        ctx.fillStyle = 'rgba(0,0,0,0.06)'
        for (let i = 0; i < 6; i++) {
          ctx.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 30, 4)
        }
      }
    })
  }

  wallMaterial.diffuseTexture = createWallTexture(theme)
  if (theme === 'ice') {
    wallMaterial.specularColor = new Color3(0.5, 0.5, 0.6)
    wallMaterial.specularPower = 48
  } else if (theme === 'lava') {
    wallMaterial.emissiveColor = new Color3(0.08, 0.02, 0)
  } else if (theme === 'space') {
    wallMaterial.specularColor = new Color3(0.3, 0.3, 0.35)
    wallMaterial.specularPower = 48
  }

  // Create procedural floor texture based on theme
  const createFloorTexture = (theme: string) => {
    return createTexture('#222', (ctx) => {
      // Clean, modern aesthetic - no random noise
      const w = 128
      const h = 128
      
      // Base background
      ctx.fillStyle = theme === 'ice' ? '#e8f4f8' : 
                      theme === 'lava' ? '#2a0a0a' : 
                      theme === 'forest' ? '#0a2a0a' :
                      theme === 'moon' ? '#2a2a2e' : '#1a1a1a'
      ctx.fillRect(0, 0, w, h)
      
      // GRID LINES - Thicker, cleaner borders
      // This is crucial for gameplay to see the squares clearly
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.lineWidth = 14 // Thick outer shadow
      ctx.strokeRect(0, 0, w, h)
      
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 2 // Subtle inner highlight
      ctx.strokeRect(6, 6, w-12, h-12)

      if (theme === 'ice') {
        // ICE: Slick, reflective diagonal sheen
        // Instead of random cracks, use controlled geometric shapes
        const grad = ctx.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.45, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.4)') // Sharp reflection line
        grad.addColorStop(0.55, 'rgba(255,255,255,0)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
        
      } else if (theme === 'lava') {
        // LAVA: Industrial grate or plating look
        // Dark metallic plates with heat glow from underneath
        ctx.fillStyle = '#111'
        ctx.fillRect(10, 10, w-20, h-20) // Inner plate
        
        // Corner bolts
        ctx.fillStyle = '#333'
        const r = 4
        ctx.beginPath(); ctx.arc(16, 16, r, 0, Math.PI*2); ctx.fill()
        ctx.beginPath(); ctx.arc(w-16, 16, r, 0, Math.PI*2); ctx.fill()
        ctx.beginPath(); ctx.arc(16, h-16, r, 0, Math.PI*2); ctx.fill()
        ctx.beginPath(); ctx.arc(w-16, h-16, r, 0, Math.PI*2); ctx.fill()
        
        // Heat vents
        ctx.fillStyle = '#ff3300' // Magma glow
        for(let i=0; i<3; i++) {
           ctx.fillRect(30, 30 + (i*25), w-60, 10)
        }
        
      } else if (theme === 'forest') {
        // FOREST: Tech-organic pattern
        // Hexagonal or circuit-like green pattern
        ctx.strokeStyle = '#2d4'
        ctx.lineWidth = 3
        
        // Draw a diamond shape
        ctx.beginPath()
        ctx.moveTo(w/2, 20)
        ctx.lineTo(w-20, h/2)
        ctx.lineTo(w/2, h-20)
        ctx.lineTo(20, h/2)
        ctx.closePath()
        ctx.stroke()
        
        // Center node
        ctx.fillStyle = '#060'
        ctx.beginPath()
        ctx.arc(w/2, h/2, 10, 0, Math.PI*2)
        ctx.fill()

      } else if (theme === 'space') {
        // SPACE: Cosmic void with stars
        const grad = ctx.createRadialGradient(w/2, h/2, 10, w/2, h/2, 80)
        grad.addColorStop(0, '#2a0a4a') // Lighter purple center
        grad.addColorStop(1, '#050010') // Black void edges
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)

        // Random stars
        ctx.fillStyle = '#fff'
        for(let i=0; i<15; i++) {
            const x = Math.random() * w
            const y = Math.random() * h
            const s = Math.random() * 1.5
            ctx.globalAlpha = Math.random() * 0.8 + 0.2
            ctx.beginPath()
            ctx.arc(x, y, s, 0, Math.PI*2)
            ctx.fill()
        }
        ctx.globalAlpha = 1.0

        // Holographic grid marker
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)'
        ctx.lineWidth = 1
        ctx.strokeRect(10, 10, w-20, h-20)
        
        // Center crosshair
        ctx.beginPath()
        ctx.moveTo(w/2 - 5, h/2); ctx.lineTo(w/2 + 5, h/2)
        ctx.moveTo(w/2, h/2 - 5); ctx.lineTo(w/2, h/2 + 5)
        ctx.stroke()

      } else if (theme === 'moon') {
        // MOON: Grey dusty regolith surface
        const grad = ctx.createRadialGradient(w/2, h/2, 5, w/2, h/2, 70)
        grad.addColorStop(0, '#3a3a40')
        grad.addColorStop(1, '#252528')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)

        // Tiny craters / pock marks
        for (let i = 0; i < 6; i++) {
          const cx = 15 + Math.random() * (w - 30)
          const cy = 15 + Math.random() * (h - 30)
          const cr = 2 + Math.random() * 4
          ctx.fillStyle = 'rgba(0,0,0,0.15)'
          ctx.beginPath()
          ctx.arc(cx, cy, cr, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = 'rgba(255,255,255,0.05)'
          ctx.beginPath()
          ctx.arc(cx - 1, cy - 1, cr * 0.6, 0, Math.PI * 2)
          ctx.fill()
        }
        
        // Boot print impression (subtle)
        ctx.strokeStyle = 'rgba(50,50,55,0.3)'
        ctx.lineWidth = 1
        ctx.strokeRect(30, 40, 25, 48)
        
      } else {
        // CLASSIC: The "Neon Grid" look
        // Simple darker center to emphasize the tile definition
        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.fillRect(16, 16, w-32, h-32)
        
        // Plus sign in middle for alignment
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(w/2, 40); ctx.lineTo(w/2, h-40)
        ctx.moveTo(40, h/2); ctx.lineTo(w-40, h/2)
        ctx.stroke()
      }
    })
  }

  const floorTexture = createFloorTexture(currentMapConfig.theme)

  // Create shared tile materials (2 for checkered pattern) instead of one per tile
  const baseColor = currentMapConfig.colors.ground
  const tileMatLight = new StandardMaterial('tileMat-light', scene)
  tileMatLight.diffuseTexture = floorTexture
  tileMatLight.diffuseColor = baseColor
  tileMatLight.specularColor = new Color3(0.05, 0.05, 0.05)

  const tileMatDark = new StandardMaterial('tileMat-dark', scene)
  tileMatDark.diffuseTexture = floorTexture
  tileMatDark.diffuseColor = baseColor.scale(0.85)
  tileMatDark.specularColor = new Color3(0.05, 0.05, 0.05)

  // Shared wall-decoration materials (avoid per-tile material creation)
  const sharedCanopyMat = new StandardMaterial('canopyMat-shared', scene)
  sharedCanopyMat.diffuseColor = new Color3(0.15, 0.5, 0.1)
  sharedCanopyMat.specularColor = new Color3(0.05, 0.05, 0.05)
  const sharedLavaGlowMat = new StandardMaterial('lavaGlow-shared', scene)
  sharedLavaGlowMat.emissiveColor = new Color3(0.8, 0.2, 0)
  sharedLavaGlowMat.diffuseColor = new Color3(0, 0, 0)
  sharedLavaGlowMat.alpha = 0.5
  const sharedAntennaMat = new StandardMaterial('antenna-shared', scene)
  sharedAntennaMat.diffuseColor = new Color3(0.5, 0.5, 0.55)
  sharedAntennaMat.emissiveColor = new Color3(0, 0.1, 0.15)

  // Create floor tiles individually for better grid visibility
  // Use grid.length to include padding rows
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const isCheckered = (x + y) % 2 === 0
      const tile = MeshBuilder.CreateGround(`tile-${x}-${y}`, {
        width: TILE_SIZE * 0.98, // Very small gap
        height: TILE_SIZE * 0.98
      }, scene)
      
      const pos = gridToWorld(x, y)
      tile.position.x = pos.x
      tile.position.z = pos.z
      tile.receiveShadows = true
      tile.material = isCheckered ? tileMatLight : tileMatDark

      if (grid[y][x] === 'wall') {
        const isBorder = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1
        
        if (theme === 'forest') {
          // Forest: tree trunks for inner pillars, hedge wall for borders
          if (isBorder) {
            const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
              width: TILE_SIZE * 0.95, height: TILE_SIZE * 1.0, depth: TILE_SIZE * 0.95 
            }, scene)
            wall.position.x = pos.x
            wall.position.y = TILE_SIZE * 0.5
            wall.position.z = pos.z
            wall.material = wallMaterial
            shadowGenerator.addShadowCaster(wall)
            wall.receiveShadows = true
          } else {
            // Tree trunk
            const trunk = MeshBuilder.CreateCylinder(`wall-${x}-${y}`, {
              diameter: TILE_SIZE * 0.45, height: TILE_SIZE * 1.6, tessellation: 8
            }, scene)
            trunk.position.x = pos.x
            trunk.position.y = TILE_SIZE * 0.8
            trunk.position.z = pos.z
            trunk.material = wallMaterial
            shadowGenerator.addShadowCaster(trunk)
            trunk.receiveShadows = true
            // Tree canopy
            const canopy = MeshBuilder.CreateSphere(`canopy-${x}-${y}`, {
              diameter: TILE_SIZE * 0.9, segments: 6
            }, scene)
            canopy.position.x = pos.x
            canopy.position.y = TILE_SIZE * 1.55
            canopy.position.z = pos.z
            canopy.scaling = new Vector3(1, 0.7, 1)
            canopy.material = sharedCanopyMat
            shadowGenerator.addShadowCaster(canopy)
          }
        } else if (theme === 'ice') {
          // Ice: crystal pillars for inner, frozen wall for borders
          if (isBorder) {
            const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
              width: TILE_SIZE * 0.95, height: TILE_SIZE * 1.1, depth: TILE_SIZE * 0.95 
            }, scene)
            wall.position.x = pos.x
            wall.position.y = TILE_SIZE * 0.55
            wall.position.z = pos.z
            wall.material = wallMaterial
            shadowGenerator.addShadowCaster(wall)
            wall.receiveShadows = true
          } else {
            // Ice crystal - tapered cylinder
            const crystal = MeshBuilder.CreateCylinder(`wall-${x}-${y}`, {
              diameterTop: TILE_SIZE * 0.3, diameterBottom: TILE_SIZE * 0.65,
              height: TILE_SIZE * 1.5, tessellation: 6
            }, scene)
            crystal.position.x = pos.x
            crystal.position.y = TILE_SIZE * 0.75
            crystal.position.z = pos.z
            crystal.rotation.y = Math.random() * Math.PI
            crystal.material = wallMaterial
            shadowGenerator.addShadowCaster(crystal)
            crystal.receiveShadows = true
          }
        } else if (theme === 'lava') {
          // Lava: rocky pillars, taller with rough feel
          const h = isBorder ? TILE_SIZE * 1.3 : TILE_SIZE * 1.5
          const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
            width: TILE_SIZE * 0.88, height: h, depth: TILE_SIZE * 0.88 
          }, scene)
          wall.position.x = pos.x
          wall.position.y = h * 0.5
          wall.position.z = pos.z
          if (!isBorder) {
            // Slight random rotation for organic rock feel
            wall.rotation.y = Math.random() * 0.3 - 0.15
          }
          wall.material = wallMaterial
          shadowGenerator.addShadowCaster(wall)
          wall.receiveShadows = true
          // Magma glow at base for inner pillars
          if (!isBorder) {
            const glow = MeshBuilder.CreateDisc(`lavaglow-${x}-${y}`, {
              radius: TILE_SIZE * 0.35, tessellation: 8
            }, scene)
            glow.rotation.x = Math.PI / 2
            glow.position.x = pos.x
            glow.position.y = 0.03
            glow.position.z = pos.z
            glow.material = sharedLavaGlowMat
          }
        } else if (theme === 'space') {
          // Space: metal panels, taller for inner
          const h = isBorder ? TILE_SIZE * 1.1 : TILE_SIZE * 1.3
          const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
            width: TILE_SIZE * 0.9, height: h, depth: TILE_SIZE * 0.9 
          }, scene)
          wall.position.x = pos.x
          wall.position.y = h * 0.5
          wall.position.z = pos.z
          wall.material = wallMaterial
          shadowGenerator.addShadowCaster(wall)
          wall.receiveShadows = true
          // Antenna on some inner pillars
          if (!isBorder && Math.random() < 0.3) {
            const ant = MeshBuilder.CreateCylinder(`ant-${x}-${y}`, {
              diameter: 0.04, height: TILE_SIZE * 0.5, tessellation: 4
            }, scene)
            ant.position.x = pos.x
            ant.position.y = h + TILE_SIZE * 0.25
            ant.position.z = pos.z
            ant.material = sharedAntennaMat
          }
        } else if (theme === 'moon') {
          // Moon: rounded rocks
          if (isBorder) {
            const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
              width: TILE_SIZE * 0.93, height: TILE_SIZE * 1.0, depth: TILE_SIZE * 0.93 
            }, scene)
            wall.position.x = pos.x
            wall.position.y = TILE_SIZE * 0.5
            wall.position.z = pos.z
            wall.material = wallMaterial
            shadowGenerator.addShadowCaster(wall)
            wall.receiveShadows = true
          } else {
            // Irregular moon rock (stretched sphere)
            const rock = MeshBuilder.CreateSphere(`wall-${x}-${y}`, {
              diameter: TILE_SIZE * 0.85, segments: 5
            }, scene)
            rock.position.x = pos.x
            rock.position.y = TILE_SIZE * 0.4
            rock.position.z = pos.z
            rock.scaling = new Vector3(
              0.9 + Math.random() * 0.2,
              0.6 + Math.random() * 0.4,
              0.9 + Math.random() * 0.2
            )
            rock.rotation.y = Math.random() * Math.PI
            rock.material = wallMaterial
            shadowGenerator.addShadowCaster(rock)
            rock.receiveShadows = true
          }
        } else {
          // Classic: standard stone block wall
          const wall = MeshBuilder.CreateBox(`wall-${x}-${y}`, { 
            width: TILE_SIZE * 0.9, 
            height: TILE_SIZE * 1.2, 
            depth: TILE_SIZE * 0.9 
          }, scene)
          wall.position.x = pos.x
          wall.position.y = TILE_SIZE * 0.6
          wall.position.z = pos.z
          wall.material = wallMaterial
          shadowGenerator.addShadowCaster(wall)
          wall.receiveShadows = true
        }
      } else if (grid[y][x] === 'destructible') {
        let destructible: any
        
        if (theme === 'forest') {
          // Forest: bush (flattened sphere)
          destructible = MeshBuilder.CreateSphere(`destructible-${x}-${y}`, {
            diameter: TILE_SIZE * 0.75, segments: 6
          }, scene)
          destructible.scaling = new Vector3(1, 0.7, 1)
          destructible.position.x = pos.x
          destructible.position.y = TILE_SIZE * 0.3
          destructible.position.z = pos.z
        } else if (theme === 'ice') {
          // Ice: ice block (box, slightly irregular)
          destructible = MeshBuilder.CreateBox(`destructible-${x}-${y}`, {
            width: TILE_SIZE * 0.75, height: TILE_SIZE * 0.7, depth: TILE_SIZE * 0.75
          }, scene)
          destructible.position.x = pos.x
          destructible.position.y = TILE_SIZE * 0.35
          destructible.position.z = pos.z
          destructible.rotation.y = Math.random() * 0.3 - 0.15
        } else if (theme === 'lava') {
          // Lava: volcanic rock (slightly rounded box)
          destructible = MeshBuilder.CreateBox(`destructible-${x}-${y}`, {
            width: TILE_SIZE * 0.72, height: TILE_SIZE * 0.65, depth: TILE_SIZE * 0.72
          }, scene)
          destructible.position.x = pos.x
          destructible.position.y = TILE_SIZE * 0.33
          destructible.position.z = pos.z
          destructible.rotation.y = Math.random() * 0.5 - 0.25
        } else if (theme === 'moon') {
          // Moon: dust mound (flattened sphere)
          destructible = MeshBuilder.CreateSphere(`destructible-${x}-${y}`, {
            diameter: TILE_SIZE * 0.7, segments: 5
          }, scene)
          destructible.scaling = new Vector3(1, 0.55, 1)
          destructible.position.x = pos.x
          destructible.position.y = TILE_SIZE * 0.2
          destructible.position.z = pos.z
        } else {
          // Classic / Space: crate box
          destructible = MeshBuilder.CreateBox(`destructible-${x}-${y}`, { 
            size: TILE_SIZE * 0.8
          }, scene)
          destructible.position.x = pos.x
          destructible.position.y = TILE_SIZE * 0.4
          destructible.position.z = pos.z
        }
        
        destructible.material = crateMaterial
        destructibleMeshes.set(`${x},${y}`, destructible)
        shadowGenerator.addShadowCaster(destructible)
        destructible.receiveShadows = true
      }
    }
  }

  // ── Theme-specific decorations (shared materials to minimize draw calls) ──
  if (theme === 'forest') {
    const mushMatRed = new StandardMaterial('mushMat-red', scene)
    mushMatRed.diffuseColor = new Color3(0.8, 0.2, 0.15)
    mushMatRed.specularColor = new Color3(0.05, 0.05, 0.05)
    const mushMatYellow = new StandardMaterial('mushMat-yellow', scene)
    mushMatYellow.diffuseColor = new Color3(0.9, 0.85, 0.3)
    mushMatYellow.specularColor = new Color3(0.05, 0.05, 0.05)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === 'empty' && Math.random() < 0.08) {
          const pos = gridToWorld(x, y)
          const mush = MeshBuilder.CreateCylinder(`mush-${x}-${y}`, {
            diameterTop: TILE_SIZE * 0.22, diameterBottom: TILE_SIZE * 0.06,
            height: TILE_SIZE * 0.15, tessellation: 6
          }, scene)
          mush.position.x = pos.x + (Math.random() - 0.5) * 0.3
          mush.position.y = TILE_SIZE * 0.08
          mush.position.z = pos.z + (Math.random() - 0.5) * 0.3
          mush.material = Math.random() < 0.5 ? mushMatRed : mushMatYellow
        }
      }
    }
  } else if (theme === 'lava') {
    const poolMat = new StandardMaterial('lpool-shared', scene)
    poolMat.emissiveColor = new Color3(0.9, 0.3, 0)
    poolMat.diffuseColor = new Color3(0.6, 0.15, 0)
    poolMat.alpha = 0.7
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === 'empty' && Math.random() < 0.04) {
          const pos = gridToWorld(x, y)
          const pool = MeshBuilder.CreateDisc(`lpool-${x}-${y}`, {
            radius: TILE_SIZE * 0.25, tessellation: 8
          }, scene)
          pool.rotation.x = Math.PI / 2
          pool.position.x = pos.x
          pool.position.y = 0.015
          pool.position.z = pos.z
          pool.material = poolMat
        }
      }
    }
  } else if (theme === 'ice') {
    const shardMat = new StandardMaterial('shard-shared', scene)
    shardMat.diffuseColor = new Color3(0.7, 0.85, 0.95)
    shardMat.specularColor = new Color3(0.8, 0.8, 0.9)
    shardMat.alpha = 0.7
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === 'empty' && Math.random() < 0.06) {
          const pos = gridToWorld(x, y)
          const shard = MeshBuilder.CreateCylinder(`shard-${x}-${y}`, {
            diameterTop: 0, diameterBottom: TILE_SIZE * 0.1,
            height: TILE_SIZE * 0.25, tessellation: 4
          }, scene)
          shard.position.x = pos.x + (Math.random() - 0.5) * 0.3
          shard.position.y = TILE_SIZE * 0.12
          shard.position.z = pos.z + (Math.random() - 0.5) * 0.3
          shard.rotation.x = (Math.random() - 0.5) * 0.4
          shard.rotation.z = (Math.random() - 0.5) * 0.4
          shard.material = shardMat
        }
      }
    }
  } else if (theme === 'space') {
    const slMatCyan = new StandardMaterial('sl-cyan', scene)
    slMatCyan.emissiveColor = new Color3(0, 0.6, 0.8)
    slMatCyan.diffuseColor = new Color3(0, 0, 0)
    const slMatPurple = new StandardMaterial('sl-purple', scene)
    slMatPurple.emissiveColor = new Color3(0.6, 0, 0.8)
    slMatPurple.diffuseColor = new Color3(0, 0, 0)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === 'empty' && Math.random() < 0.05) {
          const pos = gridToWorld(x, y)
          const sLight = MeshBuilder.CreateDisc(`slight-${x}-${y}`, {
            radius: TILE_SIZE * 0.08, tessellation: 6
          }, scene)
          sLight.rotation.x = Math.PI / 2
          sLight.position.x = pos.x
          sLight.position.y = 0.015
          sLight.position.z = pos.z
          sLight.material = Math.random() < 0.5 ? slMatCyan : slMatPurple
        }
      }
    }
  } else if (theme === 'moon') {
    const pebMat = new StandardMaterial('peb-shared', scene)
    pebMat.diffuseColor = new Color3(0.45, 0.45, 0.48)
    pebMat.specularColor = new Color3(0.05, 0.05, 0.05)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === 'empty' && Math.random() < 0.07) {
          const pos = gridToWorld(x, y)
          const pebble = MeshBuilder.CreateSphere(`peb-${x}-${y}`, {
            diameter: TILE_SIZE * 0.08, segments: 3
          }, scene)
          pebble.position.x = pos.x + (Math.random() - 0.5) * 0.4
          pebble.position.y = TILE_SIZE * 0.04
          pebble.position.z = pos.z + (Math.random() - 0.5) * 0.4
          pebble.scaling.y = 0.5
          pebble.material = pebMat
        }
      }
    }
  }

  // Create player as an animated sprite or emoji fallback

  // Create 3D character mesh
  const createPlayerSprite = (name: string, _textureUrl: string | null, _emoji: string, colorHex: string): any => {
    // Parent mesh (pivot)
    const root = new TransformNode(name + '-root', scene)
    
    // ── Materials ──
    const bodyMat = new StandardMaterial(name + '-bodyMat', scene)
    bodyMat.diffuseColor = Color3.FromHexString(colorHex)
    bodyMat.specularColor = new Color3(0.3, 0.3, 0.3)
    bodyMat.specularPower = 16

    const skinMat = new StandardMaterial(name + '-skinMat', scene)
    skinMat.diffuseColor = new Color3(1.0, 0.85, 0.72)
    skinMat.specularColor = new Color3(0.05, 0.05, 0.05)

    const darkMat = new StandardMaterial(name + '-darkMat', scene)
    darkMat.diffuseColor = new Color3(0.08, 0.08, 0.08)
    darkMat.specularColor = new Color3(0.2, 0.2, 0.2)

    const whiteMat = new StandardMaterial(name + '-whiteMat', scene)
    whiteMat.diffuseColor = new Color3(1, 1, 1)
    whiteMat.emissiveColor = new Color3(0.6, 0.6, 0.6)

    const shoeMat = new StandardMaterial(name + '-shoeMat', scene)
    shoeMat.diffuseColor = new Color3(0.25, 0.15, 0.1)
    shoeMat.specularColor = new Color3(0.15, 0.15, 0.15)

    // Brighter version of body color for accents
    const accent = Color3.FromHexString(colorHex)
    const accentMat = new StandardMaterial(name + '-accentMat', scene)
    accentMat.diffuseColor = new Color3(
      Math.min(1, accent.r * 1.3 + 0.15),
      Math.min(1, accent.g * 1.3 + 0.15),
      Math.min(1, accent.b * 1.3 + 0.15)
    )
    accentMat.specularColor = new Color3(0.2, 0.2, 0.2)

    // Shape selection (cat/dog/classic)
    let shape = 'sphere'
    if (name === 'player') {
      shape = settingsManager.getSettings().characterShape || 'sphere'
    } else if (name === 'player-2') {
      shape = settingsManager.getSettings().characterShape || 'sphere'
    } else if (name.includes('enemy')) {
      shape = ['sphere', 'cat', 'dog'][Math.floor(Math.random() * 3)]
    }

    const T = TILE_SIZE

    // ── TORSO ──
    const torso = MeshBuilder.CreateCylinder(name + '-torso', {
      height: T * 0.3, diameterTop: T * 0.34, diameterBottom: T * 0.38, tessellation: 12
    }, scene)
    torso.position.y = T * 0.28
    torso.material = bodyMat
    torso.parent = root

    // Belt / waist accent stripe
    const belt = MeshBuilder.CreateTorus(name + '-belt', {
      diameter: T * 0.37, thickness: T * 0.04, tessellation: 16
    }, scene)
    belt.position.y = T * 0.17
    belt.material = accentMat
    belt.parent = root

    // ── HEAD ──
    let head: any
    let ears: any[] = []

    if (shape === 'cat') {
      head = MeshBuilder.CreateSphere(name + '-head', { diameter: T * 0.38, segments: 10 }, scene)
      head.material = skinMat

      // Shared inner ear material
      const pinkMat = new StandardMaterial(name + '-pinkMat', scene)
      pinkMat.diffuseColor = new Color3(1, 0.65, 0.7)
      pinkMat.specularColor = new Color3(0, 0, 0)

      // Pointed ears
      for (const side of [-1, 1]) {
        const ear = MeshBuilder.CreateCylinder(name + '-ear' + side, {
          height: 0.18, diameterTop: 0, diameterBottom: 0.14, tessellation: 4
        }, scene)
        ear.material = bodyMat
        ear.position = new Vector3(side * 0.11, 0.18, 0)
        ear.rotation.z = side * 0.35
        ear.parent = head

        // Inner ear pink
        const earInner = MeshBuilder.CreateCylinder(name + '-earIn' + side, {
          height: 0.12, diameterTop: 0, diameterBottom: 0.08, tessellation: 4
        }, scene)
        earInner.material = pinkMat
        earInner.position.y = 0.01
        earInner.parent = ear
        ears.push(ear)
      }

      // Whiskers
      for (const side of [-1, 1]) {
        for (const yOff of [-0.02, 0.02]) {
          const whisker = MeshBuilder.CreateCylinder(name + '-wh' + side + yOff, {
            height: 0.22, diameter: 0.012
          }, scene)
          whisker.rotation.z = Math.PI / 2
          whisker.rotation.y = side * 0.25
          whisker.position = new Vector3(side * 0.13, -0.03 + yOff, 0.14)
          whisker.material = darkMat
          whisker.parent = head
        }
      }

      // Small nose triangle
      const nose = MeshBuilder.CreateSphere(name + '-catNose', { diameter: 0.05 }, scene)
      const noseMat = new StandardMaterial(name + '-noseMat', scene)
      noseMat.diffuseColor = new Color3(1, 0.5, 0.55)
      noseMat.specularColor = new Color3(0, 0, 0)
      nose.material = noseMat
      nose.position = new Vector3(0, -0.04, 0.17)
      nose.scaling.z = 0.6
      nose.parent = head

    } else if (shape === 'dog') {
      head = MeshBuilder.CreateSphere(name + '-head', { diameter: T * 0.38, segments: 10 }, scene)
      head.material = skinMat

      // Floppy ears
      for (const side of [-1, 1]) {
        const ear = MeshBuilder.CreateBox(name + '-ear' + side, {
          width: 0.1, height: 0.28, depth: 0.06
        }, scene)
        ear.material = bodyMat
        ear.position = new Vector3(side * 0.18, 0.06, -0.02)
        ear.rotation.z = side * (Math.PI - 0.35)
        ear.parent = head
        ears.push(ear)
      }

      // Snout
      const snout = MeshBuilder.CreateCylinder(name + '-snout', {
        height: 0.18, diameterTop: 0.1, diameterBottom: 0.14, tessellation: 8
      }, scene)
      snout.rotation.x = Math.PI / 2
      snout.position = new Vector3(0, -0.04, 0.19)
      snout.material = skinMat
      snout.parent = head

      // Nose
      const nose = MeshBuilder.CreateSphere(name + '-dogNose', { diameter: 0.07 }, scene)
      nose.material = darkMat
      nose.position = new Vector3(0, -0.02, 0.28)
      nose.parent = head

      // Tongue
      const tongue = MeshBuilder.CreateBox(name + '-tongue', { width: 0.04, height: 0.08, depth: 0.02 }, scene)
      const tongueMat = new StandardMaterial(name + '-tongueMat', scene)
      tongueMat.diffuseColor = new Color3(1, 0.4, 0.45)
      tongueMat.specularColor = new Color3(0.3, 0.1, 0.1)
      tongue.material = tongueMat
      tongue.position = new Vector3(0, -0.1, 0.2)
      tongue.parent = head

    } else {
      // ── Classic humanoid head ──
      head = MeshBuilder.CreateSphere(name + '-head', { diameter: T * 0.36, segments: 10 }, scene)
      head.material = skinMat

      // Helmet / hair cap
      const helmet = MeshBuilder.CreateSphere(name + '-helmet', { diameter: T * 0.38, slice: 0.5 }, scene)
      helmet.rotation.x = Math.PI
      helmet.position.y = 0.02
      helmet.material = bodyMat
      helmet.parent = head

      // Mouth (tiny smile)
      const mouth = MeshBuilder.CreateTorus(name + '-mouth', {
        diameter: 0.07, thickness: 0.015, tessellation: 12
      }, scene)
      mouth.material = darkMat
      mouth.position = new Vector3(0, -0.06, 0.15)
      mouth.rotation.x = -0.3
      mouth.scaling = new Vector3(1, 0.5, 0.5)
      mouth.parent = head
    }

    head.position.y = T * 0.56
    head.parent = root

    // ── EYES ──  (white sclera + dark pupil + tiny white shine)
    const eyeSpread = shape === 'dog' ? 0.085 : 0.07
    const eyeForward = shape === 'dog' ? 0.17 : 0.14
    const eyeHeight = shape === 'cat' ? 0.03 : 0.04

    // Shared enemy eye material (hoisted outside loop)
    let enemyEyeMat: StandardMaterial | null = null
    if (name.includes('enemy')) {
      enemyEyeMat = new StandardMaterial(name + '-enemyEyeMat', scene)
      enemyEyeMat.diffuseColor = new Color3(0.9, 0.1, 0.1)
      enemyEyeMat.emissiveColor = new Color3(0.6, 0, 0)
    }

    for (const side of [-1, 1]) {
      // Sclera (white)
      const sclera = MeshBuilder.CreateSphere(name + '-sclera' + side, { diameter: T * 0.1, segments: 8 }, scene)
      sclera.position = new Vector3(side * eyeSpread * T, eyeHeight * T, eyeForward * T)
      sclera.scaling.z = 0.55
      sclera.material = whiteMat
      sclera.parent = head

      // Pupil
      const pupil = MeshBuilder.CreateSphere(name + '-pupil' + side, { diameter: T * 0.06, segments: 8 }, scene)
      pupil.position = new Vector3(0, 0, 0.02)
      pupil.scaling.z = 0.5
      pupil.parent = sclera

      if (enemyEyeMat) {
        pupil.material = enemyEyeMat
      } else {
        pupil.material = darkMat
      }

      // Specular shine dot
      const shine = MeshBuilder.CreateSphere(name + '-shine' + side, { diameter: T * 0.025 }, scene)
      shine.position = new Vector3(0.01, 0.015, 0.025)
      shine.material = whiteMat
      shine.parent = sclera
    }

    // ── ARMS (upper + forearm + hand) ──
    const armParts: { upper: any; lower: any; hand: any }[] = []
    for (const side of [-1, 1]) {
      // Upper arm
      const upper = MeshBuilder.CreateCylinder(name + '-upperArm' + side, {
        height: T * 0.16, diameterTop: T * 0.08, diameterBottom: T * 0.07, tessellation: 8
      }, scene)
      upper.material = bodyMat
      upper.position = new Vector3(side * T * 0.22, T * 0.36, 0)
      upper.parent = root

      // Forearm
      const lower = MeshBuilder.CreateCylinder(name + '-forearm' + side, {
        height: T * 0.14, diameterTop: T * 0.065, diameterBottom: T * 0.06, tessellation: 8
      }, scene)
      lower.material = skinMat
      lower.position.y = -T * 0.14
      lower.parent = upper

      // Hand (sphere)
      const hand = MeshBuilder.CreateSphere(name + '-hand' + side, { diameter: T * 0.08, segments: 6 }, scene)
      hand.material = skinMat
      hand.position.y = -T * 0.1
      hand.parent = lower

      armParts.push({ upper, lower, hand })
    }

    // ── LEGS (thigh + shin + foot) ──
    const legParts: { thigh: any; shin: any; foot: any }[] = []
    for (const side of [-1, 1]) {
      // Thigh
      const thigh = MeshBuilder.CreateCylinder(name + '-thigh' + side, {
        height: T * 0.16, diameterTop: T * 0.1, diameterBottom: T * 0.08, tessellation: 8
      }, scene)
      thigh.material = bodyMat
      thigh.position = new Vector3(side * T * 0.1, T * 0.12, 0)
      thigh.parent = root

      // Shin
      const shin = MeshBuilder.CreateCylinder(name + '-shin' + side, {
        height: T * 0.12, diameterTop: T * 0.07, diameterBottom: T * 0.06, tessellation: 8
      }, scene)
      shin.material = skinMat
      shin.position.y = -T * 0.13
      shin.parent = thigh

      // Foot (slightly elongated box)
      const foot = MeshBuilder.CreateBox(name + '-foot' + side, {
        width: T * 0.09, height: T * 0.05, depth: T * 0.14
      }, scene)
      foot.material = shoeMat
      foot.position = new Vector3(0, -T * 0.085, T * 0.02)
      foot.parent = shin

      legParts.push({ thigh, shin, foot })
    }

    // ── Tail (for animals) ──
    if (shape === 'cat') {
      const tail = MeshBuilder.CreateCylinder(name + '-tail', { height: 0.35, diameterTop: 0.02, diameterBottom: 0.05, tessellation: 6 }, scene)
      tail.material = bodyMat
      tail.position = new Vector3(0, T * 0.25, -T * 0.2)
      tail.rotation.x = Math.PI / 3
      tail.parent = root
    } else if (shape === 'dog') {
      const tail = MeshBuilder.CreateCylinder(name + '-tail', { height: 0.3, diameterTop: 0.03, diameterBottom: 0.06, tessellation: 6 }, scene)
      tail.material = bodyMat
      tail.position = new Vector3(0, T * 0.32, -T * 0.18)
      tail.rotation.x = -Math.PI / 5
      tail.parent = root
    }

    // ── Shadow disc under character ──
    const shadow = MeshBuilder.CreateDisc(name + '-shadow', { radius: T * 0.2, tessellation: 12 }, scene)
    shadow.rotation.x = Math.PI / 2
    shadow.position.y = 0.01
    const shadowMat = new StandardMaterial(name + '-shadowMat', scene)
    shadowMat.diffuseColor = new Color3(0, 0, 0)
    shadowMat.alpha = 0.35
    shadowMat.specularColor = new Color3(0, 0, 0)
    shadow.material = shadowMat
    shadow.parent = root

    // ── ANIMATION STATE ──
    let isMoving = false
    let animTime = 0
    let squashTimer = 0 // for landing / bomb-place squash

    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime()

      // Squash-stretch recovery (used when landing or placing bomb)
      if (squashTimer > 0) {
        squashTimer -= dt
        const t = Math.max(0, squashTimer / 200) // 200ms effect
        const squash = 1 - t * 0.2
        const stretch = 1 + t * 0.15
        root.scaling.copyFromFloats(stretch, squash, stretch)
        if (squashTimer <= 0) {
          root.scaling.copyFromFloats(1, 1, 1)
        }
      }

      if (isMoving) {
        animTime += dt * 0.004 // speed factor

        const walkCycle = animTime * 5 // ~5 rad/s for a brisk walk

        // ── Arms swing opposite ──
        const armSwing = Math.sin(walkCycle) * 0.25
        armParts[0].upper.rotation.x = armSwing
        armParts[1].upper.rotation.x = -armSwing
        // Forearms bend when swinging back
        armParts[0].lower.rotation.x = Math.max(0, -armSwing) * 0.35
        armParts[1].lower.rotation.x = Math.max(0, armSwing) * 0.35

        // ── Legs swing opposite ──
        const legSwing = Math.sin(walkCycle) * 0.28
        legParts[0].thigh.rotation.x = -legSwing
        legParts[1].thigh.rotation.x = legSwing
        // Knees bend on back-swing
        legParts[0].shin.rotation.x = Math.max(0, legSwing) * 0.35
        legParts[1].shin.rotation.x = Math.max(0, -legSwing) * 0.35

        // ── Body bob (double-frequency of steps) ──
        const bob = Math.abs(Math.sin(walkCycle)) * T * 0.03
        torso.position.y = T * 0.28 + bob
        head.position.y = T * 0.56 + bob

        // ── Slight torso lean forward ──
        torso.rotation.x = 0.05

        // ── Subtle body sway ──
        torso.rotation.z = Math.sin(walkCycle) * 0.025
        head.rotation.z = Math.sin(walkCycle) * 0.012

        // ── Shadow pulse ──
        const sBob = 1 - bob * 1.5
        shadow.scaling.copyFromFloats(sBob, sBob, sBob)

      } else {
        // ── IDLE: gentle breathing ──
        animTime += dt * 0.001 // accumulate for idle too
        const breathe = Math.sin(animTime * 2.5) * T * 0.008
        head.position.y = T * 0.56 + breathe
        torso.position.y = T * 0.28 + breathe * 0.5
        torso.rotation.x = 0
        torso.rotation.z = 0
        head.rotation.z = 0

        // Gentle arm sway
        const idleSway = Math.sin(animTime * 2.0) * 0.06
        armParts[0].upper.rotation.x = idleSway
        armParts[1].upper.rotation.x = -idleSway
        armParts[0].lower.rotation.x = 0.1
        armParts[1].lower.rotation.x = 0.1

        // Legs neutral
        legParts[0].thigh.rotation.x = 0
        legParts[1].thigh.rotation.x = 0
        legParts[0].shin.rotation.x = 0
        legParts[1].shin.rotation.x = 0

        shadow.scaling.copyFromFloats(1, 1, 1)
      }
    })

    root.onDisposeObservable.add(() => {
      scene.onBeforeRenderObservable.remove(observer)
      bodyMat.dispose(); skinMat.dispose(); darkMat.dispose()
      whiteMat.dispose(); shoeMat.dispose(); accentMat.dispose()
    })

    ;(root as any).playAnimation = (anim: string) => {
      if (anim.startsWith('walk')) {
        isMoving = true

        const targetRot =
          anim === 'walk-up' ? -Math.PI / 2 :
          anim === 'walk-down' ? Math.PI / 2 :
          anim === 'walk-left' ? Math.PI : 0

        root.rotation.y = targetRot

        if ((root as any).stopTimer) clearTimeout((root as any).stopTimer)
        ;(root as any).stopTimer = setTimeout(() => { isMoving = false }, 180)
      }
    }

    // Trigger squash-stretch (called externally when placing bomb)
    ;(root as any).triggerSquash = () => { squashTimer = 200 }

    return root as any
  }

  const player = createPlayerSprite('player', null, '🧑', settings.player1Color)
  ;(player as any)._cachedChildMeshes = player.getChildMeshes()
  let playerGridX = 1
  let playerGridY = 1
  const playerPos = gridToWorld(playerGridX, playerGridY)
  player.position.x = playerPos.x
  player.position.y = TILE_SIZE * 0.5
  player.position.z = playerPos.z
  
  // Player stats (affected by difficulty)
  let maxBombs = 1
  let currentBombs = 0
  let blastRadius = 1
  let playerLives = difficultyConfig.playerStartingLives
  let playerInvulnerable = false
  let playerInvulnerableTimer = 0
  let hasKick = false
  let hasThrow = false
  let playerSpeed = 1
  let moveDelay = 150 // milliseconds between moves
  let lastMoveTime = 0
  
  // Extended power-up state (Player 1)
  let shieldCharges = 0       // Absorbs hits (max 3)
  let hasPierce = false        // Blasts go through destructible blocks
  let ghostTimer = 0           // Remaining ms of ghost mode (walk through blocks)
  let powerBombCharges = 0     // Next bomb gets +3 blast radius
  let hasLineBomb = false       // Place row of bombs in facing direction
  
  // Smooth movement - visual position interpolates towards grid position
  let playerVisualX = playerPos.x
  let playerVisualZ = playerPos.z
  const MOVE_LERP_SPEED = 15 // Higher = faster interpolation

  // Determine number of enemies based on game mode
  const numEnemies = gameMode === '1v1' ? 1 : 
                     gameMode === '1v2' ? 2 : 
                     gameMode === '1v3' ? 3 :
                     gameMode === 'time-attack' ? 3 :
                     gameMode === 'survival' ? 1 : 0
  
  // Survival mode state
  let survivalWave = 1
  let survivalScore = 0

  // Enemy spawn positions
  const enemySpawns = [
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 }, // Bottom-right
    { x: 1, y: GRID_HEIGHT - 2 },              // Bottom-left
    { x: GRID_WIDTH - 2, y: 1 },               // Top-right
    { x: GRID_WIDTH / 2, y: GRID_HEIGHT - 2 }, // Bottom-center
  ]

  // Create enemies
  const enemies: Enemy[] = []
  const enemyEmojis = ['👾', '👹', '👺']
  // White, Brown, Dark Red - distinct from player settings
  const enemyColors = ['#ffffff', '#8d6e63', '#b91c1c'] 

  for (let i = 0; i < numEnemies; i++) {
    const spawn = enemySpawns[i]
    const enemyMesh = createPlayerSprite(`enemy-${i}`, null, enemyEmojis[i % 3], enemyColors[i % 3])
    const enemyPos = gridToWorld(spawn.x, spawn.y)
    const enemy: Enemy = {
      x: spawn.x,
      y: spawn.y,
      mesh: enemyMesh,
      moveTimer: Math.random() * 400, // Stagger movement
      lives: difficultyConfig.enemyStartingLives,
      invulnerable: false,
      invulnerableTimer: 0,
      visualX: enemyPos.x,
      visualZ: enemyPos.z,
    }
    enemy.mesh.position.x = enemyPos.x
    enemy.mesh.position.y = TILE_SIZE * 0.5
    enemy.mesh.position.z = enemyPos.z
    ;(enemy.mesh as any)._cachedChildMeshes = enemy.mesh.getChildMeshes()
    enemies.push(enemy)
  }

  // Player 2 for PvP mode
  let player2GridX = GRID_WIDTH - 2
  let player2GridY = GRID_HEIGHT - 2
  let player2Lives = 4
  let player2Invulnerable = false
  let player2InvulnerableTimer = 0
  let player2MaxBombs = 1
  let player2CurrentBombs = 0
  let player2BlastRadius = 1
  let player2HasKick = false
  let player2HasThrow = false
  let player2Speed = 1
  let player2MoveDelay = 150
  let lastPlayer2MoveTime = 0
  let lastPlayer2Dx = 0
  let lastPlayer2Dy = -1
  
  // Extended power-up state (Player 2)
  let player2ShieldCharges = 0
  let player2HasPierce = false
  let player2GhostTimer = 0
  let player2PowerBombCharges = 0
  let player2HasLineBomb = false
  
  // Player 2 smooth movement
  let player2VisualX = 0
  let player2VisualZ = 0

  let player2: any = null
  if (gameMode === 'pvp') {
    player2 = createPlayerSprite('player2', null, '👤', settings.player2Color)
    ;(player2 as any)._cachedChildMeshes = player2.getChildMeshes()
    const player2Pos = gridToWorld(player2GridX, player2GridY)
    player2.position.x = player2Pos.x
    player2.position.y = TILE_SIZE * 0.5
    player2.position.z = player2Pos.z
    player2VisualX = player2Pos.x
    player2VisualZ = player2Pos.z
  }

  // Game state
  const bombs: Bomb[] = []
  const powerUps: PowerUp[] = []
  let gameOver = false
  let gameWon = false
  
  // Chain reaction tracking
  let chainReactionCount = 0
  let chainReactionTimer: ReturnType<typeof setTimeout> | null = null

  // Clean up chain reaction timer on scene dispose
  scene.onDisposeObservable.add(() => {
    if (chainReactionTimer) { clearTimeout(chainReactionTimer); chainReactionTimer = null }
  })

  // Enemy stats (for AI) - each enemy has their own stats
  const enemyStats = enemies.map(() => ({
    maxBombs: 1,
    currentBombs: 0,
    blastRadius: 2,
  }))

  // UI for player (top-left) - positioned at bottom for mobile
  const isMobileDevice = isMobile()
  
  // Create pause button for mobile
  if (isMobileDevice) {
    const pauseBtn = document.createElement('div')
    pauseBtn.innerHTML = '⏸️'
    pauseBtn.style.position = 'absolute'
    pauseBtn.style.top = 'calc(12px + env(safe-area-inset-top, 0px))'
    pauseBtn.style.right = 'calc(12px + env(safe-area-inset-right, 0px))'
    pauseBtn.style.left = 'auto'
    pauseBtn.style.width = '44px'
    pauseBtn.style.height = '44px'
    pauseBtn.id = "mobile-pause-btn"
    pauseBtn.className = "mobile-pause-btn"
    pauseBtn.style.background = 'rgba(0,0,0,0.5)'
    pauseBtn.style.border = '2px solid rgba(255,255,255,0.3)'
    pauseBtn.style.borderRadius = '8px'
    pauseBtn.style.color = 'white'
    pauseBtn.style.display = 'flex'
    pauseBtn.style.alignItems = 'center'
    pauseBtn.style.justifyContent = 'center'
    pauseBtn.style.cursor = 'pointer'
    pauseBtn.style.zIndex = '2000'
    pauseBtn.style.fontSize = '20px'
    pauseBtn.style.backdropFilter = 'blur(4px)'
    
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    
    document.body.appendChild(pauseBtn)
  }

  const playerUIDiv = document.createElement('div')
  playerUIDiv.className = 'game-ui-panel'
  playerUIDiv.style.position = 'absolute'
  if (isMobileDevice) {
    // Bottom-center, between dpad (left) and bomb button (right)
    playerUIDiv.style.top = 'auto'
    playerUIDiv.style.bottom = 'calc(10px + env(safe-area-inset-bottom, 0px))'
    playerUIDiv.style.left = '50%'
    
    // Small scale, centered horizontally
    playerUIDiv.style.transform = 'translateX(-50%) scale(0.55)'
    playerUIDiv.style.transformOrigin = 'center bottom'
  } else {
    // PC: Centered at bottom with transparency
    playerUIDiv.style.bottom = '15px'
    playerUIDiv.style.left = '50%'
    playerUIDiv.style.transform = 'translateX(-50%)'
  }
  playerUIDiv.style.color = 'white'
  playerUIDiv.style.fontFamily = "'Russo One', sans-serif"
  playerUIDiv.style.fontSize = isMobileDevice ? '16px' : '14px'
  playerUIDiv.style.zIndex = '1000'
  playerUIDiv.style.minWidth = isMobileDevice ? '180px' : '160px'
  playerUIDiv.style.background = isMobileDevice 
    ? 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
    : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
  playerUIDiv.style.border = '2px solid rgba(255,68,68,0.3)'
  playerUIDiv.style.borderRadius = '12px'
  playerUIDiv.style.padding = isMobileDevice ? '6px 10px' : '8px 10px'
  playerUIDiv.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
  playerUIDiv.style.opacity = isMobileDevice ? '0.65' : '0.85'
  playerUIDiv.style.transition = 'opacity 0.2s ease'
  
  // PC: Make more visible on hover
  if (!isMobileDevice) {
    playerUIDiv.addEventListener('mouseenter', () => {
      playerUIDiv.style.opacity = '1'
      playerUIDiv.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(20,20,40,0.9) 100%)'
    })
    playerUIDiv.addEventListener('mouseleave', () => {
      playerUIDiv.style.opacity = '0.85'
      playerUIDiv.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
    })
  }
  document.body.appendChild(playerUIDiv)
  
  // UI for timer/rounds (top-center)
  const centerUIDiv = document.createElement('div')
  centerUIDiv.className = 'center-ui'
  centerUIDiv.style.position = 'absolute'
  if (isMobileDevice) {
    // Top center on mobile, compact — minimal footprint to avoid blocking view
    centerUIDiv.style.top = '6px'
    centerUIDiv.style.bottom = 'auto'
  } else {
    // PC: Keep at top center - doesn't block corners
    centerUIDiv.style.top = '10px'
  }
  centerUIDiv.style.left = '50%'
  centerUIDiv.style.transform = 'translateX(-50%)'
  centerUIDiv.style.color = 'white'
  centerUIDiv.style.fontFamily = "'Press Start 2P', 'Russo One', sans-serif"
  centerUIDiv.style.fontSize = isMobileDevice ? '11px' : '12px'
  centerUIDiv.style.fontWeight = 'bold'
  centerUIDiv.style.zIndex = '1000'
  centerUIDiv.style.textAlign = 'center'
  centerUIDiv.style.background = isMobileDevice
    ? 'linear-gradient(135deg, rgba(0,0,0,0.9) 0%, rgba(30,30,60,0.9) 100%)'
    : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(30,30,60,0.55) 100%)'
  centerUIDiv.style.border = '3px solid rgba(255, 102, 0, 0.5)'
  centerUIDiv.style.borderRadius = '12px'
  centerUIDiv.style.padding = isMobileDevice ? '6px 14px' : '8px 16px'
  centerUIDiv.style.boxShadow = '0 0 20px rgba(255, 102, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
  document.body.appendChild(centerUIDiv)

  // UI for opponents (top-right on PC, hidden on mobile)
  const opponentUIDiv = document.createElement('div')
  opponentUIDiv.className = 'game-ui-panel'
  opponentUIDiv.style.position = 'absolute'
  if (isMobileDevice) {
      // Hide opponent stats on mobile - controls take up the space
      opponentUIDiv.style.display = 'none'
  } else {
      // PC: Top right but semi-transparent
      opponentUIDiv.style.top = '10px'
      opponentUIDiv.style.right = '10px'
  }
  opponentUIDiv.style.color = 'white'
  opponentUIDiv.style.fontFamily = "'Russo One', sans-serif"
  opponentUIDiv.style.fontSize = isMobileDevice ? '16px' : '14px'
  opponentUIDiv.style.zIndex = '1000'
  opponentUIDiv.style.minWidth = isMobileDevice ? '180px' : '160px'
  opponentUIDiv.style.background = isMobileDevice
    ? 'linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(20,20,40,0.9) 100%)'
    : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
  opponentUIDiv.style.border = '2px solid rgba(204,68,255,0.3)'
  opponentUIDiv.style.borderRadius = '12px'
  opponentUIDiv.style.padding = isMobileDevice ? '12px' : '8px 10px'
  opponentUIDiv.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
  opponentUIDiv.style.opacity = isMobileDevice ? '1' : '0.85'
  opponentUIDiv.style.transition = 'opacity 0.2s ease'
  
  // PC: Make more visible on hover
  if (!isMobileDevice) {
    opponentUIDiv.addEventListener('mouseenter', () => {
      opponentUIDiv.style.opacity = '1'
      opponentUIDiv.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(20,20,40,0.9) 100%)'
    })
    opponentUIDiv.addEventListener('mouseleave', () => {
      opponentUIDiv.style.opacity = '0.85'
      opponentUIDiv.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
    })
  }
  document.body.appendChild(opponentUIDiv)

  // Mobile controls are created later (after keysHeld is defined) to properly
  // interact with the game's input system rather than dispatching synthetic KeyboardEvents.

  function updateUI() {
    // Update center UI (timer)
    const timeAttackState = gameStateManager.getTimeAttackState()
    
    if (gameMode === 'survival') {
      centerUIDiv.style.display = 'block'
      centerUIDiv.innerHTML = `
        <div style="color: #ffaa00; font-size: 16px;">🌊 WAVE ${survivalWave}</div>
        <div style="font-size: 12px; margin-top: 8px; color: #fff;">Score: <span style="color: #4CAF50;">${survivalScore}</span></div>
      `
    } else if (timeAttackState) {
      centerUIDiv.style.display = 'block'
      const timeString = gameStateManager.getTimeString()
      const timeColor = timeAttackState.timeRemaining < 30000 ? '#ff4444' : '#4CAF50'
      const isLowTime = timeAttackState.timeRemaining < 30000
      centerUIDiv.innerHTML = `
        <div style="color: ${timeColor}; font-size: ${isLowTime ? '20px' : '18px'}; ${isLowTime ? 'animation: pulse 0.5s infinite;' : ''}">⏱️ ${timeString}</div>
        <div style="font-size: 11px; margin-top: 8px; color: #aaa;">Defeated: <span style="color: #ff6600;">${timeAttackState.enemiesDefeated}</span></div>
      `
    } else {
      centerUIDiv.style.display = 'none'
    }
    
    // Generate health bar HTML
    const healthBarHTML = (lives: number, maxLives: number, isPlayer2: boolean = false) => {
      const percentage = (lives / maxLives) * 100
      const fillClass = isPlayer2 ? 'player-2' : ''
      const color = isPlayer2 ? settings.player2Color : settings.player1Color
      return `
        <div class="health-bar" style="width: 100%; height: 16px; background: #222; border-radius: 8px; overflow: hidden; border: 2px solid #444; margin: 6px 0;">
          <div class="health-bar-fill ${fillClass}" style="width: ${percentage}%; height: 100%; background: linear-gradient(180deg, ${color} 0%, ${color}99 100%); border-radius: 6px; transition: width 0.3s ease; box-shadow: 0 0 8px ${color}88;"></div>
        </div>
      `
    }
    
    // Generate powerup icons
    const powerupIconsHTML = (bombs: number, blast: number, kick: boolean, throwAbility: boolean, speed: number,
      shield: number, pierce: boolean, ghost: number, powerBomb: number, lineBomb: boolean) => {
      let html = `
      <div style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;">
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(66, 165, 245, 0.2); border: 2px solid #42A5F5; position: relative;" title="Bombs">
          <span style="font-size: 16px;">💣</span>
          <span style="font-size: 9px; color: #42A5F5; font-weight: bold;">${bombs}</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255, 202, 40, 0.2); border: 2px solid #FFCA28; position: relative;" title="Blast Radius">
          <span style="font-size: 16px;">⚡</span>
          <span style="font-size: 9px; color: #FFCA28; font-weight: bold;">${blast}</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${kick ? 'rgba(76, 175, 80, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${kick ? '#4CAF50' : '#555'}; opacity: ${kick ? '1' : '0.5'};" title="Kick">
          <span style="font-size: 16px;">🦶</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${throwAbility ? 'rgba(76, 175, 80, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${throwAbility ? '#4CAF50' : '#555'}; opacity: ${throwAbility ? '1' : '0.5'};" title="Throw">
          <span style="font-size: 16px;">✋</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0, 188, 212, 0.2); border: 2px solid #00BCD4; position: relative;" title="Speed">
          <span style="font-size: 16px;">👟</span>
          <span style="font-size: 9px; color: #00BCD4; font-weight: bold;">${speed}</span>
        </div>`

      // Extended power-up icons (only shown when extended mode is on)
      if (settings.extendedPowerUps) {
        html += `
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${shield > 0 ? 'rgba(255, 215, 0, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${shield > 0 ? '#ffd700' : '#555'}; opacity: ${shield > 0 ? '1' : '0.5'};" title="Shield (${shield})">
          <span style="font-size: 16px;">🛡️</span>
          ${shield > 0 ? `<span style="font-size: 9px; color: #ffd700; font-weight: bold;">${shield}</span>` : ''}
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${pierce ? 'rgba(255, 51, 51, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${pierce ? '#ff3333' : '#555'}; opacity: ${pierce ? '1' : '0.5'};" title="Pierce">
          <span style="font-size: 16px;">🔥</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${ghost > 0 ? 'rgba(179, 136, 255, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${ghost > 0 ? '#b388ff' : '#555'}; opacity: ${ghost > 0 ? '1' : '0.5'};" title="Ghost${ghost > 0 ? ' (' + Math.ceil(ghost / 1000) + 's)' : ''}">
          <span style="font-size: 16px;">👻</span>
          ${ghost > 0 ? `<span style="font-size: 9px; color: #b388ff; font-weight: bold;">${Math.ceil(ghost / 1000)}s</span>` : ''}
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${powerBomb > 0 ? 'rgba(255, 102, 0, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${powerBomb > 0 ? '#ff6600' : '#555'}; opacity: ${powerBomb > 0 ? '1' : '0.5'};" title="Power Bomb (${powerBomb})">
          <span style="font-size: 16px;">☢️</span>
          ${powerBomb > 0 ? `<span style="font-size: 9px; color: #ff6600; font-weight: bold;">${powerBomb}</span>` : ''}
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${lineBomb ? 'rgba(255, 0, 255, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${lineBomb ? '#ff00ff' : '#555'}; opacity: ${lineBomb ? '1' : '0.5'};" title="Line Bomb">
          <span style="font-size: 16px;">🧨</span>
        </div>`
      }

      html += `</div>`
      return html
    }

    playerUIDiv.innerHTML = `
      <div style="font-size: 12px; margin-bottom: 8px; color: ${settings.player1Color}; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px ${settings.player1Color}88;">Player 1</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">❤️</span>
        <span style="font-size: 14px; font-weight: bold;">${playerLives}/${difficultyConfig.playerStartingLives}</span>
      </div>
      ${healthBarHTML(playerLives, difficultyConfig.playerStartingLives)}
      ${powerupIconsHTML(maxBombs, blastRadius, hasKick, hasThrow, playerSpeed, shieldCharges, hasPierce, ghostTimer, powerBombCharges, hasLineBomb)}
    `
    
    if (gameMode === 'pvp') {
      opponentUIDiv.style.borderColor = `${settings.player2Color}44`
      opponentUIDiv.innerHTML = `
        <div style="font-size: 12px; margin-bottom: 8px; color: ${settings.player2Color}; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px ${settings.player2Color}88;">Player 2</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">❤️</span>
          <span style="font-size: 14px; font-weight: bold;">${player2Lives}/4</span>
        </div>
        ${healthBarHTML(player2Lives, 4, true)}
        ${powerupIconsHTML(player2MaxBombs, player2BlastRadius, player2HasKick, player2HasThrow, player2Speed, player2ShieldCharges, player2HasPierce, player2GhostTimer, player2PowerBombCharges, player2HasLineBomb)}
      `
    } else {
      opponentUIDiv.style.borderColor = 'rgba(204, 68, 255, 0.3)'
      let enemiesHTML = `<div style="font-size: 12px; margin-bottom: 10px; color: #cc44ff; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px rgba(204, 68, 255, 0.5);">Enemies</div>`
      
      const aliveEnemies = enemies.filter(e => e.lives > 0)
      if (aliveEnemies.length === 0) {
        enemiesHTML += `<div style="color: #4CAF50; font-size: 14px;">All defeated! 🎉</div>`
      } else {
        aliveEnemies.forEach((enemy, i) => {
          const idx = enemies.indexOf(enemy)
          enemiesHTML += `
            <div style="margin-bottom: 8px; ${i > 0 ? 'border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;' : ''}">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="font-size: 14px;">${['👾', '👹', '👺'][idx % 3]}</span>
                <span style="font-size: 12px; color: #aaa;">AI ${idx + 1}</span>
                <span style="font-size: 11px; color: #888; margin-left: auto;">💣${enemyStats[idx].maxBombs} ⚡${enemyStats[idx].blastRadius}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px;">❤️ ${enemy.lives}</span>
                <div style="flex: 1; height: 8px; background: #222; border-radius: 4px; overflow: hidden;">
                  <div style="width: ${(enemy.lives / difficultyConfig.enemyStartingLives) * 100}%; height: 100%; background: linear-gradient(90deg, #cc44ff, #9933cc); border-radius: 4px;"></div>
                </div>
              </div>
            </div>
          `
        })
      }
      opponentUIDiv.innerHTML = enemiesHTML
    }
    
    if (gameOver) {
      // Hide pause menu if it was showing during game over
      isPaused = false
      pauseMenu.style.display = 'none'

      // Create a winner overlay instead of appending to playerUI
      const existingOverlay = document.getElementById('game-over-overlay')
      if (!existingOverlay) {
        const overlay = document.createElement('div')
        overlay.id = 'game-over-overlay'
        overlay.className = 'winner-overlay'
        overlay.style.position = 'fixed'
        overlay.style.top = '0'
        overlay.style.left = '0'
        overlay.style.width = '100%'
        overlay.style.height = '100%'
        overlay.style.background = 'rgba(0,0,0,0.85)'
        overlay.style.display = 'flex'
        overlay.style.flexDirection = 'column'
        overlay.style.justifyContent = 'center'
        overlay.style.alignItems = 'center'
        overlay.style.zIndex = '3000'
        overlay.style.animation = 'fadeIn 0.5s ease'
        
        // Winner text
        const winnerText = document.createElement('div')
        winnerText.className = `winner-text ${gameWon ? 'victory' : 'defeat'}`
        winnerText.style.fontFamily = "'Press Start 2P', cursive"
        winnerText.style.fontSize = '42px'
        winnerText.style.marginBottom = '20px'
        
        let winColor = gameWon ? '#4CAF50' : '#f44336'
        let titleText = gameWon ? '🎉 VICTORY! 🎉' : '💀 GAME OVER 💀'
        let shadowColor = gameWon ? '#388E3C' : '#c62828'
        
        if (gameMode === 'pvp') {
          winColor = gameWon ? settings.player1Color : settings.player2Color
          titleText = gameWon ? '🏆 PLAYER 1 WINS! 🏆' : '🏆 PLAYER 2 WINS! 🏆'
          shadowColor = winColor
          
          // Force victory style for both players in PvP
          winnerText.className = 'winner-text victory'
        }

        winnerText.style.color = winColor
        winnerText.style.textShadow = `0 0 20px ${winColor}, 0 0 40px ${winColor}, 0 0 60px ${shadowColor}`
        winnerText.style.animation = 'winnerPulse 1s ease-in-out infinite'
        winnerText.textContent = titleText
        overlay.appendChild(winnerText)
        
        // Survival/Time Attack stats
        if (gameMode === 'survival') {
          const statsDiv = document.createElement('div')
          statsDiv.style.color = '#ffaa00'
          statsDiv.style.fontSize = '20px'
          statsDiv.style.marginBottom = '10px'
          statsDiv.style.fontFamily = "'Russo One', sans-serif"
          statsDiv.innerHTML = `🌊 Survived ${survivalWave} waves!<br>Score: ${survivalScore}`
          overlay.appendChild(statsDiv)
        }
        
        // Button container
        const buttonContainer = document.createElement('div')
        buttonContainer.style.display = 'flex'
        buttonContainer.style.gap = '15px'
        buttonContainer.style.marginTop = '30px'
        if (isMobileDevice) {
          buttonContainer.style.flexDirection = 'column'
          buttonContainer.style.alignItems = 'center'
        }
        
        // Helper: make button touch-friendly
        const touchActivate = (btn: HTMLButtonElement) => {
          ;(btn.style as any).webkitTapHighlightColor = 'transparent'
          btn.style.touchAction = 'manipulation'
          btn.style.userSelect = 'none'
          btn.addEventListener('touchstart', () => btn.style.transform = 'scale(0.95)', { passive: true })
          btn.addEventListener('touchend', () => btn.style.transform = '', { passive: true })
        }

        // Restart button
        const restartBtn = document.createElement('button')
        restartBtn.innerHTML = '🔄 Play Again'
        restartBtn.style.fontSize = isMobileDevice ? '20px' : '18px'
        restartBtn.style.padding = isMobileDevice ? '18px 50px' : '15px 35px'
        restartBtn.style.cursor = 'pointer'
        restartBtn.style.background = 'linear-gradient(180deg, #4CAF50 0%, #388E3C 100%)'
        restartBtn.style.color = 'white'
        restartBtn.style.border = '3px solid #2E7D32'
        restartBtn.style.borderRadius = '8px'
        restartBtn.style.fontFamily = "'Russo One', sans-serif"
        restartBtn.style.boxShadow = '0 4px 0 #1B5E20, 0 6px 10px rgba(0,0,0,0.3)'
        restartBtn.style.transition = 'all 0.15s ease'
        if (isMobileDevice) restartBtn.style.width = '80%'
        touchActivate(restartBtn)
        
        restartBtn.addEventListener('mouseenter', () => {
          restartBtn.style.transform = 'translateY(-2px)'
          restartBtn.style.background = 'linear-gradient(180deg, #66BB6A 0%, #4CAF50 100%)'
        })
        restartBtn.addEventListener('mouseleave', () => {
          restartBtn.style.transform = 'translateY(0)'
          restartBtn.style.background = 'linear-gradient(180deg, #4CAF50 0%, #388E3C 100%)'
        })
        restartBtn.addEventListener('click', () => {
          overlay.remove()
          playerUIDiv.remove()
          opponentUIDiv.remove()
          centerUIDiv.remove()
          // Clean up mobile controls and indicators (match "Main Menu" cleanup)
          document.querySelectorAll('.mobile-controls-container, .mobile-controls-wrapper, .mobile-pause-btn, .offscreen-indicator, #indicator-container').forEach(el => el.remove())
          startGame(gameMode)
        })
        buttonContainer.appendChild(restartBtn)
        
        // Menu button
        const menuBtn = document.createElement('button')
        menuBtn.innerHTML = '🏠 Main Menu'
        menuBtn.style.fontSize = isMobileDevice ? '20px' : '18px'
        menuBtn.style.padding = isMobileDevice ? '18px 50px' : '15px 35px'
        menuBtn.style.cursor = 'pointer'
        menuBtn.style.background = 'linear-gradient(180deg, #f44336 0%, #c62828 100%)'
        menuBtn.style.color = 'white'
        menuBtn.style.border = '3px solid #b71c1c'
        menuBtn.style.borderRadius = '8px'
        menuBtn.style.fontFamily = "'Russo One', sans-serif"
        menuBtn.style.boxShadow = '0 4px 0 #7f0000, 0 6px 10px rgba(0,0,0,0.3)'
        menuBtn.style.transition = 'all 0.15s ease'
        if (isMobileDevice) menuBtn.style.width = '80%'
        touchActivate(menuBtn)
        
        menuBtn.addEventListener('mouseenter', () => {
          menuBtn.style.transform = 'translateY(-2px)'
          menuBtn.style.background = 'linear-gradient(180deg, #ef5350 0%, #f44336 100%)'
        })
        menuBtn.addEventListener('mouseleave', () => {
          menuBtn.style.transform = 'translateY(0)'
          menuBtn.style.background = 'linear-gradient(180deg, #f44336 0%, #c62828 100%)'
        })
        menuBtn.addEventListener('click', () => {
          overlay.remove()
          playerUIDiv.remove()
          opponentUIDiv.remove()
          centerUIDiv.remove()
          mainMenu.style.display = 'flex'
          
          // Dispose scene first, then engine (correct order for GPU resource cleanup)
          if (currentScene) {
            currentScene.dispose()
            currentScene = null
          }
          if (currentEngine) {
            currentEngine.dispose()
            currentEngine = null
          }
          
          document.querySelectorAll('#app > div').forEach(el => {
            if (el.id !== 'main-menu' && el.id !== 'pause-menu') {
              el.remove()
            }
          })
          
          // Explicitly remove mobile controls
          document.querySelectorAll('.mobile-controls-wrapper').forEach(el => el.remove())
          document.querySelectorAll('.mobile-controls-container').forEach(el => el.remove())
          document.querySelectorAll('.mobile-pause-btn').forEach(el => el.remove())
        })
        buttonContainer.appendChild(menuBtn)
        
        overlay.appendChild(buttonContainer)
        document.body.appendChild(overlay)
        
        // Add confetti for victory
        if (gameWon) {
          for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div')
            confetti.className = 'confetti'
            confetti.style.position = 'absolute'
            confetti.style.left = `${Math.random() * 100}%`
            confetti.style.top = '-10px'
            confetti.style.width = '10px'
            confetti.style.height = '10px'
            confetti.style.background = ['#ff0', '#f00', '#0f0', '#00f', '#f0f', '#0ff'][Math.floor(Math.random() * 6)]
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0'
            confetti.style.animation = `confettiFall ${2 + Math.random() * 2}s ease-in-out forwards`
            confetti.style.animationDelay = `${Math.random() * 2}s`
            overlay.appendChild(confetti)
          }
        }
      }
    }
  }
  updateUI()

  // Helper function to check if tile blocks explosions
  function blocksExplosion(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return true
    return grid[y][x] === 'wall'
  }
  
  // Shared explosion material (reused across all explosion visuals)
  const sharedExplosionMat = new StandardMaterial('shared-exp-mat', scene)
  sharedExplosionMat.emissiveColor = new Color3(1, 0.5, 0)
  sharedExplosionMat.diffuseColor = new Color3(1, 0.3, 0)
  sharedExplosionMat.specularColor = new Color3(0, 0, 0)
  sharedExplosionMat.alpha = 0.9

  // Shared halo material for explosions
  const sharedHaloMat = new StandardMaterial('shared-halo-mat', scene)
  sharedHaloMat.emissiveColor = new Color3(1, 0.6, 0.1)
  sharedHaloMat.diffuseColor = new Color3(0, 0, 0)
  sharedHaloMat.alpha = 0.4
  sharedHaloMat.specularColor = new Color3(0, 0, 0)

  // Shared scorch material for explosions
  const sharedScorchMat = new StandardMaterial('shared-scorch-mat', scene)
  sharedScorchMat.diffuseColor = new Color3(0.15, 0.1, 0.05)
  sharedScorchMat.alpha = 0.7
  sharedScorchMat.specularColor = new Color3(0, 0, 0)

  // Cached power-up materials (one per type, reused across all power-ups)
  const powerUpMaterialCache = new Map<PowerUpType, StandardMaterial>()
  function getPowerUpMaterial(type: PowerUpType): StandardMaterial {
    if (powerUpMaterialCache.has(type)) return powerUpMaterialCache.get(type)!
    
    const emoji = type === 'extraBomb' ? '💣' :
                  type === 'largerBlast' ? '⚡' :
                  type === 'kick' ? '🦶' :
                  type === 'throw' ? '✋' :
                  type === 'shield' ? '🛡️' :
                  type === 'pierce' ? '🔥' :
                  type === 'ghost' ? '👻' :
                  type === 'powerBomb' ? '☢️' :
                  type === 'lineBomb' ? '🧨' : '👟'
    const glowColor = type === 'extraBomb' ? 'cyan' :
                      type === 'largerBlast' ? 'yellow' :
                      type === 'kick' ? 'orange' :
                      type === 'throw' ? 'pink' :
                      type === 'shield' ? '#ffd700' :
                      type === 'pierce' ? '#ff3333' :
                      type === 'ghost' ? '#b388ff' :
                      type === 'powerBomb' ? '#ff6600' :
                      type === 'lineBomb' ? '#ff00ff' : 'cyan'
    
    const dynamicTexture = new DynamicTexture('powerupTexture-' + type, 256, scene, true)
    const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
    
    ctx.clearRect(0, 0, 256, 256)
    ctx.beginPath()
    ctx.arc(128, 128, 120, 0, Math.PI * 2)
    ctx.fillStyle = glowColor
    ctx.fill()
    ctx.beginPath()
    ctx.arc(128, 128, 110, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.9)'
    ctx.fill()
    ctx.font = 'bold 160px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'white'
    ctx.fillText(emoji, 128, 138)
    dynamicTexture.update()
    
    const mat = new StandardMaterial('emojiMat-' + type, scene)
    mat.diffuseTexture = dynamicTexture
    mat.emissiveColor = new Color3(0.8, 0.8, 0.8)
    mat.opacityTexture = dynamicTexture
    mat.disableLighting = true
    mat.backFaceCulling = false
    
    powerUpMaterialCache.set(type, mat)
    return mat
  }

  // Create a stylized bomb with fuse
  // Shared bomb materials (reused across all bombs to reduce draw calls)
  const sharedBombMat = new StandardMaterial('shared-bomb-mat', scene)
  sharedBombMat.diffuseColor = new Color3(0.12, 0.12, 0.14)
  sharedBombMat.specularColor = new Color3(0.5, 0.5, 0.5)
  sharedBombMat.specularPower = 48

  const sharedFuseMat = new StandardMaterial('shared-fuse-mat', scene)
  sharedFuseMat.diffuseColor = new Color3(0.55, 0.35, 0.15)
  sharedFuseMat.specularColor = new Color3(0, 0, 0)

  const sharedRivetMat = new StandardMaterial('shared-rivet-mat', scene)
  sharedRivetMat.diffuseColor = new Color3(0.45, 0.45, 0.48)
  sharedRivetMat.specularColor = new Color3(0.6, 0.6, 0.6)
  sharedRivetMat.specularPower = 64

  const sharedSparkMat = new StandardMaterial('shared-spark-mat', scene)
  sharedSparkMat.emissiveColor = new Color3(1, 0.7, 0.1)
  sharedSparkMat.diffuseColor = new Color3(1, 0.9, 0.3)
  sharedSparkMat.specularColor = new Color3(0, 0, 0)

  const sharedDangerMat = new StandardMaterial('shared-danger-mat', scene)
  sharedDangerMat.diffuseColor = new Color3(1, 0.15, 0)
  sharedDangerMat.emissiveColor = new Color3(0.3, 0, 0)
  sharedDangerMat.alpha = 0
  sharedDangerMat.specularColor = new Color3(0, 0, 0)

  function createBombMesh() {
    const T = TILE_SIZE

    // Main bomb body — slightly squashed sphere for cartoon feel
    const bombBody = MeshBuilder.CreateSphere('bomb-body', { diameter: T * 0.52, segments: 12 }, scene)
    bombBody.scaling = new Vector3(1, 0.92, 1)
    bombBody.material = sharedBombMat

    // Metallic rim band around equator
    const band = MeshBuilder.CreateTorus('band', {
      diameter: T * 0.36, thickness: T * 0.045, tessellation: 20
    }, scene)
    band.rotation.x = Math.PI / 2
    band.position.y = 0
    band.material = sharedRivetMat
    band.parent = bombBody

    // Rivets around the band (6 evenly spaced)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2
      const rivet = MeshBuilder.CreateSphere('rivet' + i, { diameter: T * 0.04, segments: 4 }, scene)
      rivet.position = new Vector3(
        Math.cos(angle) * T * 0.18,
        0,
        Math.sin(angle) * T * 0.18
      )
      rivet.material = sharedRivetMat
      rivet.parent = bombBody
    }

    // Fuse base (nozzle)
    const nozzle = MeshBuilder.CreateCylinder('nozzle', {
      height: T * 0.08, diameterTop: T * 0.1, diameterBottom: T * 0.06, tessellation: 8
    }, scene)
    nozzle.position.y = T * 0.26
    nozzle.material = sharedRivetMat
    nozzle.parent = bombBody

    // Fuse (slightly curved using two segments)
    const fuseBase = MeshBuilder.CreateCylinder('fuse-base', {
      height: T * 0.12, diameter: T * 0.04, tessellation: 6
    }, scene)
    fuseBase.position.y = T * 0.34
    fuseBase.rotation.z = 0.15
    fuseBase.material = sharedFuseMat
    fuseBase.parent = bombBody

    const fuseTip = MeshBuilder.CreateCylinder('fuse-tip', {
      height: T * 0.1, diameter: T * 0.035, tessellation: 6
    }, scene)
    fuseTip.position.y = T * 0.06
    fuseTip.rotation.z = 0.2
    fuseTip.material = sharedFuseMat
    fuseTip.parent = fuseBase

    // Spark / flame on tip
    const spark = MeshBuilder.CreateSphere('spark', { diameter: T * 0.1, segments: 6 }, scene)
    spark.position.y = T * 0.12
    spark.material = sharedSparkMat
    spark.parent = fuseBase

    // Danger ring on the ground (grows as bomb nears detonation)
    const dangerRing = MeshBuilder.CreateTorus('danger-ring', {
      diameter: T * 0.6, thickness: T * 0.02, tessellation: 24
    }, scene)
    dangerRing.rotation.x = Math.PI / 2
    dangerRing.position.y = -T * 0.24
    dangerRing.material = sharedDangerMat
    dangerRing.parent = bombBody

    return bombBody
  }

  // Cache spark and danger-ring mesh refs on a bomb object for per-frame access
  function cacheBombChildRefs(bomb: any) {
    const children = bomb.mesh.getChildMeshes()
    bomb._spark = children.find((m: any) => m.name === 'spark') || null
    bomb._dangerRing = children.find((m: any) => m.name === 'danger-ring') || null
  }

  // Place bomb function (for player 1 or enemies)
  function placeBomb(x: number, y: number, ownerId: number = -1, ownerBlastRadius?: number) {
    // For player 1
    if (ownerId === -1 && currentBombs >= maxBombs) return
    
    // Check if there's already a bomb at this position
    if (bombs.some(b => b.x === x && b.y === y)) return

    const bombMesh = createBombMesh()
    bombMesh.position = gridToWorld(x, y)

    // Calculate blast radius (with Power Bomb bonus for player 1)
    let effectiveBlastRadius = ownerBlastRadius !== undefined ? ownerBlastRadius : blastRadius
    if (ownerId === -1 && powerBombCharges > 0) {
      effectiveBlastRadius += 3
      powerBombCharges--
      // Visual: tint the bomb orange to indicate power bomb (clone to avoid mutating shared material)
      if (bombMesh.material) {
        const pbMat = (bombMesh.material as StandardMaterial).clone('power-bomb-mat')!
        pbMat.emissiveColor = new Color3(1, 0.4, 0)
        bombMesh.material = pbMat
      }
      updateUI()
    }

    bombs.push({
      x,
      y,
      timer: 2000, // 2.0 seconds
      mesh: bombMesh,
      blastRadius: effectiveBlastRadius,
      ownerId,
    })
    cacheBombChildRefs(bombs[bombs.length - 1])
    
    if (ownerId === -1) {
      currentBombs++
      if ((player as any).triggerSquash) (player as any).triggerSquash()
    }
    
    // Play sound and track stats
    if (soundManager) soundManager.playSFX('bomb-place')
    haptic(10)
    statsManager.recordBombPlaced()
    
    // Check bomber achievement
    if (achievementsManager.incrementProgress('bomber')) {
      showAchievementNotification(achievementsManager.getAchievement('bomber')!)
    }
  }

  // Line Bomb: place a row of bombs in facing direction
  function placeLineBomb(startX: number, startY: number, dx: number, dy: number, ownerId: number) {
    const isP1 = ownerId === -1
    const isP2 = ownerId === -2
    const max = isP1 ? maxBombs : isP2 ? player2MaxBombs : 1
    const current = isP1 ? currentBombs : isP2 ? player2CurrentBombs : 0
    const available = max - current
    if (available <= 0) return

    let placed = 0
    for (let i = 0; i < available; i++) {
      const bx = startX + dx * i
      const by = startY + dy * i
      if (bx < 0 || by < 0 || bx >= GRID_WIDTH || by >= GRID_HEIGHT) break
      if (grid[by][bx] === 'wall') break
      if (grid[by][bx] === 'destructible') break
      if (bombs.some(b => b.x === bx && b.y === by)) continue

      const bombMesh = createBombMesh()
      bombMesh.position = gridToWorld(bx, by)

      const br = isP1 ? blastRadius : isP2 ? player2BlastRadius : 2
      bombs.push({ x: bx, y: by, timer: 2200, mesh: bombMesh, blastRadius: br, ownerId })
      cacheBombChildRefs(bombs[bombs.length - 1])
      placed++
      if (soundManager) soundManager.playSFX('bomb-place')
      statsManager.recordBombPlaced()
    }

    if (isP1) currentBombs += placed
    else if (isP2) player2CurrentBombs += placed
    if (placed > 0) haptic(30)
  }

  // Shared particle constants (avoid per-system allocations)
  let _sharedFlareTexture: Texture | null = null
  function getSharedFlareTexture(): Texture {
    if (_sharedFlareTexture && !(_sharedFlareTexture as any)._isDisposed) return _sharedFlareTexture
    try {
      _sharedFlareTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
    } catch (e) {
      _sharedFlareTexture = new Texture('', scene)
    }
    return _sharedFlareTexture!
  }
  const FIRE_COLOR1 = new Color4(1, 0.8, 0.2, 1)
  const FIRE_COLOR2 = new Color4(1, 0.3, 0, 1)
  const FIRE_COLOR_DEAD = new Color4(0.2, 0.2, 0.2, 0)
  const FIRE_GRAVITY = new Vector3(0, 2, 0)
  const FIRE_DIR1 = new Vector3(-1.5, 2, -1.5)
  const FIRE_DIR2 = new Vector3(1.5, 3, 1.5)
  const SMOKE_COLOR1 = new Color4(0.85, 0.85, 0.85, 0.7)
  const SMOKE_COLOR2 = new Color4(0.65, 0.65, 0.65, 0.5)
  const SMOKE_COLOR_DEAD = new Color4(0.5, 0.5, 0.5, 0)
  const SMOKE_GRAVITY = new Vector3(0, 0.3, 0)
  const SMOKE_DIR1 = new Vector3(-1.2, 0.3, -1.2)
  const SMOKE_DIR2 = new Vector3(1.2, 1.8, 1.2)

  // Create particle system for explosions
  function createExplosionParticles(x: number, y: number) {
    const particleSystem = new ParticleSystem('explosion', 50, scene)
    
    // Use Vector3 emitter directly (no mesh allocation needed)
    particleSystem.emitter = gridToWorld(x, y)

    particleSystem.particleTexture = getSharedFlareTexture()
    
    // Use shared color/direction constants
    particleSystem.color1 = FIRE_COLOR1
    particleSystem.color2 = FIRE_COLOR2
    particleSystem.colorDead = FIRE_COLOR_DEAD

    particleSystem.minSize = 0.15
    particleSystem.maxSize = 0.4

    particleSystem.minLifeTime = 0.15
    particleSystem.maxLifeTime = 0.35

    particleSystem.emitRate = 300
    particleSystem.blendMode = ParticleSystem.BLENDMODE_ADD

    particleSystem.gravity = FIRE_GRAVITY

    particleSystem.direction1 = FIRE_DIR1
    particleSystem.direction2 = FIRE_DIR2

    particleSystem.minEmitPower = 3
    particleSystem.maxEmitPower = 6

    particleSystem.updateSpeed = 0.008

    particleSystem.start()

    setTimeout(() => {
      if (scene.isDisposed) return
      particleSystem.stop()
      setTimeout(() => {
        if (!scene.isDisposed) {
          particleSystem.particleTexture = null // protect shared texture
          particleSystem.dispose()
        }
      }, 400)
    }, 150)
  }
  
  // Create a white smoke texture for particle systems
  // Shared smoke texture (reused across all smoke particle systems)
  let _sharedSmokeTexture: Texture | null = null
  function getSharedSmokeTexture(): Texture {
    if (_sharedSmokeTexture && !(_sharedSmokeTexture as any)._isDisposed) return _sharedSmokeTexture
    const dynamicTexture = new DynamicTexture("smokeTexture-shared", 64, scene, false);
    const ctx = dynamicTexture.getContext();
    const size = dynamicTexture.getSize();
    const mid = size.width / 2;
    ctx.clearRect(0, 0, size.width, size.height);
    const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.5, "rgba(220, 220, 220, 0.8)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size.width, size.height);
    dynamicTexture.update();
    _sharedSmokeTexture = dynamicTexture;
    return dynamicTexture;
  }

  // Create smoke particles for after explosion
  function createSmokeParticles(x: number, y: number) {
    const smokeSystem = new ParticleSystem('smoke', 100, scene)
    
    // Wide emit box so smoke starts beyond a single tile
    smokeSystem.emitter = gridToWorld(x, y)
    smokeSystem.minEmitBox = new Vector3(-0.4, 0, -0.4)
    smokeSystem.maxEmitBox = new Vector3(0.4, 0.15, 0.4)
    
    smokeSystem.particleTexture = getSharedSmokeTexture()

    smokeSystem.color1 = SMOKE_COLOR1
    smokeSystem.color2 = SMOKE_COLOR2
    smokeSystem.colorDead = SMOKE_COLOR_DEAD
    
    // Large particles that visually overlap across tiles
    smokeSystem.minSize = 0.4
    smokeSystem.maxSize = 1.4
    
    smokeSystem.minLifeTime = 0.8
    smokeSystem.maxLifeTime = 2.2
    
    smokeSystem.emitRate = 100
    smokeSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD
    
    smokeSystem.gravity = SMOKE_GRAVITY
    smokeSystem.direction1 = SMOKE_DIR1
    smokeSystem.direction2 = SMOKE_DIR2
    
    // Enough power to drift into neighboring tiles
    smokeSystem.minEmitPower = 0.4
    smokeSystem.maxEmitPower = 1.4
    
    // Rotation for natural billowing & merging appearance
    smokeSystem.minAngularSpeed = -0.8
    smokeSystem.maxAngularSpeed = 0.8
    
    // Size growth over lifetime — particles expand as they rise
    smokeSystem.addSizeGradient(0, 0.4)
    smokeSystem.addSizeGradient(0.4, 1.0)
    smokeSystem.addSizeGradient(1.0, 1.6)
    
    smokeSystem.start()
    
    setTimeout(() => {
      if (scene.isDisposed) return
      smokeSystem.stop()
      setTimeout(() => {
        if (!scene.isDisposed) {
          smokeSystem.particleTexture = null // protect shared texture
          smokeSystem.dispose()
        }
      }, 2000)
    }, 350)
  }

  // Explode bomb function
  function explodeBomb(bomb: Bomb) {
    // Screen shake and sound
    screenShake(0.4, 250)
    if (soundManager) soundManager.playSFX('explosion')
    haptic([50, 30, 80])
    
    // Check if bomb owner has pierce ability
    const ownerHasPierce = bomb.ownerId === -1 ? hasPierce :
                           bomb.ownerId === -2 ? player2HasPierce : false
    
    const explosionTiles: Array<[number, number]> = [[bomb.x, bomb.y]]
    
    // Check in 4 directions
    const directions = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]

    for (const [dx, dy] of directions) {
      for (let i = 1; i <= bomb.blastRadius; i++) {
        const x = bomb.x + dx * i
        const y = bomb.y + dy * i

        if (blocksExplosion(x, y)) break

        explosionTiles.push([x, y])

        // Stop if we hit a destructible block (unless pierce)
        if (grid[y][x] === 'destructible' && !ownerHasPierce) break
      }
    }

    // Create explosion visuals with animation
    const explosionMeshes: any[] = []
    for (let idx = 0; idx < explosionTiles.length; idx++) {
      const [x, y] = explosionTiles[idx]
      const isCenter = idx === 0

      // ── Core fireball ──
      const fireball = MeshBuilder.CreateSphere('exp-fire', {
        diameter: TILE_SIZE * (isCenter ? 0.95 : 0.8), segments: 8
      }, scene)
      fireball.position = gridToWorld(x, y)
      fireball.material = sharedExplosionMat
      explosionMeshes.push(fireball)

      // ── Outer glow halo ──
      const halo = MeshBuilder.CreateSphere('exp-halo', {
        diameter: TILE_SIZE * (isCenter ? 1.2 : 1.0), segments: 6
      }, scene)
      halo.position = gridToWorld(x, y)
      halo.material = sharedHaloMat
      explosionMeshes.push(halo)

      // ── Ground scorch ring ──
      const scorch = MeshBuilder.CreateDisc('exp-scorch', {
        radius: TILE_SIZE * 0.4, tessellation: 12
      }, scene)
      scorch.rotation.x = Math.PI / 2
      scorch.position = gridToWorld(x, y)
      scorch.position.y = 0.02
      scorch.material = sharedScorchMat
      explosionMeshes.push(scorch)

      // Create fire particle effect
      createExplosionParticles(x, y)

      // Add smoke after fire (slightly later so smoke is visible after fireball fades)
      setTimeout(() => createSmokeParticles(x, y), 150)

      // Staggered timing for directional tiles (ripple outward)
      const delay = idx === 0 ? 0 : idx * 0.8

      // ── Fireball animation ──
      const scaleAnim = new Animation('scaleAnim', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3)
      scaleAnim.setKeys([
        { frame: delay + 0, value: new Vector3(0.05, 0.05, 0.05) },
        { frame: delay + 3, value: new Vector3(1.4, 1.5, 1.4) },
        { frame: delay + 7, value: new Vector3(1.1, 1.0, 1.1) },
        { frame: delay + 14, value: new Vector3(0.5, 0.3, 0.5) },
        { frame: delay + 20, value: new Vector3(0, 0, 0) },
      ])
      fireball.animations.push(scaleAnim)

      const fadeAnim = new Animation('fadeAnim', 'visibility', 60, Animation.ANIMATIONTYPE_FLOAT)
      fadeAnim.setKeys([
        { frame: delay + 0, value: 1 },
        { frame: delay + 10, value: 0.9 },
        { frame: delay + 20, value: 0 },
      ])
      fireball.animations.push(fadeAnim)
      scene.beginAnimation(fireball, 0, delay + 24, false)

      // ── Halo animation (expand & fade) — shorter to reduce glow lingering ──
      const haloScale = new Animation('haloScale', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3)
      haloScale.setKeys([
        { frame: delay + 0, value: new Vector3(0.3, 0.3, 0.3) },
        { frame: delay + 4, value: new Vector3(1.5, 1.5, 1.5) },
        { frame: delay + 10, value: new Vector3(2.0, 0.5, 2.0) },
      ])
      halo.animations.push(haloScale)

      const haloFade = new Animation('haloFade', 'visibility', 60, Animation.ANIMATIONTYPE_FLOAT)
      haloFade.setKeys([
        { frame: delay + 0, value: 0.5 },
        { frame: delay + 4, value: 0.3 },
        { frame: delay + 10, value: 0 },
      ])
      halo.animations.push(haloFade)
      scene.beginAnimation(halo, 0, delay + 14, false)

      // Scorch fades slowly
      const scorchFade = new Animation('scorchFade', 'visibility', 60, Animation.ANIMATIONTYPE_FLOAT)
      scorchFade.setKeys([
        { frame: 0, value: 0 },
        { frame: 5, value: 0.7 },
        { frame: 40, value: 0.3 },
        { frame: 60, value: 0 },
      ])
      scorch.animations.push(scorchFade)
      scene.beginAnimation(scorch, 0, 60, false)

      // Destroy destructible blocks
      if (grid[y][x] === 'destructible') {
        grid[y][x] = 'empty'
        const key = `${x},${y}`
        const destructibleMesh = destructibleMeshes.get(key)
        if (destructibleMesh) {
          destructibleMesh.dispose()
          destructibleMeshes.delete(key)
        }
        statsManager.recordBlockDestroyed()
        sessionBlocksDestroyed++
        
        // Check demolition achievement
        if (sessionBlocksDestroyed >= 50) {
          if (achievementsManager.unlock('demolition')) {
            showAchievementNotification(achievementsManager.getAchievement('demolition')!)
          }
        }

        // Chance to spawn power-up (affected by difficulty)
        if (Math.random() < difficultyConfig.powerUpDropRate) {
          const rand = Math.random()
          let powerUpType: PowerUpType
          
          if (settings.extendedPowerUps) {
            // Extended pool: 10 power-up types
            if (rand < 0.16) {
              powerUpType = 'extraBomb'     // 16%
            } else if (rand < 0.36) {
              powerUpType = 'largerBlast'   // 20%
            } else if (rand < 0.44) {
              powerUpType = 'kick'          // 8%
            } else if (rand < 0.49) {
              powerUpType = 'throw'         // 8%
            } else if (rand < 0.59) {
              powerUpType = 'speed'         // 10%
            } else if (rand < 0.69) {
              powerUpType = 'shield'        // 10%
            } else if (rand < 0.77) {
              powerUpType = 'pierce'        // 8%
            } else if (rand < 0.85) {
              powerUpType = 'ghost'         // 8%
            } else if (rand < 0.93) {
              powerUpType = 'powerBomb'     // 8%
            } else {
              powerUpType = 'lineBomb'      // 7%
            }
          } else {
            // Classic pool: 5 power-up types
            if (rand < 0.30) {
              powerUpType = 'extraBomb'  // 30%
            } else if (rand < 0.65) {
              powerUpType = 'largerBlast'  // 35%
            } else if (rand < 0.75) {
              powerUpType = 'kick'  // 10%
            } else if (rand < 0.85) {
              powerUpType = 'throw'  // 10%
            } else {
              powerUpType = 'speed'  // 15%
            }
          }
          
          // Create emoji plane (material is cached per type)
          const pos = gridToWorld(x, y)
          const emojiPlane = MeshBuilder.CreatePlane('powerup-emoji', { 
            size: TILE_SIZE * 0.8  // Increased size from 0.6
          }, scene)
          emojiPlane.position.x = pos.x
          emojiPlane.position.y = TILE_SIZE * 0.5
          emojiPlane.position.z = pos.z
          emojiPlane.billboardMode = 7 // Always face camera
          emojiPlane.material = getPowerUpMaterial(powerUpType)
          
          // Floating animation - Removed duplicate animation code
          const powerUpSphere = emojiPlane
          
          // Add bobbing animation
          let bobTime = Math.random() * Math.PI * 2
          const bobObserver = scene.onBeforeRenderObservable.add(() => {
            if (powerUpSphere && !powerUpSphere.isDisposed()) {
              bobTime += 0.05
              // Bob higher
              powerUpSphere.position.y = TILE_SIZE * 0.5 + Math.sin(bobTime) * 0.15
            }
          })
          
          // Clean up observer when power-up is disposed
          powerUpSphere.onDisposeObservable.add(() => {
            scene.onBeforeRenderObservable.remove(bobObserver)
          })
          
          powerUps.push({ x, y, type: powerUpType, mesh: powerUpSphere })
        }
      }

      // Check if player is hit
      if (x === playerGridX && y === playerGridY && !playerInvulnerable) {
        // Shield absorbs the hit
        if (shieldCharges > 0) {
          shieldCharges--
          playerInvulnerable = true
          playerInvulnerableTimer = 1000 // Shorter invuln after shield break
          if (soundManager) soundManager.playSFX('powerup')
          haptic([40, 20, 40])
          const playerPos = gridToWorld(playerGridX, playerGridY)
          showHitIndicator(playerPos, scene, false)
          console.log('Shield absorbed hit! Charges remaining:', shieldCharges)
          updateUI()
        } else {
        playerLives--
        playerInvulnerable = true
        playerInvulnerableTimer = 2000 // 2 seconds invulnerability
        sessionDamageTaken++
        
        // Play death/hit sound
        if (soundManager) soundManager.playSFX('death')
        haptic([50, 30, 80])
        
        // Show hit indicator
        const playerPos = gridToWorld(playerGridX, playerGridY)
        showHitIndicator(playerPos, scene, true)
        
        console.log('Player hit! Lives remaining:', playerLives)
        
        if (playerLives <= 0) {
          gameOver = true
          if (soundManager) soundManager.stopMusic()
          statsManager.recordLoss()
          statsManager.recordDeath()
          if (gameMode === 'survival') {
            statsManager.recordSurvivalScore(survivalWave, survivalScore)
          }
          if (soundManager) soundManager.playSFX('defeat')
          console.log('Game Over! You were defeated!')
        } else {
          statsManager.recordDeath()
        }
        updateUI()
        } // end of shield else
      }

      // Check if any enemy is hit
      enemies.forEach((enemy, idx) => {
        if (x === enemy.x && y === enemy.y && !enemy.invulnerable && enemy.lives > 0) {
          enemy.lives--
          enemy.invulnerable = true
          enemy.invulnerableTimer = 2000
          
          // Show hit indicator
          const enemyPos = gridToWorld(enemy.x, enemy.y)
          showHitIndicator(enemyPos, scene, false)
          
          console.log(`Enemy ${idx + 1} hit! Lives remaining:`, enemy.lives)
          
          if (enemy.lives <= 0) {
            enemy.mesh.dispose()
            console.log(`Enemy ${idx + 1} destroyed!`)
            statsManager.recordEnemyDefeated()
            sessionEnemiesDefeated++
            
            // Check first blood achievement
            if (achievementsManager.unlock('first-blood')) {
              showAchievementNotification(achievementsManager.getAchievement('first-blood')!)
            }
            
            // Add bonus time in time attack mode
            if (gameMode === 'time-attack') {
              gameStateManager.addBonusTime()
              console.log('+5 seconds bonus time!')
            }
            
            // Check if all enemies are dead
            const allEnemiesDead = enemies.every(e => e.lives <= 0)
            if (allEnemiesDead && gameMode !== 'pvp') {
              if (gameMode === 'survival') {
                // Spawn next wave
                survivalWave++
                survivalScore += 100 * survivalWave
                const enemiesToSpawn = Math.min(survivalWave, 4) // Max 4 enemies
                
                for (let i = 0; i < enemiesToSpawn; i++) {
                  const spawn = enemySpawns[i % enemySpawns.length]
                  // Use same distinct colors for survival waves
                  const enemyColors = ['#ffffff', '#8d6e63', '#b91c1c']
                  const enemyMesh = createPlayerSprite(`enemy-wave${survivalWave}-${i}`, null, enemyEmojis[i % 3], enemyColors[i % 3])
                  const enemyPos = gridToWorld(spawn.x, spawn.y)
                  const enemy: Enemy = {
                    x: spawn.x,
                    y: spawn.y,
                    mesh: enemyMesh,
                    moveTimer: Math.random() * 400,
                    lives: difficultyConfig.enemyStartingLives + Math.floor(survivalWave / 3), // Increase health every 3 waves
                    invulnerable: false,
                    invulnerableTimer: 0,
                    visualX: enemyPos.x,
                    visualZ: enemyPos.z,
                  }
                  enemy.mesh.position.x = enemyPos.x
                  enemy.mesh.position.y = TILE_SIZE * 0.5
                  enemy.mesh.position.z = enemyPos.z
                  ;(enemy.mesh as any)._cachedChildMeshes = enemy.mesh.getChildMeshes()
                  enemies.push(enemy)
                  
                  // Add stats for new enemy
                  enemyStats.push({
                    maxBombs: 1,
                    currentBombs: 0,
                    blastRadius: 2,
                  })
                }
                
                console.log(`Wave ${survivalWave} incoming! ${enemiesToSpawn} enemies!`)
                if (soundManager) soundManager.playSFX('powerup')
                
                // Check survival achievements
                if (survivalWave >= 5) {
                  if (achievementsManager.unlock('survivor-5')) {
                    showAchievementNotification(achievementsManager.getAchievement('survivor-5')!)
                  }
                }
                if (survivalWave >= 10) {
                  if (achievementsManager.unlock('survivor-10')) {
                    showAchievementNotification(achievementsManager.getAchievement('survivor-10')!)
                  }
                }
              } else {
                gameWon = true
                gameOver = true
                if (soundManager) soundManager.stopMusic()
                statsManager.recordWin()
                
                // Check achievements on win
                if (sessionDamageTaken === 0) {
                  if (achievementsManager.unlock('untouchable')) {
                    showAchievementNotification(achievementsManager.getAchievement('untouchable')!)
                  }
                }
                
                if (sessionEnemiesDefeated >= 3) {
                  if (achievementsManager.unlock('triple-threat')) {
                    showAchievementNotification(achievementsManager.getAchievement('triple-threat')!)
                  }
                }
                
                // Check win streak
                const stats = statsManager.getStats()
                if (stats.currentWinStreak >= 3) {
                  if (achievementsManager.unlock('win-streak-3')) {
                    showAchievementNotification(achievementsManager.getAchievement('win-streak-3')!)
                  }
                }
                
                // Check time attack achievement (2+ minutes remaining = 120000ms)
                if (gameMode === 'time-attack') {
                  const timeAttackState = gameStateManager.getTimeAttackState()
                  if (timeAttackState && timeAttackState.timeRemaining >= 120000) {
                    if (achievementsManager.unlock('speed-demon')) {
                      showAchievementNotification(achievementsManager.getAchievement('speed-demon')!)
                    }
                  }
                }
                
                if (soundManager) soundManager.playSFX('victory')
                console.log('You Win! All enemies destroyed!')
              }
            }
          }
          updateUI()
        }
      })

      // Check if player 2 is hit (PvP mode)
      if (gameMode === 'pvp' && x === player2GridX && y === player2GridY && !player2Invulnerable) {
        if (player2ShieldCharges > 0) {
          player2ShieldCharges--
          player2Invulnerable = true
          player2InvulnerableTimer = 1000
          if (soundManager) soundManager.playSFX('powerup')
          haptic([40, 20, 40])
          console.log('Player 2 shield absorbed hit! Charges:', player2ShieldCharges)
          updateUI()
        } else {
        player2Lives--
        player2Invulnerable = true
        player2InvulnerableTimer = 2000
        
        // Play death/hit sound
        if (soundManager) soundManager.playSFX('death')
        haptic([50, 30, 80])
        
        // Show hit indicator
        const player2Pos = gridToWorld(player2GridX, player2GridY)
        showHitIndicator(player2Pos, scene, true)
        
        console.log('Player 2 hit! Lives remaining:', player2Lives)
        
        if (player2Lives <= 0) {
          player2.dispose()
          console.log('Player 1 Wins!')
          gameWon = true
          gameOver = true
          if (soundManager) soundManager.stopMusic()
          statsManager.recordWin()
          if (soundManager) soundManager.playSFX('victory')
        }
        updateUI()
        } // end of shield else
      }
    }

    // Remove explosion visuals after animation finishes
    // Compute cleanup time: max of fireball/halo stagger + 24 frames, and scorch 60 frames
    const maxDelay = (explosionTiles.length - 1) * 0.8
    const fireballEndMs = Math.ceil(((maxDelay + 24) / 60) * 1000)
    const scorchEndMs = 1000 // scorch animation runs to frame 60 at 60fps
    const cleanupMs = Math.max(fireballEndMs, scorchEndMs) + 100
    setTimeout(() => {
      if (scene.isDisposed) return
      explosionMeshes.forEach(mesh => {
        if (!mesh.isDisposed()) mesh.dispose()
      })
    }, cleanupMs)

    // Chain reaction: explode other bombs
    let triggeredChain = false
    bombs.forEach(otherBomb => {
      if (otherBomb !== bomb) {
        for (const [x, y] of explosionTiles) {
          if (otherBomb.x === x && otherBomb.y === y) {
            otherBomb.timer = 0
            triggeredChain = true
          }
        }
      }
    })
    
    // Track chain reactions for achievement
    if (triggeredChain) {
      chainReactionCount++
      // Reset the timer - chain ends when no more bombs explode within 500ms
      if (chainReactionTimer) clearTimeout(chainReactionTimer)
      chainReactionTimer = setTimeout(() => {
        if (chainReactionCount >= 3) {
          if (achievementsManager.unlock('chain-reaction')) {
            showAchievementNotification(achievementsManager.getAchievement('chain-reaction')!)
          }
        }
        chainReactionCount = 0
        chainReactionTimer = null
      }, 500)
    }
  }

  // Update bombs
  function updateBombs(deltaTime: number) {
    const now = Date.now()
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bomb = bombs[i]
      bomb.timer -= deltaTime

      const timeRatio = bomb.timer / 2000
      const urgency = 1 - timeRatio // 0 → 1 as bomb nears detonation

      // ── Pulse: faster & stronger as timer runs out ──
      const pulseSpeed = 5 + urgency * 25
      const pulseAmp = 0.06 + urgency * 0.22
      const pulse = 1 + Math.sin(now * pulseSpeed / 1000) * pulseAmp
      bomb.mesh.scaling.copyFromFloats(pulse, pulse * (1 + urgency * 0.08), pulse)

      // ── Body glow: ramp from dark to angry red/orange ──
      if (bomb.mesh.material && bomb.mesh.material !== sharedBombMat) {
        // power-bomb or already-cloned material – animate glow
        if (urgency > 0.4) {
          const i2 = (urgency - 0.4) / 0.6
          bomb.mesh.material.emissiveColor.copyFromFloats(
            Math.min(1, i2 * 0.9 + (bomb.mesh.material.emissiveColor.r > 0.3 ? 0.4 : 0)),
            i2 * 0.15 + (bomb.mesh.material.emissiveColor.g > 0.2 ? 0.15 : 0),
            0
          )
        }
      } else if (bomb.mesh.material) {
        if (urgency > 0.4) {
          const i2 = (urgency - 0.4) / 0.6
          // Clone material once to avoid tinting all bombs the same
          if (bomb.mesh.material === sharedBombMat) {
            const m = sharedBombMat.clone('bomb-mat-' + i)!
            bomb.mesh.material = m
          }
          bomb.mesh.material.emissiveColor.copyFromFloats(i2 * 0.9, i2 * 0.15, 0)
        }
      }

      // ── Spark flicker: use cached ref ──
      const spark = (bomb as any)._spark
      if (spark) {
        const f = 0.6 + Math.random() * 0.4
        const s = 0.7 + Math.random() * 0.6
        spark.scaling.copyFromFloats(s, s, s)
        if (spark.material && spark.material !== sharedSparkMat) {
          spark.material.emissiveColor.copyFromFloats(f, f * 0.55, f * 0.1)
        } else if (spark.material) {
          // Clone once
          const sm = sharedSparkMat.clone('spark-live-' + i)!
          spark.material = sm
          sm.emissiveColor.copyFromFloats(f, f * 0.55, f * 0.1)
        }
      }

      // ── Danger ring: use cached ref ──
      const dangerRing = (bomb as any)._dangerRing
      if (dangerRing) {
        if (urgency > 0.6) {
          const dp = (urgency - 0.6) / 0.4 // 0→1
          const ringScale = 1 + dp * 1.5
          dangerRing.scaling.copyFromFloats(ringScale, ringScale, ringScale)
          if (dangerRing.material && dangerRing.material !== sharedDangerMat) {
            dangerRing.material.alpha = dp * 0.6 * (0.5 + 0.5 * Math.sin(now * 0.012))
          } else if (dangerRing.material) {
            const dm = sharedDangerMat.clone('danger-live-' + i)!
            dangerRing.material = dm
            dm.alpha = dp * 0.6
          }
        }
      }

      // ── Slight wobble for personality ── 
      bomb.mesh.rotation.z = Math.sin(now * 0.008 + i) * urgency * 0.12
      bomb.mesh.rotation.x = Math.cos(now * 0.006 + i) * urgency * 0.08

      if (bomb.timer <= 0) {
        explodeBomb(bomb)
        // Dispose cloned materials to prevent memory leaks
        // Dispose cloned body material
        if (bomb.mesh.material && bomb.mesh.material !== sharedBombMat) bomb.mesh.material.dispose()
        bomb.mesh.getChildMeshes().forEach((child: any) => {
          if (child.material && child.material !== sharedBombMat && child.material !== sharedFuseMat && child.material !== sharedRivetMat && child.material !== sharedSparkMat && child.material !== sharedDangerMat) {
            child.material.dispose()
          }
          child.dispose()
        })
        bomb.mesh.dispose()
        
        // Decrement the correct owner's bomb count
        if (bomb.ownerId === -1) {
          currentBombs--
        } else if (bomb.ownerId === -2) {
          player2CurrentBombs--
        } else if (bomb.ownerId !== undefined && bomb.ownerId >= 0 && enemyStats[bomb.ownerId]) {
          enemyStats[bomb.ownerId].currentBombs--
        }
        
        bombs.splice(i, 1)
      }
    }
  }

  // Update invulnerability
  function updateInvulnerability(deltaTime: number) {
    // Player 1
    if (playerInvulnerable) {
      playerInvulnerableTimer -= deltaTime
      setCharacterVisibility(player, Math.sin(Date.now() / 100) > 0 ? 0.5 : 1)
      
      if (playerInvulnerableTimer <= 0) {
        playerInvulnerable = false
        setCharacterVisibility(player, 1)
      }
    }

    // Player 2 (PvP mode)
    if (gameMode === 'pvp' && player2Invulnerable && player2) {
      player2InvulnerableTimer -= deltaTime
      setCharacterVisibility(player2, Math.sin(Date.now() / 100) > 0 ? 0.5 : 1)
      
      if (player2InvulnerableTimer <= 0) {
        player2Invulnerable = false
        setCharacterVisibility(player2, 1)
      }
    }

    // Enemies
    enemies.forEach(enemy => {
      if (enemy.invulnerable) {
        enemy.invulnerableTimer -= deltaTime
        setCharacterVisibility(enemy.mesh, Math.sin(Date.now() / 100) > 0 ? 0.5 : 1)
        
        if (enemy.invulnerableTimer <= 0) {
          enemy.invulnerable = false
          setCharacterVisibility(enemy.mesh, 1)
        }
      }
    })

    // Ghost mode timers
    if (ghostTimer > 0) {
      ghostTimer -= deltaTime
      // Visual: ghostly flicker
      setCharacterVisibility(player, 0.5 + Math.sin(Date.now() / 150) * 0.2)
      if (ghostTimer <= 0) {
        ghostTimer = 0
        setCharacterVisibility(player, playerInvulnerable ? 0.5 : 1)
        console.log('Player 1: Ghost mode expired!')
      }
    }
    if (player2GhostTimer > 0) {
      player2GhostTimer -= deltaTime
      if (player2) setCharacterVisibility(player2, 0.5 + Math.sin(Date.now() / 150) * 0.2)
      if (player2GhostTimer <= 0) {
        player2GhostTimer = 0
        if (player2) setCharacterVisibility(player2, player2Invulnerable ? 0.5 : 1)
        console.log('Player 2: Ghost mode expired!')
      }
    }
  }

  // Smart AI for enemies
  function updateEnemies(deltaTime: number) {
    if (gameOver) return

    enemies.forEach((enemy, enemyIdx) => {
      if (enemy.lives <= 0) return

      enemy.moveTimer -= deltaTime
      if (enemy.moveTimer <= 0) {
        enemy.moveTimer = difficultyConfig.aiMoveSpeed

        const directions = [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]
        
        // Get bomb data for AI calculations
        const bombData = bombs.map(b => ({ x: b.x, y: b.y, blastRadius: b.blastRadius }))
        
        // PRIORITY 1: If in danger, ESCAPE is the ONLY priority!
        const currentlyInDanger = !isPositionSafe(enemy.x, enemy.y, grid, bombData)
        
        if (currentlyInDanger) {
          // Use BFS to find the best escape direction
          const escapeDir = getEscapeDirection(enemy.x, enemy.y, grid, GRID_WIDTH, GRID_HEIGHT, bombData)
          
          if (escapeDir) {
            const newX = enemy.x + escapeDir.dx
            const newY = enemy.y + escapeDir.dy
            
            // Verify the move is actually valid (double-check)
            if (newX >= 0 && newY >= 0 && newX < GRID_WIDTH && newY < GRID_HEIGHT &&
                grid[newY][newX] === 'empty' && !bombs.some(b => b.x === newX && b.y === newY) &&
                !(newX === playerGridX && newY === playerGridY) &&
                !(gameMode === 'pvp' && newX === player2GridX && newY === player2GridY) &&
                !enemies.some((e, i) => i !== enemyIdx && e.lives > 0 && e.x === newX && e.y === newY)) {
              enemy.x = newX
              enemy.y = newY
              const enemyNewPos = gridToWorld(enemy.x, enemy.y)
              enemy.mesh.position.x = enemyNewPos.x
              enemy.mesh.position.y = TILE_SIZE * 0.5
              enemy.mesh.position.z = enemyNewPos.z

              const dx = escapeDir.dx
              const dy = escapeDir.dy
              if ((enemy.mesh as any).playAnimation) {
                if (dx < 0) (enemy.mesh as any).playAnimation('walk-up')
                else if (dx > 0) (enemy.mesh as any).playAnimation('walk-down')
                else if (dy < 0) (enemy.mesh as any).playAnimation('walk-left')
                else if (dy > 0) (enemy.mesh as any).playAnimation('walk-right')
              }
            }
          } else {
            // No calculated escape - try any walkable tile
            for (const [dx, dy] of directions) {
              const newX = enemy.x + dx
              const newY = enemy.y + dy
              if (newX >= 0 && newY >= 0 && newX < GRID_WIDTH && newY < GRID_HEIGHT &&
                  grid[newY][newX] === 'empty' && !bombs.some(b => b.x === newX && b.y === newY) && 
                  !(newX === playerGridX && newY === playerGridY) &&
                  !(gameMode === 'pvp' && newX === player2GridX && newY === player2GridY) &&
                  !enemies.some((e, i) => i !== enemyIdx && e.lives > 0 && e.x === newX && e.y === newY)) {
                enemy.x = newX
                enemy.y = newY
                const enemyNewPos = gridToWorld(enemy.x, enemy.y)
                enemy.mesh.position.x = enemyNewPos.x
                enemy.mesh.position.y = TILE_SIZE * 0.5
                enemy.mesh.position.z = enemyNewPos.z
                
                if ((enemy.mesh as any).playAnimation) {
                  if (dx < 0) (enemy.mesh as any).playAnimation('walk-up')
                  else if (dx > 0) (enemy.mesh as any).playAnimation('walk-down')
                  else if (dy < 0) (enemy.mesh as any).playAnimation('walk-left')
                  else if (dy > 0) (enemy.mesh as any).playAnimation('walk-right')
                }
                break
              }
            }
          }
        } else {
          // PRIORITY 2: Not in danger - use normal movement AI
          // Only consider moves that are SAFE
          const moveOptions = directions.map(([dx, dy]) => {
            const newX = enemy.x + dx
            const newY = enemy.y + dy
            
            // Check if move is valid
            if (newX < 0 || newY < 0 || newX >= GRID_WIDTH || newY >= GRID_HEIGHT) {
              return { dx, dy, score: -Infinity, isSafe: false }
            }
            
            const tile = grid[newY][newX]
            if (tile === 'wall' || tile === 'destructible') {
              return { dx, dy, score: -Infinity, isSafe: false }
            }
            
            // Check if there's a bomb at the target
            if (bombs.some(b => b.x === newX && b.y === newY)) {
              return { dx, dy, score: -Infinity, isSafe: false }
            }
            
            // Check collision with Players and other Enemies
            if ((newX === playerGridX && newY === playerGridY) ||
                (gameMode === 'pvp' && newX === player2GridX && newY === player2GridY) ||
                enemies.some((e, i) => i !== enemyIdx && e.lives > 0 && e.x === newX && e.y === newY)) {
              return { dx, dy, score: -Infinity, isSafe: false }
            }
            
            // CRITICAL: Check if destination is safe - NEVER move into danger!
            if (!isPositionSafe(newX, newY, grid, bombData)) {
              return { dx, dy, score: -Infinity, isSafe: false }
            }
            
            // This move is safe - now calculate its desirability
            let score = 100 // Base score for safe moves
            
            // Check for power-ups at this position
            const powerUpHere = powerUps.find(p => p.x === newX && p.y === newY)
            if (powerUpHere) {
              score += 200 // Prioritize power-ups
            }
            
            // Distance to player
            const distToPlayer = Math.abs(newX - playerGridX) + Math.abs(newY - playerGridY)
            const currentDistToPlayer = Math.abs(enemy.x - playerGridX) + Math.abs(enemy.y - playerGridY)
            
            // Reward getting closer to player based on difficulty
            if (distToPlayer < currentDistToPlayer) {
              switch (settings.difficulty) {
                case 'easy':
                  score += 20 // Less aggressive
                  break
                case 'medium':
                  score += 50
                  break
                case 'hard':
                  score += 100 // Very aggressive
                  break
              }
            }
            
            // Penalize moving away from player
            score -= distToPlayer * 3
            
            // Add some randomness
            score += Math.random() * 30
            
            return { dx, dy, score, isSafe: true }
          })
          
          // Filter to only safe moves
          const safeMoves = moveOptions.filter(m => m.isSafe)
          
          if (safeMoves.length > 0) {
            // Sort by score and pick the best safe move
            safeMoves.sort((a, b) => b.score - a.score)
            const bestMove = safeMoves[0]
            
            enemy.x += bestMove.dx
            enemy.y += bestMove.dy
            const enemyNewPos = gridToWorld(enemy.x, enemy.y)
            enemy.mesh.position.x = enemyNewPos.x
            enemy.mesh.position.y = TILE_SIZE * 0.5
            enemy.mesh.position.z = enemyNewPos.z

            const dx = bestMove.dx
            const dy = bestMove.dy
            if ((enemy.mesh as any).playAnimation) {
              if (dx < 0) (enemy.mesh as any).playAnimation('walk-up')
              else if (dx > 0) (enemy.mesh as any).playAnimation('walk-down')
              else if (dy < 0) (enemy.mesh as any).playAnimation('walk-left')
              else if (dy > 0) (enemy.mesh as any).playAnimation('walk-right')
            }
          }
          // If no safe moves available, stay in place (better than dying!)
        }

        // BOMB PLACEMENT - Only if not in danger and has bombs available
        if (!currentlyInDanger && enemyStats[enemyIdx].currentBombs < enemyStats[enemyIdx].maxBombs) {
          const decision = shouldAIPlaceBomb({
            enemyX: enemy.x,
            enemyY: enemy.y,
            playerX: playerGridX,
            playerY: playerGridY,
            grid,
            gridWidth: GRID_WIDTH,
            gridHeight: GRID_HEIGHT,
            bombs: bombData,
            blastRadius: enemyStats[enemyIdx].blastRadius,
            difficulty: settings.difficulty
          })
          
          if (decision.shouldPlace && decision.escapeDirection) {
            // Place the bomb
            placeBomb(enemy.x, enemy.y, enemyIdx, enemyStats[enemyIdx].blastRadius)
            enemyStats[enemyIdx].currentBombs++
            console.log(`💣 AI ${enemyIdx + 1}: ${decision.reason}`)
            
            // IMMEDIATELY move in escape direction (same tick!)
            const escapeX = enemy.x + decision.escapeDirection.dx
            const escapeY = enemy.y + decision.escapeDirection.dy
            
            // Verify escape move is valid
            if (escapeX >= 0 && escapeY >= 0 && escapeX < GRID_WIDTH && escapeY < GRID_HEIGHT &&
                grid[escapeY][escapeX] === 'empty' && 
                !bombs.some(b => b.x === escapeX && b.y === escapeY) &&
                !(escapeX === playerGridX && escapeY === playerGridY) &&
                !(gameMode === 'pvp' && escapeX === player2GridX && escapeY === player2GridY) &&
                !enemies.some((e, i) => i !== enemyIdx && e.lives > 0 && e.x === escapeX && e.y === escapeY)) {
              enemy.x = escapeX
              enemy.y = escapeY
              const enemyNewPos = gridToWorld(enemy.x, enemy.y)
              enemy.mesh.position.x = enemyNewPos.x
              enemy.mesh.position.y = TILE_SIZE * 0.5
              enemy.mesh.position.z = enemyNewPos.z
              
              const dx = decision.escapeDirection.dx
              const dy = decision.escapeDirection.dy
              if ((enemy.mesh as any).playAnimation) {
                if (dx < 0) (enemy.mesh as any).playAnimation('walk-up')
                else if (dx > 0) (enemy.mesh as any).playAnimation('walk-down')
                else if (dy < 0) (enemy.mesh as any).playAnimation('walk-left')
                else if (dy > 0) (enemy.mesh as any).playAnimation('walk-right')
              }
              console.log(`🏃 AI ${enemyIdx + 1} escaping immediately!`)
            }
          }
        }
        
        // Check for power-up collection
        for (let i = powerUps.length - 1; i >= 0; i--) {
          const powerUp = powerUps[i]
          if (powerUp.x === enemy.x && powerUp.y === enemy.y) {
            if (powerUp.type === 'extraBomb') {
              enemyStats[enemyIdx].maxBombs++
              console.log(`AI ${enemyIdx + 1} collected extra bomb! Max bombs:`, enemyStats[enemyIdx].maxBombs)
            } else if (powerUp.type === 'largerBlast') {
              enemyStats[enemyIdx].blastRadius++
              console.log(`AI ${enemyIdx + 1} collected larger blast! Blast radius:`, enemyStats[enemyIdx].blastRadius)
            }
            powerUp.mesh.dispose()
            powerUps.splice(i, 1)
            updateUI()
          }
        }
      }

      // Enemies don't damage on collision - they must use bombs!
    })
  }

  // Check power-up collection
  function checkPowerUps() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const powerUp = powerUps[i]
      
      // Player 1 collection
      if (powerUp.x === playerGridX && powerUp.y === playerGridY) {
        if (powerUp.type === 'extraBomb') {
          maxBombs++
          console.log('Player 1: Extra bomb! Max bombs:', maxBombs)
        } else if (powerUp.type === 'largerBlast') {
          blastRadius++
          console.log('Player 1: Larger blast! Blast radius:', blastRadius)
        } else if (powerUp.type === 'kick') {
          hasKick = true
          console.log('Player 1: Kick ability acquired!')
        } else if (powerUp.type === 'throw') {
          hasThrow = true
          console.log('Player 1: Throw ability acquired!')
        } else if (powerUp.type === 'speed') {
          playerSpeed++
          moveDelay = Math.max(50, 150 - (playerSpeed - 1) * 30)
          console.log('Player 1: Speed increased! Speed:', playerSpeed)
        } else if (powerUp.type === 'shield') {
          shieldCharges = Math.min(3, shieldCharges + 1)
          console.log('Player 1: Shield! Charges:', shieldCharges)
        } else if (powerUp.type === 'pierce') {
          hasPierce = true
          console.log('Player 1: Pierce ability acquired! Blasts pass through blocks!')
        } else if (powerUp.type === 'ghost') {
          ghostTimer = 8000 // 8 seconds
          console.log('Player 1: Ghost mode activated! Walk through blocks for 8s!')
        } else if (powerUp.type === 'powerBomb') {
          powerBombCharges++
          console.log('Player 1: Power Bomb! Charges:', powerBombCharges)
        } else if (powerUp.type === 'lineBomb') {
          hasLineBomb = true
          console.log('Player 1: Line Bomb ability acquired!')
        }
        powerUp.mesh.dispose()
        powerUps.splice(i, 1)
        updateUI()
        
        // Play sound and track stats
        if (soundManager) soundManager.playSFX('powerup')
        haptic(35)
        statsManager.recordPowerUpCollected()
        statsManager.recordBlastRadius(blastRadius)
        statsManager.recordBombCount(maxBombs)
        sessionPowerUpsCollected++
        sessionPowerUpTypes.add(powerUp.type)
        
        // Check collector achievement (all 5 types in one game)
        if (sessionPowerUpTypes.size >= 5) {
          if (achievementsManager.unlock('collector')) {
            showAchievementNotification(achievementsManager.getAchievement('collector')!)
          }
        }
        
        // Check power hungry achievement (10 power-ups in one game)
        if (sessionPowerUpsCollected >= 10) {
          if (achievementsManager.unlock('power-hungry')) {
            showAchievementNotification(achievementsManager.getAchievement('power-hungry')!)
          }
        }
        continue
      }
      
      // Player 2 collection (PvP mode)
      if (gameMode === 'pvp' && powerUp.x === player2GridX && powerUp.y === player2GridY) {
        if (powerUp.type === 'extraBomb') {
          player2MaxBombs++
          console.log('Player 2: Extra bomb! Max bombs:', player2MaxBombs)
        } else if (powerUp.type === 'largerBlast') {
          player2BlastRadius++
          console.log('Player 2: Larger blast! Blast radius:', player2BlastRadius)
        } else if (powerUp.type === 'kick') {
          player2HasKick = true
          console.log('Player 2: Kick ability acquired!')
        } else if (powerUp.type === 'throw') {
          player2HasThrow = true
          console.log('Player 2: Throw ability acquired!')
        } else if (powerUp.type === 'speed') {
          player2Speed++
          player2MoveDelay = Math.max(50, 150 - (player2Speed - 1) * 30)
          console.log('Player 2: Speed increased! Speed:', player2Speed)
        } else if (powerUp.type === 'shield') {
          player2ShieldCharges = Math.min(3, player2ShieldCharges + 1)
          console.log('Player 2: Shield! Charges:', player2ShieldCharges)
        } else if (powerUp.type === 'pierce') {
          player2HasPierce = true
          console.log('Player 2: Pierce ability acquired!')
        } else if (powerUp.type === 'ghost') {
          player2GhostTimer = 8000
          console.log('Player 2: Ghost mode activated!')
        } else if (powerUp.type === 'powerBomb') {
          player2PowerBombCharges++
          console.log('Player 2: Power Bomb! Charges:', player2PowerBombCharges)
        } else if (powerUp.type === 'lineBomb') {
          player2HasLineBomb = true
          console.log('Player 2: Line Bomb ability acquired!')
        }
        powerUp.mesh.dispose()
        powerUps.splice(i, 1)
        updateUI()
      }
    }
  }

  // Kick bomb function
  function kickBomb(dx: number, dy: number) {
    if (!hasKick) return false
    
    // Check if there's a bomb in the direction we're moving
    const bombAtTarget = bombs.find(b => b.x === playerGridX + dx && b.y === playerGridY + dy)
    if (!bombAtTarget) return false

    // Find the nearest obstacle in the kick direction
    let kickDistance = 1
    while (true) {
      const checkX = bombAtTarget.x + dx * kickDistance
      const checkY = bombAtTarget.y + dy * kickDistance

      // Stop if out of bounds
      if (checkX < 0 || checkY < 0 || checkX >= GRID_WIDTH || checkY >= GRID_HEIGHT) {
        kickDistance--
        break
      }

      // Stop if we hit a wall or destructible block
      if (grid[checkY][checkX] === 'wall' || grid[checkY][checkX] === 'destructible') {
        kickDistance--
        break
      }

      // Stop if there's another bomb
      if (bombs.some(b => b !== bombAtTarget && b.x === checkX && b.y === checkY)) {
        kickDistance--
        break
      }

      kickDistance++
    }

    // Move the bomb to the new position
    if (kickDistance > 0) {
      bombAtTarget.x += dx * kickDistance
      bombAtTarget.y += dy * kickDistance
      
      // Play kick sound
      if (soundManager) soundManager.playSFX('kick')
      haptic(30)
      
      // Animate the bomb movement
      const targetPos = gridToWorld(bombAtTarget.x, bombAtTarget.y)
      const moveAnim = new Animation('moveAnim', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3)
      moveAnim.setKeys([
        { frame: 0, value: bombAtTarget.mesh.position.clone() },
        { frame: 10, value: targetPos },
      ])
      bombAtTarget.mesh.animations.push(moveAnim)
      scene.beginAnimation(bombAtTarget.mesh, 0, 10, false)
      
      console.log(`Kicked bomb ${kickDistance} tiles!`)
      return true
    }
    return false
  }

  // Throw bomb function
  function throwBomb(dx: number, dy: number) {
    if (!hasThrow) return false
    
    // Check if there's a bomb at player position
    const bombAtPlayer = bombs.find(b => b.x === playerGridX && b.y === playerGridY)
    if (!bombAtPlayer) return false

    // Throw distance is 3 tiles - bomb flies over obstacles and lands on the other side
    const throwDistance = 3
    let finalX = playerGridX
    let finalY = playerGridY

    // Check from farthest to nearest to find valid landing spot (skipping over obstacles)
    for (let i = throwDistance; i >= 1; i--) {
      const checkX = playerGridX + dx * i
      const checkY = playerGridY + dy * i

      // Skip if out of bounds
      if (checkX < 0 || checkY < 0 || checkX >= GRID_WIDTH || checkY >= GRID_HEIGHT) {
        continue
      }

      // Skip if it's a wall or destructible block (can't land there)
      if (grid[checkY][checkX] === 'wall' || grid[checkY][checkX] === 'destructible') {
        continue
      }

      // Skip if there's another bomb
      if (bombs.some(b => b !== bombAtPlayer && b.x === checkX && b.y === checkY)) {
        continue
      }

      // Found a valid spot!
      finalX = checkX
      finalY = checkY
      break
    }

    // Move the bomb to the new position
    if (finalX !== playerGridX || finalY !== playerGridY) {
      bombAtPlayer.x = finalX
      bombAtPlayer.y = finalY
      
      // Play throw sound
      if (soundManager) soundManager.playSFX('throw')
      haptic(30)
      
      // Animate the bomb movement (faster than kick)
      const targetPos = gridToWorld(bombAtPlayer.x, bombAtPlayer.y)
      const moveAnim = new Animation('moveAnim', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3)
      moveAnim.setKeys([
        { frame: 0, value: bombAtPlayer.mesh.position.clone() },
        { frame: 8, value: targetPos },
      ])
      bombAtPlayer.mesh.animations.push(moveAnim)
      scene.beginAnimation(bombAtPlayer.mesh, 0, 8, false)
      
      console.log(`Threw bomb to (${finalX}, ${finalY})!`)
      return true
    }
    return false
  }

  // Track last movement direction for throw
  let lastDx = 0
  let lastDy = -1 // Default facing up

  // Player 2 bomb placement
  function placeBombPlayer2(x: number, y: number) {
    if (player2CurrentBombs >= player2MaxBombs) return
    
    // Check if there's already a bomb at this position
    if (bombs.some(b => b.x === x && b.y === y)) return

    const bombMesh = createBombMesh()
    bombMesh.position = gridToWorld(x, y)

    // Calculate blast radius (with Power Bomb bonus)
    let effectiveBlastRadius = player2BlastRadius
    if (player2PowerBombCharges > 0) {
      effectiveBlastRadius += 3
      player2PowerBombCharges--
      if (bombMesh.material) {
        const pbMat = (bombMesh.material as StandardMaterial).clone('power-bomb-p2-mat')!
        pbMat.emissiveColor = new Color3(1, 0.4, 0)
        bombMesh.material = pbMat
      }
      updateUI()
    }

    bombs.push({
      x,
      y,
      timer: 2200,
      mesh: bombMesh,
      blastRadius: effectiveBlastRadius,
      ownerId: -2,
    })
    cacheBombChildRefs(bombs[bombs.length - 1])
    player2CurrentBombs++
    if (player2 && (player2 as any).triggerSquash) (player2 as any).triggerSquash()
    
    // Play sound
    if (soundManager) soundManager.playSFX('bomb-place')
    haptic(25)
  }

  // Player 2 throw bomb
  function throwBombPlayer2(dx: number, dy: number) {
    if (!player2HasThrow) return false
    
    const bombAtPlayer = bombs.find(b => b.x === player2GridX && b.y === player2GridY)
    if (!bombAtPlayer) return false

    // Throw distance is 3 tiles - bomb flies over obstacles and lands on the other side
    const throwDistance = 3
    let finalX = player2GridX
    let finalY = player2GridY

    // Check from farthest to nearest to find valid landing spot (skipping over obstacles)
    for (let i = throwDistance; i >= 1; i--) {
      const checkX = player2GridX + dx * i
      const checkY = player2GridY + dy * i

      if (checkX < 0 || checkY < 0 || checkX >= GRID_WIDTH || checkY >= GRID_HEIGHT) continue
      if (grid[checkY][checkX] === 'wall' || grid[checkY][checkX] === 'destructible') continue
      if (bombs.some(b => b !== bombAtPlayer && b.x === checkX && b.y === checkY)) continue

      finalX = checkX
      finalY = checkY
      break
    }

    if (finalX !== player2GridX || finalY !== player2GridY) {
      bombAtPlayer.x = finalX
      bombAtPlayer.y = finalY
      
      const targetPos = gridToWorld(bombAtPlayer.x, bombAtPlayer.y)
      const moveAnim = new Animation('moveAnim', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3)
      moveAnim.setKeys([
        { frame: 0, value: bombAtPlayer.mesh.position.clone() },
        { frame: 8, value: targetPos },
      ])
      bombAtPlayer.mesh.animations.push(moveAnim)
      scene.beginAnimation(bombAtPlayer.mesh, 0, 8, false)
      
      return true
    }
    return false
  }

  // Track which keys are currently held down for smooth movement
  const keysHeld: Set<string> = new Set()

  if (isMobile()) {
    // Clean up any existing mobile controls
    const existingControls = document.querySelector('.mobile-controls-container')
    if (existingControls) existingControls.remove()

    const mobileContainer = document.createElement('div')
    mobileContainer.className = 'mobile-controls-container mobile-controls-visible'
    document.body.appendChild(mobileContainer)

    // D-Pad with touch-slide support
    const dpad = document.createElement('div')
    dpad.className = 'dpad'
    mobileContainer.appendChild(dpad)

    // Track D-pad buttons for slide detection
    const dpadButtons: { btn: HTMLElement; key: string }[] = []
    let activeDpadKey: string | null = null

    const createBtn = (cls: string, key: string) => {
      const btn = document.createElement('div')
      btn.className = `dpad-btn ${cls}`
      dpad.appendChild(btn)
      dpadButtons.push({ btn, key })

      const activateKey = (k: string, b: HTMLElement) => {
        if (!keysHeld.has(k)) {
          keysHeld.add(k)
          keyPressTime.set(k, Date.now())
        }
        b.classList.add('active')
        activeDpadKey = k
      }
      const deactivateKey = (k: string, b: HTMLElement) => {
        keysHeld.delete(k)
        keyPressTime.delete(k)
        b.classList.remove('active')
        if (activeDpadKey === k) activeDpadKey = null
      }

      const start = (e: Event) => {
        if (e.cancelable) e.preventDefault()
        // Deactivate any other dpad button first
        dpadButtons.forEach(({ btn: ob, key: ok }) => {
          if (ok !== key) deactivateKey(ok, ob)
        })
        activateKey(key, btn)
      }
      const end = (e: Event) => {
        if (e.cancelable) e.preventDefault()
        deactivateKey(key, btn)
      }

      btn.addEventListener('touchstart', start, {passive: false})
      btn.addEventListener('touchend', end, {passive: false})
      btn.addEventListener('touchcancel', end, {passive: false})
      btn.addEventListener('mousedown', start)
      btn.addEventListener('mouseup', end)
      btn.addEventListener('mouseleave', end)
    }

    createBtn('dpad-up', 'w')
    createBtn('dpad-down', 's')
    createBtn('dpad-left', 'a')
    createBtn('dpad-right', 'd')

    // Handle touch-slide across D-pad buttons
    dpad.addEventListener('touchmove', (e) => {
      if (e.cancelable) e.preventDefault()
      const touch = e.touches[0]
      if (!touch) return
      const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (!el) return

      for (const { btn, key } of dpadButtons) {
        if (el === btn || btn.contains(el)) {
          if (activeDpadKey !== key) {
            // Deactivate old button, activate new one
            dpadButtons.forEach(({ btn: ob, key: ok }) => {
              if (ok !== key) { keysHeld.delete(ok); keyPressTime.delete(ok); ob.classList.remove('active') }
            })
            keysHeld.add(key)
            keyPressTime.set(key, Date.now())
            btn.classList.add('active')
            activeDpadKey = key
          }
          return
        }
      }
    }, { passive: false })

    // Safety: clear all D-pad keys if touch ends outside any button (ghost key prevention)
    dpad.addEventListener('touchend', () => {
      dpadButtons.forEach(({ btn: ob, key: ok }) => {
        keysHeld.delete(ok); keyPressTime.delete(ok); ob.classList.remove('active')
      })
      activeDpadKey = null
    }, { passive: false })
    dpad.addEventListener('touchcancel', () => {
      dpadButtons.forEach(({ btn: ob, key: ok }) => {
        keysHeld.delete(ok); keyPressTime.delete(ok); ob.classList.remove('active')
      })
      activeDpadKey = null
    }, { passive: false })

    // Action Button
    const actionContainer = document.createElement('div')
    actionContainer.className = 'action-btn-container'
    mobileContainer.appendChild(actionContainer)

    const actionBtn = document.createElement('div')
    actionBtn.className = 'action-btn'
    actionBtn.textContent = 'BOMB'
    actionContainer.appendChild(actionBtn)

    const performAction = (e: Event) => {
      if (e.cancelable) e.preventDefault()
      actionBtn.classList.add('active')
      
      if (gameOver || isPaused) return

      const bombAtPlayer = bombs.find(b => b.x === playerGridX && b.y === playerGridY)
      if (bombAtPlayer && hasThrow) {
        throwBomb(lastDx, lastDy)
      } else if (hasLineBomb && currentBombs < maxBombs) {
        placeLineBomb(playerGridX, playerGridY, lastDx, lastDy, -1)
      } else {
        placeBomb(playerGridX, playerGridY)
      }
    }
    
    const endAction = (e: Event) => {
       if (e.cancelable) e.preventDefault()
       actionBtn.classList.remove('active')
    }

    actionBtn.addEventListener('touchstart', performAction, {passive: false})
    actionBtn.addEventListener('touchend', endAction, {passive: false})
    actionBtn.addEventListener('mousedown', performAction)
    actionBtn.addEventListener('mouseup', endAction)
    actionBtn.addEventListener('mouseleave', endAction)

    // Handle resizing to toggle controls visibility
    const mobileResizeHandler = () => {
      const isStillMobile = isMobile()
      const pauseBtn = document.getElementById('mobile-pause-btn')

      if (isStillMobile) {
        mobileContainer.classList.add('mobile-controls-visible')
        if (pauseBtn) pauseBtn.style.display = 'flex'
      } else {
        mobileContainer.classList.remove('mobile-controls-visible')
        if (pauseBtn) pauseBtn.style.display = 'none'
      }
    }
    window.addEventListener('resize', mobileResizeHandler)
    scene.onDisposeObservable.add(() => {
      window.removeEventListener('resize', mobileResizeHandler)
    })
  }

  
  // Movement function that can be called repeatedly
  function movePlayer1(dx: number, dy: number, currentTime: number): boolean {
    // Check arrow keys or WASD
    
    // Check if initial delay has passed (tap vs hold)
    // If movement is triggered less than REPEAT_DELAY after press, it's the INITIAL move.
    // If it's been held longer, we use normal moveDelay.
    
    // However, processHeldKeys calls this repeatedly.
    // We need to enforce: 
    // 1. First call (when key pressed) -> Move instantly.
    // 2. Subsequent calls -> Block until REPEAT_DELAY passed since press.
    // 3. After REPEAT_DELAY -> Allow move every moveDelay.
    
    // BUT lastMoveTime tracks global movement cooldown.
    // We need to check if we are in the "wait for repeat" phase.
    
    // Let's rely on lastMoveTime for the repetition rate, but modulate WHEN we can move.
    
    // Logic:
    // If timeSincePress < REPEAT_DELAY:
    //    Allow move ONLY IF this is the FIRST move since press.
    //    We can check this by seeing if lastMoveTime < pressTime? 
    //    Yes! If lastMoveTime < pressTime, we haven't moved yet for this press.
    
    // If timeSincePress >= REPEAT_DELAY:
    //    Allow move if (currentTime - lastMoveTime > moveDelay)
    
    // But wait, if we have multiple keys held?
    // Let's just solve for mobile D-Pad single key scenario mostly.
    
    // Find the oldest pressed key that matches direction? Or just check against ANY recent key press?
    
    // Let's implement logic: 
    
    // We need to check the startTime for the key driving this movement.
    // Since we're inside movePlayer1(dx, dy), specific to direction...
    // We'll approximate the key check from movement direction for simplicity:
    let relevantKeys: string[] = []
    if (dx === -1) relevantKeys = ['w', 'W', 'ArrowUp']
    if (dx === 1) relevantKeys = ['s', 'S', 'ArrowDown']
    if (dy === -1) relevantKeys = ['a', 'A', 'ArrowLeft']
    if (dy === 1) relevantKeys = ['d', 'D', 'ArrowRight']
    
    let pressTime = 0
    for (const k of relevantKeys) {
        if (keyPressTime.has(k)) {
            pressTime = Math.max(pressTime, keyPressTime.get(k) || 0)
        }
    }
    
    if (pressTime > 0) {
        const timeSincePress = currentTime - pressTime
        
        // Phase 1: Initial Move
        if (timeSincePress < REPEAT_DELAY) {
            // Only move if we haven't moved for this press yet
            // If lastMoveTime is OLDER than pressTime, it means this is the first move.
            if (lastMoveTime >= pressTime) {
                return false // We already moved for this press, waiting for repeat delay
            }
        }
        // Phase 2: Rapid Repeat
        // If timeSincePress >= REPEAT_DELAY, we fall through to normal speed check
    }

    if (currentTime - lastMoveTime < moveDelay) return false
    
    lastDx = dx
    lastDy = dy

    // Always update visual direction even if blocked
    if (player.playAnimation) {
      if (dx < 0) player.playAnimation('walk-up')
      else if (dx > 0) player.playAnimation('walk-down')
      else if (dy < 0) player.playAnimation('walk-left')
      else if (dy > 0) player.playAnimation('walk-right')
    }

    const targetX = playerGridX + dx
    const targetY = playerGridY + dy

    if (targetX < 0 || targetY < 0 || targetX >= GRID_WIDTH || targetY >= GRID_HEIGHT) return false

    // Check if there's a bomb at the target position - kick it!
    const bombAtTarget = bombs.find(b => b.x === targetX && b.y === targetY)
    if (bombAtTarget) {
      if (ghostTimer > 0) {
        // Ghost mode: walk through bombs
      } else if (hasKick) {
        kickBomb(dx, dy)
        lastMoveTime = currentTime
        return true
      } else {
        return false // Block movement if no kick ability
      }
    }

    if (grid[targetY][targetX] === 'wall') return false
    if (grid[targetY][targetX] === 'destructible' && ghostTimer <= 0) return false

    // Check collision with enemies (blocking)
    if (enemies.some(e => e.lives > 0 && e.x === targetX && e.y === targetY)) return false
    
    // Check collision with Player 2 (in PvP)
    if (gameMode === 'pvp' && targetX === player2GridX && targetY === player2GridY) return false

    playerGridX = targetX
    playerGridY = targetY
    // Don't instantly set position - let the smooth interpolation handle it
    // const newPos = gridToWorld(playerGridX, playerGridY)
    // player.position.x = newPos.x
    // player.position.z = newPos.z
    lastMoveTime = currentTime
    
    if (player.playAnimation) {
      if (dx < 0) player.playAnimation('walk-up')
      else if (dx > 0) player.playAnimation('walk-down')
      else if (dy < 0) player.playAnimation('walk-left')
      else if (dy > 0) player.playAnimation('walk-right')
    }
    
    checkPowerUps()
    return true
  }
  
  function movePlayer2(dx: number, dy: number, currentTime: number): boolean {
    if (currentTime - lastPlayer2MoveTime < player2MoveDelay) return false
    
    lastPlayer2Dx = dx
    lastPlayer2Dy = dy

    const targetX = player2GridX + dx
    const targetY = player2GridY + dy

    if (targetX < 0 || targetY < 0 || targetX >= GRID_WIDTH || targetY >= GRID_HEIGHT) return false

    // Check bomb collision
    if (bombs.some(b => b.x === targetX && b.y === targetY)) {
      if (player2GhostTimer > 0) {
        // Ghost mode: walk through bombs
      } else if (player2HasKick) {
        // Kick handled elsewhere
      } else {
        return false
      }
    }

    if (grid[targetY][targetX] === 'wall') return false
    if (grid[targetY][targetX] === 'destructible' && player2GhostTimer <= 0) return false

    // Check collision with enemies (blocking)
    if (enemies.some(e => e.lives > 0 && e.x === targetX && e.y === targetY)) return false
    
    // Check collision with Player 1
    if (targetX === playerGridX && targetY === playerGridY) return false

    player2GridX = targetX
    player2GridY = targetY
    // Don't instantly set position - let the smooth interpolation handle it
    // const newPos2 = gridToWorld(player2GridX, player2GridY)
    // player2.position.x = newPos2.x
    // player2.position.z = newPos2.z
    lastPlayer2MoveTime = currentTime
    
    checkPowerUps()
    return true
  }

  // Process held keys each frame for smooth movement
  function processHeldKeys() {
    if (gameOver || isPaused) return
    
    const currentTime = Date.now()
    
    // Player 1 movement (WASD) - check priority order
    if (keysHeld.has('w') || keysHeld.has('W')) {
      movePlayer1(-1, 0, currentTime)
    } else if (keysHeld.has('s') || keysHeld.has('S')) {
      movePlayer1(1, 0, currentTime)
    } else if (keysHeld.has('a') || keysHeld.has('A')) {
      movePlayer1(0, -1, currentTime)
    } else if (keysHeld.has('d') || keysHeld.has('D')) {
      movePlayer1(0, 1, currentTime)
    }
    
    // Player 2 movement (Arrow keys)
    if (gameMode === 'pvp') {
      if (keysHeld.has('ArrowUp')) {
        movePlayer2(-1, 0, currentTime)
      } else if (keysHeld.has('ArrowDown')) {
        movePlayer2(1, 0, currentTime)
      } else if (keysHeld.has('ArrowLeft')) {
        movePlayer2(0, -1, currentTime)
      } else if (keysHeld.has('ArrowRight')) {
        movePlayer2(0, 1, currentTime)
      }
    }
  }

  // Move tracking for tap vs hold logic
  // We want: initial press -> 1 move immediately.
  // Then wait for REPEAT_DELAY (e.g. 200ms).
  // Then if still held, move every moveDelay (depends on speed).
  // This prevents "double move" on quick taps when speed is high (and moveDelay is low).
  
  let keyPressTime: Map<string, number> = new Map() // When was the key first pressed?
  const REPEAT_DELAY = 180 // ms before repeating starts
  
  // Keyboard handlers
  const keydownHandler = (ev: KeyboardEvent) => {
    // Pause/Escape handling
    if (ev.key === 'Escape') {
      if (pauseMenu.style.display === 'none') {
        isPaused = true
        pauseMenu.style.display = 'flex'
      } else {
        isPaused = false
        pauseMenu.style.display = 'none'
      }
      return
    }

    if (gameOver || isPaused) return

    // Add key to held set
    if (!keysHeld.has(ev.key)) {
        keysHeld.add(ev.key)
        keyPressTime.set(ev.key, Date.now()) // Track start time of press
        
        // IMMEDIATE MOVE on press (if cooldown allows, but we force it for responsiveness?)
        // Actually, processHeldKeys runs every frame. We should handle the logic there
        // OR we can force a move here?
        // Better to let processHeldKeys handle it, but we need to reset "lastMoveTime" logic?
        // No, processHeldKeys checks "currentTime - lastMoveTime".
        // If we want to force a move immediately regardless of previous cooldown?
        // Typically, yes, a fresh keypress usually overrides a lingering cooldown slightly for responsiveness,
        // unless it's very fast spamming.
        // But the issue is the OPPOSITE: moving too much.
        // So we don't force move here. We just mark the start time.
    }

    // Handle bomb placement (immediate, not held)
    if (ev.key === ' ') {
      const bombAtPlayer = bombs.find(b => b.x === playerGridX && b.y === playerGridY)
      if (bombAtPlayer && hasThrow) {
        throwBomb(lastDx, lastDy)
      } else if (hasLineBomb && currentBombs < maxBombs) {
        placeLineBomb(playerGridX, playerGridY, lastDx, lastDy, -1)
      } else {
        placeBomb(playerGridX, playerGridY)
      }
      return
    }
    
    if (ev.key === 'Enter' && gameMode === 'pvp') {
      const bombAtPlayer2 = bombs.find(b => b.x === player2GridX && b.y === player2GridY)
      if (bombAtPlayer2 && player2HasThrow) {
        throwBombPlayer2(lastPlayer2Dx, lastPlayer2Dy)
      } else if (player2HasLineBomb && player2CurrentBombs < player2MaxBombs) {
        placeLineBomb(player2GridX, player2GridY, lastPlayer2Dx, lastPlayer2Dy, -2)
      } else {
        placeBombPlayer2(player2GridX, player2GridY)
      }
      return
    }
  }
  
  const keyupHandler = (ev: KeyboardEvent) => {
    keysHeld.delete(ev.key)
    keyPressTime.delete(ev.key)
  }
  
  window.addEventListener('keydown', keydownHandler)
  window.addEventListener('keyup', keyupHandler)
  
  // Clean up event listeners when scene is disposed
  scene.onDisposeObservable.add(() => {
    window.removeEventListener('keydown', keydownHandler)
    window.removeEventListener('keyup', keyupHandler)
  })

  // Off-screen indicators
  const indicatorContainer = document.createElement('div')
  indicatorContainer.id = 'indicator-container'
  document.body.appendChild(indicatorContainer)
  const activeIndicators = new Map<string, HTMLElement>()

  // Cleanup on scene dispose
  scene.onDisposeObservable.add(() => {
    indicatorContainer.remove()
  })

  const _indicatorIdentity = Matrix.Identity()
  const _indicatorTargetPos = new Vector3()
  let lastIndicatorUpdate = 0
  const INDICATOR_UPDATE_INTERVAL = 100 // Throttle to ~10fps

  function updateOffscreenIndicators() {
    // Throttle indicator updates to reduce DOM writes + projection overhead
    const now = Date.now()
    if (now - lastIndicatorUpdate < INDICATOR_UPDATE_INTERVAL) return
    lastIndicatorUpdate = now

    // Collect all targets (enemies + player 2 if in PVP)
    const targets: { id: string, x: number, z: number, color: string, active: boolean }[] = []
    
    enemies.forEach((enemy, idx) => {
      if (enemy.lives > 0) {
        // Find the color used for this enemy or default to red
        const color = (idx < enemyColors.length) ? enemyColors[idx] : '#ff4444'
        gridToWorldInPlace(enemy.x, enemy.y, _tmpGridVec)
        targets.push({ id: `enemy-${idx}`, x: _tmpGridVec.x, z: _tmpGridVec.z, color, active: true })
      }
    })

    if (gameMode === 'pvp' && player2Lives > 0) {
        // Add player 2
        targets.push({ id: 'p2', x: player2.position.x, z: player2.position.z, color: '#4488ff', active: true })
    }

    // Process targets
    targets.forEach(target => {
        let indicator = activeIndicators.get(target.id)
        if (!indicator) {
            indicator = document.createElement('div')
            indicator.className = 'offscreen-indicator'
            const arrow = document.createElement('div')
            arrow.className = 'offscreen-arrow'
            arrow.style.borderBottomColor = target.color
            indicator.appendChild(arrow)
            indicatorContainer.appendChild(indicator)
            activeIndicators.set(target.id, indicator)
        }

        // Project position to screen space (reuse cached objects)
        _indicatorTargetPos.copyFromFloats(target.x, TILE_SIZE/2, target.z)
        const screenPos = Vector3.Project(
            _indicatorTargetPos,
            _indicatorIdentity,
            scene.getTransformMatrix(),
            camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
        )

        const screenWidth = engine.getRenderWidth()
        const screenHeight = engine.getRenderHeight()
        const padding = 40 // Margin from edge

        // Check if onscreen
        // Note: screenPos.x/y are in pixels from top-left (BabylonJS uses bottom-left for viewport usually, but Project returns screen coordinates?)
        // Let's verify Babylon Project. Returns x, y, z where x, y are in pixels (0,0 is usually top-left for overlay logic depending on viewport, but Babylon engine standard is bottom-left? No, usually coordinate system needs checking)
        // Actually, Project returns coordinates in window space usually.
        // Let's check if it's within bounds.
        
        const isOffscreen = screenPos.x < padding || screenPos.x > screenWidth - padding || 
                            screenPos.y < padding || screenPos.y > screenHeight - padding
        
        if (isOffscreen) {
            indicator.style.display = 'flex'
            
            // Calculate clamped position
            const centerX = screenWidth / 2
            const centerY = screenHeight / 2
            
            // Vector from center to target
            // screenPos z is depth (0-1). If z < 0 or > 1, it's clipped by near/far planes.
            // But we care about X/Y being outside viewport.
            
            let dx = screenPos.x - centerX
            let dy = screenPos.y - centerY
            
            // If behind camera (shouldn't happen in top-down ortho usually, but safe to check)
            // Just use the direction
            
            const angle = Math.atan2(dy, dx)
            
            // Ray intersection with simplified box (screen bounds minus padding)
            // Tan(angle) = y/x
            // We want to find x,y on the box border.
            
            const boxW = (screenWidth / 2) - padding
            const boxH = (screenHeight / 2) - padding
            
            // Normalize direction
            // Calculate intersection with vertical edges
            let intersectX = dx > 0 ? boxW : -boxW
            let intersectY = intersectX * Math.tan(angle)
            
            // If y intersection is out of bounds, check horizontal edges
            if (Math.abs(intersectY) > boxH) {
                intersectY = dy > 0 ? boxH : -boxH
                intersectX = intersectY / Math.tan(angle)
            }
            
            const finalX = centerX + intersectX
            const finalY = centerY + intersectY
            
            // Update CSS
            indicator.style.left = `${finalX - 20}px` // Center the 40px div
            indicator.style.top = `${finalY - 20}px`
            
            // Rotation: angle + 90deg because arrow points up by default
            const rotationDeg = (angle * 180 / Math.PI) + 90
            indicator.style.transform = `rotate(${rotationDeg}deg)`
            
        } else {
            indicator.style.display = 'none'
        }
    })

    // Clean up indicators for inactive targets (e.g. dead enemies)
    // Though usually enemies stay in array? Yes, logic uses enemy.lives > 0
    // If enemy dies, we should hide/remove.
    // Ideally we diff the map keys vs current active keys.
    const activeIds = new Set(targets.map(t => t.id))
    activeIndicators.forEach((el, id) => {
        if (!activeIds.has(id)) {
            el.remove()
            activeIndicators.delete(id)
        }
    })
  }

  // Game loop update
  let lastTime = Date.now()
  let lastUIUpdateTime = 0
  const UI_UPDATE_INTERVAL = 250 // Update UI at most 4 times per second
  scene.onBeforeRenderObservable.add(() => {
    const currentTime = Date.now()
    const deltaTime = currentTime - lastTime
    lastTime = currentTime

    if (!isPaused) {
      // Process held keys for smooth continuous movement
      processHeldKeys()
      
      // Smooth movement interpolation for player 1 (reuse _tmpGridVec to avoid allocations)
      gridToWorldInPlace(playerGridX, playerGridY, _tmpGridVec)
      const lerpFactor = Math.min(1, MOVE_LERP_SPEED * deltaTime / 1000)
      playerVisualX += (_tmpGridVec.x - playerVisualX) * lerpFactor
      playerVisualZ += (_tmpGridVec.z - playerVisualZ) * lerpFactor
      player.position.x = playerVisualX
      player.position.z = playerVisualZ
      
      // Smooth movement interpolation for player 2 (PvP mode)
      if (gameMode === 'pvp' && player2) {
        gridToWorldInPlace(player2GridX, player2GridY, _tmpGridVec)
        player2VisualX += (_tmpGridVec.x - player2VisualX) * lerpFactor
        player2VisualZ += (_tmpGridVec.z - player2VisualZ) * lerpFactor
        player2.position.x = player2VisualX
        player2.position.z = player2VisualZ
      }
      
      // Smooth movement interpolation for enemies
      enemies.forEach(enemy => {
        if (enemy.lives > 0 && enemy.visualX !== undefined && enemy.visualZ !== undefined) {
          gridToWorldInPlace(enemy.x, enemy.y, _tmpGridVec)
          enemy.visualX += (_tmpGridVec.x - enemy.visualX) * lerpFactor
          enemy.visualZ += (_tmpGridVec.z - enemy.visualZ) * lerpFactor
          enemy.mesh.position.x = enemy.visualX
          enemy.mesh.position.z = enemy.visualZ
        }
      })
      
      // Camera follow logic for mobile
      if (isMobile()) {
        const targetX = player.position.x
        const targetZ = player.position.z
        
        const minX = -halfWorldWidth - margin + viewportHalfWidth
        const maxX = halfWorldWidth + margin - viewportHalfWidth
        const minZ = -halfWorldHeight - margin + viewportHalfHeight
        const maxZ = halfWorldHeight + margin - viewportHalfHeight
        
        // Handle case where viewport is larger than world (center camera)
        let clampedX = 0
        let clampedZ = 0
        
        if (minX > maxX) {
            clampedX = 0
        } else {
            clampedX = Math.max(minX, Math.min(maxX, targetX))
        }
        
        if (minZ > maxZ) {
            clampedZ = 0
        } else {
            clampedZ = Math.max(minZ, Math.min(maxZ, targetZ))
        }
        
        // Smoothly interpolate camera target
        const lerpSpeed = 0.1
        camera.target.x = camera.target.x + (clampedX - camera.target.x) * lerpSpeed
        camera.target.z = camera.target.z + (clampedZ - camera.target.z) * lerpSpeed
      }
      
      // Call indicator update
      updateOffscreenIndicators()

      updateBombs(deltaTime)
      if (!gameOver) updateEnemies(deltaTime)
      updateInvulnerability(deltaTime)
      
      // Update time attack
      if (gameMode === 'time-attack') {
        gameStateManager.updateTimeAttack(deltaTime)
        
        // Throttle UI updates to avoid heavy DOM manipulation every frame
        if (currentTime - lastUIUpdateTime >= UI_UPDATE_INTERVAL) {
          updateUI()
          lastUIUpdateTime = currentTime
        }
        
        if (gameStateManager.isTimeUp() && !gameOver) {
          gameOver = true
          statsManager.recordLoss()
          if (soundManager) soundManager.playSFX('defeat')
          console.log('Time Up! Game Over!')
          updateUI()
        }
      }
      
      // Update sprite animations - Disabled as new 3D meshes self-animate via observers
      /*
      if (player.update) {
        player.update(deltaTime)
      }
      if (player2 && player2.update) {
        player2.update(deltaTime)
      }
      enemies.forEach(enemy => {
        if (enemy.mesh.update) {
          enemy.mesh.update(deltaTime)
        }
      })
      */
    }
  })

  return scene
}

function startGame(mode: GameMode) {
  // Clean up previous game
  if (currentScene) {
    currentScene.dispose()
  }
  if (currentEngine) {
    currentEngine.dispose()
  }

  currentEngine = new Engine(canvas, true)
  currentScene = createScene(currentEngine, mode)
  
  // IMMEDIATELY UNLOCK AUDIO on user interaction
  if (soundManager) {
      soundManager.resumeAudio()
  }

  // Auto-enter fullscreen on mobile for maximum play area
  if (isMobile()) {
    toggleFullscreen()
  }
  
  // Start paused for countdown
  isPaused = true

  // Handle resize — remove previous listener to prevent accumulation
  const resize = () => {
    currentEngine?.resize()
  }
  window.addEventListener('resize', resize)
  currentScene.onDisposeObservable.add(() => {
    window.removeEventListener('resize', resize)
  })

  currentEngine.runRenderLoop(() => {
    if (currentScene) {
      currentScene.render()
    }
  })
  
  // Show countdown then start game
  showCountdown(() => {
    isPaused = false
    if (soundManager) {
      soundManager.resumeAudio() // Ensure context is unlocked
      soundManager.playSFX('game-start')
      soundManager.playMusic('bgm')
    }
  }, () => {
    // Play tick sound for each countdown number
    if (soundManager) soundManager.playSFX('countdown-tick')
  })
}

// Fullscreen toggle for mobile
function toggleFullscreen() {
  const doc = document as any
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    const el = document.documentElement as any
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
  } else {
    if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {})
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
  }
}

// Create pause menu
const pauseMenu = createPauseMenu(
  () => {
    // Resume
    isPaused = false
    pauseMenu.style.display = 'none'
  },
  () => {
    // Quit to menu
    isPaused = false
    pauseMenu.style.display = 'none'
    mainMenu.style.display = 'flex'

    if (soundManager) soundManager.stopMusic()
    
    // Clean up game — dispose scene first, then engine (correct order for GPU resource cleanup)
    if (currentScene) {
      currentScene.dispose()
      currentScene = null
    }
    if (currentEngine) {
      currentEngine.dispose()
      currentEngine = null
    }
    
    // Remove UI elements
    // Added .mobile-pause-btn to cleanup list
    const elementsToRemove = ['.game-ui-panel', '.center-ui', '.mobile-controls-container', '.offscreen-indicator', '.mobile-pause-btn']
    elementsToRemove.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => el.remove())
    })
    document.querySelectorAll('#app > div').forEach(el => {
      if (el.id !== 'main-menu' && el.id !== 'pause-menu') {
        el.remove()
      }
    })
  }
)
document.body.appendChild(pauseMenu)

// Create settings menu
const settingsMenu = createSettingsMenu(
  settingsManager,
  () => soundManager,
  () => {
    settingsMenu.style.display = 'none'
    mainMenu.style.display = 'flex'
  }
)
document.body.appendChild(settingsMenu)

// Create stats screen
const statsScreen = createStatsScreen(() => {
  statsScreen.style.display = 'none'
  mainMenu.style.display = 'flex'
})
document.body.appendChild(statsScreen)

// Create main menu
const mainMenu = createMainMenu({
  onStartGame: (mode) => {
    startGame(mode)
  }
})
document.body.appendChild(mainMenu)

// Create achievements screen
const achievementsScreen = createAchievementsScreen(
  achievementsManager,
  () => {
    achievementsScreen.style.display = 'none'
    mainMenu.style.display = 'flex'
  }
)
document.body.appendChild(achievementsScreen)

// Create tutorial screen
const tutorialScreen = createTutorialScreen(() => {
  tutorialScreen.style.display = 'none'
  mainMenu.style.display = 'flex'
})
document.body.appendChild(tutorialScreen)

// Create map selection screen
const mapSelectionScreen = createMapSelectionScreen(
  (mapKey: string) => {
    currentMapConfig = getMapConfig(mapKey)
    mapSelectionScreen.style.display = 'none'
    mainMenu.style.display = 'flex'
  },
  () => {
    mapSelectionScreen.style.display = 'none'
    mainMenu.style.display = 'flex'
  }
)
document.body.appendChild(mapSelectionScreen)

// Add global menu sound effects
// This plays sounds for any menu button interactions
document.addEventListener('mouseenter', (e) => {
  const target = e.target as HTMLElement
  if (target.tagName === 'BUTTON' && (target.closest('.menu-container') || target.closest('#main-menu'))) {
    if (soundManager) soundManager.playSFX('menu-select')
  }
}, true)

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  if (target.tagName === 'BUTTON' && (target.closest('.menu-container') || target.closest('#main-menu'))) {
    if (soundManager) soundManager.playSFX('menu-click')
  }
}, true)

// Add event listeners for menu buttons via event delegation (no setTimeout race condition)
mainMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const button = target.closest('button')
  if (!button) return
  
  switch (button.id) {
    case 'settings-button':
      mainMenu.style.display = 'none'
      settingsMenu.style.display = 'flex'
      break
    case 'stats-button':
      mainMenu.style.display = 'none'
      statsScreen.style.display = 'flex'
      break
    case 'achievements-button':
      if ((achievementsScreen as any).refresh) {
        ;(achievementsScreen as any).refresh()
      }
      mainMenu.style.display = 'none'
      achievementsScreen.style.display = 'flex'
      break
    case 'tutorial-button':
      mainMenu.style.display = 'none'
      tutorialScreen.style.display = 'flex'
      break
    case 'map-selection-button':
      mainMenu.style.display = 'none'
      mapSelectionScreen.style.display = 'flex'
      break
    case 'fullscreen-button':
      toggleFullscreen()
      break
  }
})
