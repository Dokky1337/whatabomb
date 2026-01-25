import { FLARE_TEXTURE_DATA_URI } from './assets'
import './style.css'
import { isMobile } from './device'
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
import { getMapConfig, type MapConfig } from './maps'
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

type PowerUpType = 'extraBomb' | 'largerBlast' | 'kick' | 'throw' | 'speed'

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
}

function createGrid(width: number, height: number, paddingBottom: number = 0): Grid {
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

      if (isBorder || isInnerPillar) {
        row.push('wall')
      } else {
        // Add destructible blocks randomly (about 80% of empty tiles)
        if (Math.random() < 0.8) {
          row.push('destructible')
        } else {
          row.push('empty')
        }
      }
    }
    grid.push(row)
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

function createScene(engine: Engine, gameMode: GameMode): Scene {
  const scene = new Scene(engine)
  
  // Update grid size from map config
  GRID_WIDTH = currentMapConfig.gridWidth
  GRID_HEIGHT = currentMapConfig.gridHeight
  
  // Initialize sound manager
  soundManager = new SoundManager(scene)
  soundManager.createPlaceholderSounds()
  
  // Try to load sound files (will fail gracefully if not present)
  try {
    soundManager.loadSound('bomb-place', '/sounds/bomb-place.mp3', { volume: 0.5 })
    soundManager.loadSound('explosion', '/sounds/explosion.mp3', { volume: 0.6 })
    soundManager.loadSound('powerup', '/sounds/powerup.mp3', { volume: 0.5 })
    soundManager.loadSound('victory', '/sounds/victory.mp3', { volume: 0.7 })
    soundManager.loadSound('defeat', '/sounds/defeat.mp3', { volume: 0.7 })
    soundManager.loadSound('bgm', '/sounds/bgm.mp3', { loop: true, isMusic: true })
  } catch (e) {
    console.log('Sound files not found - add them to public/sounds/')
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
  } else if (gameMode !== 'pvp') {
    gameStateManager.initRounds(3) // Best of 3
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
  function screenShake(intensity: number = 0.3, duration: number = 200) {
    if (!settingsManager.getSettings().screenShake) return
    
    const originalPosition = camera.position.clone()
    const shakeStart = Date.now()
    
    const shakeInterval = setInterval(() => {
      const elapsed = Date.now() - shakeStart
      if (elapsed >= duration) {
        camera.position.copyFrom(originalPosition)
        clearInterval(shakeInterval)
        return
      }
      
      const progress = elapsed / duration
      const currentIntensity = intensity * (1 - progress)
      
      camera.position.x = originalPosition.x + (Math.random() - 0.5) * currentIntensity
      camera.position.y = originalPosition.y + (Math.random() - 0.5) * currentIntensity
      camera.position.z = originalPosition.z + (Math.random() - 0.5) * currentIntensity
    }, 16)
  }

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
  const groundMaterial = new StandardMaterial('groundMat', scene)
  groundMaterial.diffuseColor = currentMapConfig.colors.ground
  groundMaterial.specularColor = new Color3(0.05, 0.05, 0.05)
  groundMaterial.specularPower = 64
  groundMaterial.ambientColor = currentMapConfig.colors.ambient

  const wallMaterial = new StandardMaterial('wallMat', scene)
  wallMaterial.diffuseColor = currentMapConfig.colors.wall
  wallMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
  wallMaterial.specularPower = 32

  const destructibleMaterial = new StandardMaterial('destructibleMat', scene)
  destructibleMaterial.diffuseColor = currentMapConfig.colors.destructible
  destructibleMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
  destructibleMaterial.specularPower = 16

  const playerMaterial = new StandardMaterial('playerMat', scene)
  playerMaterial.diffuseColor = new Color3(0.9, 0.1, 0.1)
  playerMaterial.specularColor = new Color3(0, 0, 0)

  const bombMaterial = new StandardMaterial('bombMat', scene)
  bombMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1)
  bombMaterial.specularColor = new Color3(0.5, 0.5, 0.5)

  const explosionMaterial = new StandardMaterial('explosionMat', scene)
  explosionMaterial.diffuseColor = new Color3(1, 0.5, 0)
  explosionMaterial.emissiveColor = new Color3(0.8, 0.2, 0)
  explosionMaterial.specularColor = new Color3(0, 0, 0)

  const powerUpBombMaterial = new StandardMaterial('powerUpBombMat', scene)
  powerUpBombMaterial.diffuseColor = new Color3(0.2, 0.6, 1)
  powerUpBombMaterial.emissiveColor = new Color3(0.1, 0.3, 0.8)
  powerUpBombMaterial.specularColor = new Color3(1, 1, 1)

  const powerUpBlastMaterial = new StandardMaterial('powerUpBlastMat', scene)
  powerUpBlastMaterial.diffuseColor = new Color3(1, 0.8, 0.2)
  powerUpBlastMaterial.emissiveColor = new Color3(0.8, 0.6, 0)
  powerUpBlastMaterial.specularColor = new Color3(1, 1, 1)

  const powerUpKickMaterial = new StandardMaterial('powerUpKickMat', scene)
  powerUpKickMaterial.diffuseColor = new Color3(0.6, 0.3, 0.1)
  powerUpKickMaterial.emissiveColor = new Color3(0.4, 0.2, 0)
  powerUpKickMaterial.specularColor = new Color3(1, 1, 1)

  const powerUpThrowMaterial = new StandardMaterial('powerUpThrowMat', scene)
  powerUpThrowMaterial.diffuseColor = new Color3(1, 0.6, 0.4)
  powerUpThrowMaterial.emissiveColor = new Color3(0.8, 0.4, 0.2)
  powerUpThrowMaterial.specularColor = new Color3(1, 1, 1)

  const powerUpSpeedMaterial = new StandardMaterial('powerUpSpeedMat', scene)
  powerUpSpeedMaterial.diffuseColor = new Color3(0, 0.8, 1)
  powerUpSpeedMaterial.emissiveColor = new Color3(0, 0.5, 1)
  powerUpSpeedMaterial.specularColor = new Color3(1, 1, 1)

  const enemyMaterial = new StandardMaterial('enemyMat', scene)
  enemyMaterial.diffuseColor = new Color3(0.8, 0.2, 0.8)
  enemyMaterial.specularColor = new Color3(0, 0, 0)

  // Create map geometry
  const paddingBottom = isMobile() ? 4 : 0
  const grid = createGrid(GRID_WIDTH, GRID_HEIGHT, paddingBottom)
  
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

  // Create crate/barrel texture
  const crateTexture = createTexture('#8B4513', (ctx) => {
    ctx.fillStyle = '#654321'
    ctx.fillRect(10, 0, 10, 128)
    ctx.fillRect(40, 0, 10, 128)
    ctx.fillRect(70, 0, 10, 128)
    ctx.fillRect(100, 0, 10, 128)
    ctx.fillRect(0, 10, 128, 10)
    ctx.fillRect(0, 108, 128, 10)
    
    // Diagonals
    ctx.strokeStyle = '#5a3a1a'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(0, 0); ctx.lineTo(128, 128)
    ctx.moveTo(128, 0); ctx.lineTo(0, 128)
    ctx.stroke()
  })
  
  const crateMaterial = new StandardMaterial('crateMat', scene)
  crateMaterial.diffuseTexture = crateTexture
  crateMaterial.specularColor = new Color3(0.1, 0.1, 0.1)

  // Create procedural floor texture based on theme
  const createFloorTexture = (theme: string) => {
    return createTexture('#222', (ctx) => {
      // Clean, modern aesthetic - no random noise
      const w = 128
      const h = 128
      
      // Base background
      ctx.fillStyle = theme === 'ice' ? '#e8f4f8' : 
                      theme === 'lava' ? '#2a0a0a' : 
                      theme === 'forest' ? '#0a2a0a' : '#1a1a1a'
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
      
      const tileMat = new StandardMaterial(`tileMat-${x}-${y}`, scene)
      tileMat.diffuseTexture = floorTexture
      
      // Blend texture with theme color
      const baseColor = currentMapConfig.colors.ground
      if (isCheckered) {
        tileMat.diffuseColor = baseColor
      } else {
        tileMat.diffuseColor = baseColor.scale(0.85) // Subtle darker shade
      }
      
      tileMat.specularColor = new Color3(0.05, 0.05, 0.05) // Reduce specularity for matte stone look
      tile.material = tileMat

      if (grid[y][x] === 'wall') {
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
        
        // Base is part of the wall now visually, or purely optional. 
        // Let's remove separate base mesh to clean up visual noise and z-fighting
      } else if (grid[y][x] === 'destructible') {
        // Create a BARREL or CRATE instead of a generic box
        const destructible = MeshBuilder.CreateBox(`destructible-${x}-${y}`, { 
          size: TILE_SIZE * 0.8
        }, scene)
        
        destructible.position.x = pos.x
        destructible.position.y = TILE_SIZE * 0.4
        destructible.position.z = pos.z
        destructible.material = crateMaterial // Use distinct texture
        
        destructibleMeshes.set(`${x},${y}`, destructible)
        shadowGenerator.addShadowCaster(destructible)
        destructible.receiveShadows = true
      }
    }
  }

  // Create player as an animated sprite or emoji fallback

  // Create 3D character mesh
  const createPlayerSprite = (name: string, _textureUrl: string | null, _emoji: string, colorHex: string): any => {
    // Parent mesh (pivot)
    const root = new TransformNode(name + '-root', scene)
    
    // Main body material using the player color
    const bodyMat = new StandardMaterial(name + '-bodyMat', scene)
    bodyMat.diffuseColor = Color3.FromHexString(colorHex)
    bodyMat.specularColor = new Color3(0.1, 0.1, 0.1)
    
    // Skin/Face material
    const skinMat = new StandardMaterial(name + '-skinMat', scene)
    skinMat.diffuseColor = new Color3(1, 0.8, 0.6) // Peach/Skin
    skinMat.specularColor = new Color3(0, 0, 0)

    // Dark material for eyes/limbs
    const darkMat = new StandardMaterial(name + '-darkMat', scene)
    darkMat.diffuseColor = new Color3(0.1, 0.1, 0.1)

    // White for eye shine
    const whiteMat = new StandardMaterial(name + '-whiteMat', scene)
    whiteMat.diffuseColor = new Color3(1, 1, 1)
    whiteMat.emissiveColor = new Color3(1, 1, 1)

    // BODY (Sphere-like)
    const body = MeshBuilder.CreateSphere(name + '-body', { diameter: TILE_SIZE * 0.5 }, scene)
    body.position.y = TILE_SIZE * 0.25
    body.material = bodyMat
    body.parent = root

    // HEAD (Sphere)
    const head = MeshBuilder.CreateSphere(name + '-head', { diameter: TILE_SIZE * 0.4 }, scene)
    head.position.y = TILE_SIZE * 0.6
    head.material = skinMat
    head.parent = root

    // HELMET/HAT (Half sphere or just top part)
    const helmet = MeshBuilder.CreateSphere(name + '-helmet', { diameter: TILE_SIZE * 0.42, slice: 0.5 }, scene)
    helmet.rotation.x = Math.PI
    helmet.position.y = 0
    helmet.material = bodyMat
    helmet.parent = head

    // EYES
    const leftEye = MeshBuilder.CreateSphere(name + '-leftEye', { diameter: TILE_SIZE * 0.1 }, scene)
    leftEye.position = new Vector3(-0.06 * TILE_SIZE, 0.05 * TILE_SIZE, 0.15 * TILE_SIZE)
    leftEye.scaling.z = 0.5
    leftEye.material = darkMat
    leftEye.parent = head

    const rightEye = MeshBuilder.CreateSphere(name + '-rightEye', { diameter: TILE_SIZE * 0.1 }, scene)
    rightEye.position = new Vector3(0.06 * TILE_SIZE, 0.05 * TILE_SIZE, 0.15 * TILE_SIZE)
    rightEye.scaling.z = 0.5
    rightEye.material = darkMat
    rightEye.parent = head

    // Add the number/identifier if enemy
    if (name.includes('enemy')) {
       // Simple geometry for enemy number? Or just skip it for now and rely on color
       // Let's make eyes glow red for enemies
       leftEye.material = new StandardMaterial(name + '-eyeMat', scene)
       ;(leftEye.material as StandardMaterial).emissiveColor = new Color3(0.8, 0, 0)
       rightEye.material = leftEye.material
    }

    // LIMBS
    const limbSize = TILE_SIZE * 0.15
    
    // Hands
    const leftHand = MeshBuilder.CreateSphere(name + '-leftHand', { diameter: limbSize }, scene)
    leftHand.position = new Vector3(-0.25 * TILE_SIZE, 0.3 * TILE_SIZE, 0)
    leftHand.material = bodyMat // Gloves?
    leftHand.parent = root

    const rightHand = MeshBuilder.CreateSphere(name + '-rightHand', { diameter: limbSize }, scene)
    rightHand.position = new Vector3(0.25 * TILE_SIZE, 0.3 * TILE_SIZE, 0)
    rightHand.material = bodyMat
    rightHand.parent = root

    // Feet
    const leftFoot = MeshBuilder.CreateSphere(name + '-leftFoot', { diameter: limbSize * 1.2 }, scene)
    leftFoot.position = new Vector3(-0.15 * TILE_SIZE, 0.1 * TILE_SIZE, 0)
    leftFoot.material = darkMat // Shoes
    leftFoot.parent = root

    const rightFoot = MeshBuilder.CreateSphere(name + '-rightFoot', { diameter: limbSize * 1.2 }, scene)
    rightFoot.position = new Vector3(0.15 * TILE_SIZE, 0.1 * TILE_SIZE, 0)
    rightFoot.material = darkMat
    rightFoot.parent = root
    
    // Animation state
    let isMoving = false
    let animTime = 0
    
    // Register visual update
    // Note: We use scene.onBeforeRenderObservable directly on the root to avoid leaking observers if disposed
    const observer = scene.onBeforeRenderObservable.add(() => {
        if (isMoving) {
            animTime += 0.2
            
            // Walking animation - swing arms forward/back (Y axis for up/down motion)
            // Arms swing opposite to each other
            leftHand.position.y = 0.3 * TILE_SIZE + Math.sin(animTime) * 0.08 * TILE_SIZE
            rightHand.position.y = 0.3 * TILE_SIZE + Math.sin(animTime + Math.PI) * 0.08 * TILE_SIZE
            
            // Feet alternate forward/back in local Z
            leftFoot.position.z = Math.sin(animTime + Math.PI) * 0.1 * TILE_SIZE
            rightFoot.position.z = Math.sin(animTime) * 0.1 * TILE_SIZE
            
            // Bob body slightly
            body.position.y = TILE_SIZE * 0.25 + Math.abs(Math.sin(animTime * 2)) * 0.015 * TILE_SIZE
            head.position.y = TILE_SIZE * 0.6 + Math.abs(Math.sin(animTime * 2)) * 0.015 * TILE_SIZE
        } else {
            // Idle animation - Breathing
            const breathe = Math.sin(Date.now() * 0.003) * 0.01 * TILE_SIZE
            head.position.y = TILE_SIZE * 0.6 + breathe
            body.scaling.x = 1 + breathe * 0.5
            
            // Reset limbs smoothly
            const resetSpeed = 0.2
            leftHand.position.y = leftHand.position.y + (0.3 * TILE_SIZE - leftHand.position.y) * resetSpeed
            rightHand.position.y = rightHand.position.y + (0.3 * TILE_SIZE - rightHand.position.y) * resetSpeed
            leftFoot.position.z = leftFoot.position.z * (1 - resetSpeed)
            rightFoot.position.z = rightFoot.position.z * (1 - resetSpeed)
        }
    })
    
    // Cleanup observer when mesh is disposed
    root.onDisposeObservable.add(() => {
        scene.onBeforeRenderObservable.remove(observer)
        bodyMat.dispose()
        skinMat.dispose()
        darkMat.dispose()
        whiteMat.dispose()
    })
    
    // Add custom method to match existing logic
    ;(root as any).playAnimation = (anim: string) => {
        if (anim.startsWith('walk')) {
            isMoving = true
            
            // Rotate based on direction
            // Top-down camera view, grid Y maps to world Z
            // walk-up = move toward top of screen = -Z direction
            // walk-down = move toward bottom of screen = +Z direction
            const targetRot = 
                 anim === 'walk-up' ? -Math.PI/2 :
                 anim === 'walk-down' ? Math.PI/2 :
                 anim === 'walk-left' ? Math.PI :
                 0 // walk-right
                 
            // Snap to rotation
            root.rotation.y = targetRot
            
            // Stop moving after a short delay if no new calls come in
            if ((root as any).stopTimer) clearTimeout((root as any).stopTimer)
            ;(root as any).stopTimer = setTimeout(() => {
                isMoving = false
            }, 100)
        }
    }
    
    return root as any // Cast to any to avoid type errors
  }

  const player = createPlayerSprite('player', null, '🧑', settings.player1Color)
  let playerGridX = 1
  let playerGridY = 1
  const playerPos = gridToWorld(playerGridX, playerGridY)
  player.position.x = playerPos.x
  player.position.y = TILE_SIZE * 0.5
  player.position.z = playerPos.z
  
  // Player stats (affected by difficulty)
  let maxBombs = 1
  let currentBombs = 0
  let blastRadius = 2
  let playerLives = difficultyConfig.playerStartingLives
  let playerInvulnerable = false
  let playerInvulnerableTimer = 0
  let hasKick = false
  let hasThrow = false
  let playerSpeed = 1
  let moveDelay = 150 // milliseconds between moves
  let lastMoveTime = 0

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
    const enemy: Enemy = {
      x: spawn.x,
      y: spawn.y,
      mesh: enemyMesh,
      moveTimer: Math.random() * 400, // Stagger movement
      lives: difficultyConfig.enemyStartingLives,
      invulnerable: false,
      invulnerableTimer: 0,
    }
    const enemyPos = gridToWorld(enemy.x, enemy.y)
    enemy.mesh.position.x = enemyPos.x
    enemy.mesh.position.y = TILE_SIZE * 0.5
    enemy.mesh.position.z = enemyPos.z
    enemies.push(enemy)
  }

  // Player 2 for PvP mode
  let player2GridX = GRID_WIDTH - 2
  let player2GridY = GRID_HEIGHT - 2
  let player2Lives = 3
  let player2Invulnerable = false
  let player2InvulnerableTimer = 0
  let player2MaxBombs = 1
  let player2CurrentBombs = 0
  let player2BlastRadius = 2
  let player2HasKick = false
  let player2HasThrow = false
  let player2Speed = 1
  let player2MoveDelay = 150
  let lastPlayer2MoveTime = 0
  let lastPlayer2Dx = 0
  let lastPlayer2Dy = -1

  const player2Material = new StandardMaterial('player2Mat', scene)
  player2Material.diffuseColor = new Color3(0.1, 0.1, 0.9)
  player2Material.specularColor = new Color3(0, 0, 0)

  let player2: any = null
  if (gameMode === 'pvp') {
    player2 = createPlayerSprite('player2', null, '👤', settings.player2Color)
    const player2Pos = gridToWorld(player2GridX, player2GridY)
    player2.position.x = player2Pos.x
    player2.position.y = TILE_SIZE * 0.5
    player2.position.z = player2Pos.z
  }

  // Game state
  const bombs: Bomb[] = []
  const powerUps: PowerUp[] = []
  let gameOver = false
  let gameWon = false

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
    pauseBtn.style.top = '45%'
    pauseBtn.style.right = '15px'
    pauseBtn.style.left = 'auto'
    pauseBtn.style.width = '40px'
    pauseBtn.style.height = '40px'
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
    
    pauseBtn.addEventListener('touchstart', (e) => {
      e.preventDefault()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    pauseBtn.addEventListener('click', () => {
       window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    
    document.body.appendChild(pauseBtn)
  }

  const playerUIDiv = document.createElement('div')
  playerUIDiv.className = 'game-ui-panel'
  playerUIDiv.style.position = 'absolute'
  if (isMobileDevice) {
    // Bottom Left, under D-Pad controls (background for them)
    playerUIDiv.style.bottom = '10px'
    playerUIDiv.style.left = '10px'
    playerUIDiv.style.top = 'auto'
    
    // Scale scale small
    playerUIDiv.style.transform = 'scale(0.8)'
    playerUIDiv.style.transformOrigin = 'bottom left'
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
    ? 'linear-gradient(135deg, rgba(0,0,0,0.85) 0%, rgba(20,20,40,0.9) 100%)'
    : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,40,0.55) 100%)'
  playerUIDiv.style.border = '2px solid rgba(255,68,68,0.3)'
  playerUIDiv.style.borderRadius = '12px'
  playerUIDiv.style.padding = isMobileDevice ? '12px' : '8px 10px'
  playerUIDiv.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)'
  playerUIDiv.style.opacity = isMobileDevice ? '1' : '0.85'
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
    centerUIDiv.style.bottom = '15px'
    centerUIDiv.style.top = 'auto'
  } else {
    // PC: Keep at top center - doesn't block corners
    centerUIDiv.style.top = '10px'
  }
  centerUIDiv.style.left = '50%'
  centerUIDiv.style.transform = 'translateX(-50%)'
  centerUIDiv.style.color = 'white'
  centerUIDiv.style.fontFamily = "'Press Start 2P', 'Russo One', sans-serif"
  centerUIDiv.style.fontSize = isMobileDevice ? '14px' : '12px'
  centerUIDiv.style.fontWeight = 'bold'
  centerUIDiv.style.zIndex = '1000'
  centerUIDiv.style.textAlign = 'center'
  centerUIDiv.style.background = isMobileDevice
    ? 'linear-gradient(135deg, rgba(0,0,0,0.9) 0%, rgba(30,30,60,0.9) 100%)'
    : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(30,30,60,0.55) 100%)'
  centerUIDiv.style.border = '3px solid rgba(255, 102, 0, 0.5)'
  centerUIDiv.style.borderRadius = '12px'
  centerUIDiv.style.padding = isMobileDevice ? '12px 20px' : '8px 16px'
  centerUIDiv.style.boxShadow = '0 0 20px rgba(255, 102, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
  document.body.appendChild(centerUIDiv)

  // UI for opponents (top-right on PC, hidden on mobile)
  const opponentUIDiv = document.createElement('div')
  if (isMobileDevice) {
    opponentUIDiv.style.display = 'none' // Hide enemies stats on mobile to save space
  }
  opponentUIDiv.className = 'game-ui-panel'
  opponentUIDiv.style.position = 'absolute'
  if (isMobileDevice) {
      // Bottom Right, under Action Button (background for it)
      opponentUIDiv.style.bottom = '10px'
      opponentUIDiv.style.right = '10px'
      opponentUIDiv.style.top = 'auto'
      
      // Scale down slightly
      opponentUIDiv.style.transform = 'scale(0.8)'
      opponentUIDiv.style.transformOrigin = 'bottom right'
      opponentUIDiv.style.display = 'block'
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

  // Create mobile controls if on mobile
  if (isMobileDevice) {
    const mobileControlsHTML = `
      <div class="mobile-controls-container mobile-controls-visible">
        <div class="dpad">
          <div class="dpad-btn dpad-up" data-key="w"></div>
          <div class="dpad-btn dpad-down" data-key="s"></div>
          <div class="dpad-btn dpad-left" data-key="a"></div>
          <div class="dpad-btn dpad-right" data-key="d"></div>
        </div>
        <div class="action-btn-container">
          <div class="action-btn" data-key=" ">BOMB</div>
        </div>
      </div>
    `
    const controlsContainer = document.createElement('div')
    controlsContainer.className = 'mobile-controls-wrapper'
    controlsContainer.innerHTML = mobileControlsHTML
    document.body.appendChild(controlsContainer.firstElementChild as HTMLElement)

    // Handle resizing to toggle controls visibility
    window.addEventListener('resize', () => {
      const isStillMobile = isMobile()
      const controls = document.querySelector('.mobile-controls-container') as HTMLElement
      const pauseBtn = document.getElementById('mobile-pause-btn')

      if (controls) {
         if (isStillMobile) {
            controls.classList.add('mobile-controls-visible')
            if (pauseBtn) pauseBtn.style.display = 'flex'
         } else {
            controls.classList.remove('mobile-controls-visible')
            if (pauseBtn) pauseBtn.style.display = 'none'
         }
      }
    })

    // Bind touch events
    const dpadButtons = document.querySelectorAll('.dpad-btn')
    const actionBtn = document.querySelector('.action-btn')

    const simulateKey = (key: string, type: 'keydown' | 'keyup') => {
      window.dispatchEvent(new KeyboardEvent(type, { key: key }))
    }

    dpadButtons.forEach(btn => {
      const key = (btn as HTMLElement).dataset.key!
      
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        btn.classList.add('active')
        simulateKey(key, 'keydown')
      }, { passive: false })
      
      btn.addEventListener('touchend', (e) => {
        e.preventDefault()
        btn.classList.remove('active')
        simulateKey(key, 'keyup')
      })

      // Also support mouse for testing
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        btn.classList.add('active')
        simulateKey(key, 'keydown')
      })
      btn.addEventListener('mouseup', (e) => {
        e.preventDefault()
        btn.classList.remove('active')
        simulateKey(key, 'keyup')
      })
      btn.addEventListener('mouseleave', (e) => { // Handle dragging out
        if (btn.classList.contains('active')) {
            e.preventDefault()
            btn.classList.remove('active')
            simulateKey(key, 'keyup')   
        }
      })
    })

    if (actionBtn) {
      const btn = actionBtn as HTMLElement
      const key = " "
      
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        btn.classList.add('active')
        simulateKey(key, 'keydown')
      }, { passive: false })
      
      btn.addEventListener('touchend', (e) => {
        e.preventDefault()
        btn.classList.remove('active')
        simulateKey(key, 'keyup') // Release logic if needed (space is usually instant but keyup good for consistency)
      })

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        btn.classList.add('active')
        simulateKey(key, 'keydown')
      })

      btn.addEventListener('mouseup', (e) => {
        e.preventDefault()
        btn.classList.remove('active')
        simulateKey(key, 'keyup')
      })
    }
  }

  function updateUI() {
    // Update center UI (timer or rounds)
    const timeAttackState = gameStateManager.getTimeAttackState()
    const roundState = gameStateManager.getRoundState()
    
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
    } else if (roundState) {
      centerUIDiv.style.display = 'block'
      centerUIDiv.innerHTML = `
        <div style="font-size: 14px;">ROUND ${roundState.currentRound}/${roundState.maxRounds}</div>
        <div style="font-size: 11px; margin-top: 8px; display: flex; gap: 15px; justify-content: center;">
          <span style="color: #ff4444;">You: ${roundState.playerWins}</span>
          <span style="color: #cc44ff;">AI: ${roundState.enemyWins}</span>
        </div>
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
    const powerupIconsHTML = (bombs: number, blast: number, kick: boolean, throwAbility: boolean, speed: number) => `
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
          <span style="font-size: 16px;">👟</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${throwAbility ? 'rgba(76, 175, 80, 0.3)' : 'rgba(100,100,100,0.2)'}; border: 2px solid ${throwAbility ? '#4CAF50' : '#555'}; opacity: ${throwAbility ? '1' : '0.5'};" title="Throw">
          <span style="font-size: 16px;">✋</span>
        </div>
        <div style="width: 36px; height: 36px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0, 188, 212, 0.2); border: 2px solid #00BCD4; position: relative;" title="Speed">
          <span style="font-size: 16px;">🚀</span>
          <span style="font-size: 9px; color: #00BCD4; font-weight: bold;">${speed}</span>
        </div>
      </div>
    `

    playerUIDiv.innerHTML = `
      <div style="font-size: 12px; margin-bottom: 8px; color: ${settings.player1Color}; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px ${settings.player1Color}88;">Player 1</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">❤️</span>
        <span style="font-size: 14px; font-weight: bold;">${playerLives}/${difficultyConfig.playerStartingLives}</span>
      </div>
      ${healthBarHTML(playerLives, difficultyConfig.playerStartingLives)}
      ${powerupIconsHTML(maxBombs, blastRadius, hasKick, hasThrow, playerSpeed)}
    `
    
    if (gameMode === 'pvp') {
      opponentUIDiv.style.borderColor = `${settings.player2Color}44`
      opponentUIDiv.innerHTML = `
        <div style="font-size: 12px; margin-bottom: 8px; color: ${settings.player2Color}; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px ${settings.player2Color}88;">Player 2</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">❤️</span>
          <span style="font-size: 14px; font-weight: bold;">${player2Lives}/3</span>
        </div>
        ${healthBarHTML(player2Lives, 3, true)}
        ${powerupIconsHTML(player2MaxBombs, player2BlastRadius, player2HasKick, player2HasThrow, player2Speed)}
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
        
        // Restart button
        const restartBtn = document.createElement('button')
        restartBtn.innerHTML = '🔄 Play Again'
        restartBtn.style.fontSize = '18px'
        restartBtn.style.padding = '15px 35px'
        restartBtn.style.cursor = 'pointer'
        restartBtn.style.background = 'linear-gradient(180deg, #4CAF50 0%, #388E3C 100%)'
        restartBtn.style.color = 'white'
        restartBtn.style.border = '3px solid #2E7D32'
        restartBtn.style.borderRadius = '8px'
        restartBtn.style.fontFamily = "'Russo One', sans-serif"
        restartBtn.style.boxShadow = '0 4px 0 #1B5E20, 0 6px 10px rgba(0,0,0,0.3)'
        restartBtn.style.transition = 'all 0.2s ease'
        
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
          playerUIDiv.style.display = 'none'
          opponentUIDiv.style.display = 'none'
          startGame(gameMode)
        })
        buttonContainer.appendChild(restartBtn)
        
        // Menu button
        const menuBtn = document.createElement('button')
        menuBtn.innerHTML = '🏠 Main Menu'
        menuBtn.style.fontSize = '18px'
        menuBtn.style.padding = '15px 35px'
        menuBtn.style.cursor = 'pointer'
        menuBtn.style.background = 'linear-gradient(180deg, #f44336 0%, #c62828 100%)'
        menuBtn.style.color = 'white'
        menuBtn.style.border = '3px solid #b71c1c'
        menuBtn.style.borderRadius = '8px'
        menuBtn.style.fontFamily = "'Russo One', sans-serif"
        menuBtn.style.boxShadow = '0 4px 0 #7f0000, 0 6px 10px rgba(0,0,0,0.3)'
        menuBtn.style.transition = 'all 0.2s ease'
        
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
          playerUIDiv.style.display = 'none'
          opponentUIDiv.style.display = 'none'
          mainMenu.style.display = 'flex'
          
          if (currentEngine) {
            currentEngine.dispose()
            currentEngine = null
          }
          if (currentScene) {
            currentScene.dispose()
            currentScene = null
          }
          
          document.querySelectorAll('#app > div').forEach(el => {
            if (el.id !== 'main-menu' && el.id !== 'pause-menu') {
              el.remove()
            }
          })
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
  
  // Create a stylized bomb with fuse
  function createBombMesh() {
    // Main bomb body
    const bombBody = MeshBuilder.CreateSphere('bomb-body', { diameter: TILE_SIZE * 0.55 }, scene)
    
    // Create bomb material with gradient-like effect
    const bombMatDynamic = new StandardMaterial('bomb-mat-dynamic', scene)
    bombMatDynamic.diffuseColor = new Color3(0.15, 0.15, 0.15)
    bombMatDynamic.specularColor = new Color3(0.4, 0.4, 0.4)
    bombMatDynamic.specularPower = 32
    bombBody.material = bombMatDynamic
    
    // Fuse cylinder
    const fuse = MeshBuilder.CreateCylinder('fuse', { 
      height: TILE_SIZE * 0.2, 
      diameter: TILE_SIZE * 0.08 
    }, scene)
    fuse.position.y = TILE_SIZE * 0.32
    fuse.parent = bombBody
    
    const fuseMat = new StandardMaterial('fuse-mat', scene)
    fuseMat.diffuseColor = new Color3(0.6, 0.4, 0.2)
    fuseMat.specularColor = new Color3(0, 0, 0)
    fuse.material = fuseMat
    
    // Spark/flame on fuse tip (small sphere that glows)
    const spark = MeshBuilder.CreateSphere('spark', { diameter: TILE_SIZE * 0.12 }, scene)
    spark.position.y = TILE_SIZE * 0.42
    spark.parent = bombBody
    
    const sparkMat = new StandardMaterial('spark-mat', scene)
    sparkMat.emissiveColor = new Color3(1, 0.6, 0)
    sparkMat.diffuseColor = new Color3(1, 0.8, 0)
    sparkMat.specularColor = new Color3(0, 0, 0)
    spark.material = sparkMat
    
    // Add highlight ring for style
    const ring = MeshBuilder.CreateTorus('ring', { 
      diameter: TILE_SIZE * 0.3, 
      thickness: TILE_SIZE * 0.05 
    }, scene)
    ring.position.y = 0
    ring.rotation.x = Math.PI / 2
    ring.parent = bombBody
    
    const ringMat = new StandardMaterial('ring-mat', scene)
    ringMat.diffuseColor = new Color3(0.3, 0.3, 0.3)
    ringMat.specularColor = new Color3(0.5, 0.5, 0.5)
    ring.material = ringMat
    
    return bombBody
  }

  // Place bomb function (for player 1 or enemies)
  function placeBomb(x: number, y: number, ownerId: number = -1, ownerBlastRadius?: number) {
    // For player 1
    if (ownerId === -1 && currentBombs >= maxBombs) return
    
    // Check if there's already a bomb at this position
    if (bombs.some(b => b.x === x && b.y === y)) return

    const bombMesh = createBombMesh()
    bombMesh.position = gridToWorld(x, y)

    bombs.push({
      x,
      y,
      timer: 2200, // 2.2 seconds
      mesh: bombMesh,
      blastRadius: ownerBlastRadius !== undefined ? ownerBlastRadius : blastRadius,
      ownerId,
    })
    
    if (ownerId === -1) {
      currentBombs++
    }
    
    // Play sound and track stats
    if (soundManager) soundManager.playSFX('bomb-place')
    statsManager.recordBombPlaced()
    
    // Check bomber achievement
    if (achievementsManager.incrementProgress('bomber')) {
      showAchievementNotification(achievementsManager.getAchievement('bomber')!)
    }
  }

  // Create particle system for explosions
  function createExplosionParticles(x: number, y: number) {
    const particleSystem = new ParticleSystem('explosion', 50, scene)
    
    // Create a simple emitter point
    const emitter = MeshBuilder.CreateSphere('emitter', { diameter: 0.1 }, scene)
    emitter.position = gridToWorld(x, y)
    emitter.isVisible = false
    particleSystem.emitter = emitter

    try {
      particleSystem.particleTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
    } catch (e) {
      particleSystem.particleTexture = new Texture('', scene)
    }
    
    // More dramatic fire colors
    particleSystem.color1 = new Color4(1, 0.8, 0.2, 1)  // Bright yellow
    particleSystem.color2 = new Color4(1, 0.3, 0, 1)    // Orange-red
    particleSystem.colorDead = new Color4(0.3, 0.1, 0, 0)  // Fade to dark

    particleSystem.minSize = 0.15
    particleSystem.maxSize = 0.4

    particleSystem.minLifeTime = 0.15
    particleSystem.maxLifeTime = 0.35

    particleSystem.emitRate = 300
    particleSystem.blendMode = ParticleSystem.BLENDMODE_ADD

    particleSystem.gravity = new Vector3(0, 2, 0)  // Float up like fire

    particleSystem.direction1 = new Vector3(-1.5, 2, -1.5)
    particleSystem.direction2 = new Vector3(1.5, 3, 1.5)

    particleSystem.minEmitPower = 3
    particleSystem.maxEmitPower = 6

    particleSystem.updateSpeed = 0.008

    particleSystem.start()

    setTimeout(() => {
      particleSystem.stop()
      setTimeout(() => {
        particleSystem.dispose()
        emitter.dispose()
      }, 400)
    }, 150)
  }
  
  // Create smoke particles for after explosion
  function createSmokeParticles(x: number, y: number) {
    const smokeSystem = new ParticleSystem('smoke', 30, scene)
    
    const emitter = MeshBuilder.CreateSphere('smoke-emitter', { diameter: 0.1 }, scene)
    emitter.position = gridToWorld(x, y)
    emitter.isVisible = false
    smokeSystem.emitter = emitter
    
    try {
      smokeSystem.particleTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
    } catch (e) {
      smokeSystem.particleTexture = new Texture('', scene)
    }

    smokeSystem.color1 = new Color4(0.4, 0.4, 0.4, 0.6)
    smokeSystem.color2 = new Color4(0.2, 0.2, 0.2, 0.4)
    smokeSystem.colorDead = new Color4(0, 0, 0, 0)
    
    smokeSystem.minSize = 0.2
    smokeSystem.maxSize = 0.5
    
    smokeSystem.minLifeTime = 0.5
    smokeSystem.maxLifeTime = 1.0
    
    smokeSystem.emitRate = 50
    smokeSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD
    
    smokeSystem.gravity = new Vector3(0, 1, 0)
    smokeSystem.direction1 = new Vector3(-0.5, 1, -0.5)
    smokeSystem.direction2 = new Vector3(0.5, 2, 0.5)
    
    smokeSystem.minEmitPower = 0.5
    smokeSystem.maxEmitPower = 1
    
    smokeSystem.start()
    
    setTimeout(() => {
      smokeSystem.stop()
      setTimeout(() => {
        smokeSystem.dispose()
        emitter.dispose()
      }, 1000)
    }, 200)
  }

  // Explode bomb function
  function explodeBomb(bomb: Bomb) {
    // Screen shake and sound
    screenShake(0.4, 250)
    if (soundManager) soundManager.playSFX('explosion')
    
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

        // Stop if we hit a destructible block
        if (grid[y][x] === 'destructible') break
      }
    }

    // Create explosion visuals with animation
    const explosionMeshes: any[] = []
    for (const [x, y] of explosionTiles) {
      // Create a more dynamic explosion shape
      const explosion = MeshBuilder.CreateSphere('explosion', { diameter: TILE_SIZE * 0.8 }, scene)
      explosion.position = gridToWorld(x, y)
      
      // Create a glowing explosion material
      const expMat = new StandardMaterial('exp-mat-' + Math.random(), scene)
      expMat.emissiveColor = new Color3(1, 0.5, 0)
      expMat.diffuseColor = new Color3(1, 0.3, 0)
      expMat.specularColor = new Color3(0, 0, 0)
      expMat.alpha = 0.9
      explosion.material = expMat
      explosionMeshes.push(explosion)

      // Create fire particle effect
      createExplosionParticles(x, y)
      
      // Add smoke after fire
      setTimeout(() => createSmokeParticles(x, y), 100)

      // Animate explosion scale and fade
      const scaleAnim = new Animation('scaleAnim', 'scaling', 30, Animation.ANIMATIONTYPE_VECTOR3)
      scaleAnim.setKeys([
        { frame: 0, value: new Vector3(0.1, 0.1, 0.1) },
        { frame: 4, value: new Vector3(1.3, 1.3, 1.3) },
        { frame: 8, value: new Vector3(1.0, 1.0, 1.0) },
        { frame: 12, value: new Vector3(0.6, 0.6, 0.6) },
      ])
      explosion.animations.push(scaleAnim)
      
      // Fade out animation
      const fadeAnim = new Animation('fadeAnim', 'visibility', 30, Animation.ANIMATIONTYPE_FLOAT)
      fadeAnim.setKeys([
        { frame: 0, value: 1 },
        { frame: 8, value: 0.8 },
        { frame: 12, value: 0 },
      ])
      explosion.animations.push(fadeAnim)
      
      scene.beginAnimation(explosion, 0, 12, false)

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
          
          // Adjusted probabilities: more bombs/blast, less kick/throw
          if (rand < 0.35) {
            powerUpType = 'extraBomb'  // 35%
          } else if (rand < 0.65) {
            powerUpType = 'largerBlast'  // 30%
          } else if (rand < 0.75) {
            powerUpType = 'kick'  // 10%
          } else if (rand < 0.85) {
            powerUpType = 'throw'  // 10%
          } else {
            powerUpType = 'speed'  // 15%
          }
          
          // Create power-up with emoji on a plane
          const powerUpEmoji = powerUpType === 'extraBomb' ? '💣' :
                               powerUpType === 'largerBlast' ? '⚡' :
                               powerUpType === 'kick' ? '👟' :
                               powerUpType === 'throw' ? '✋' : '🚀'
          
          // Create emoji plane
          const pos = gridToWorld(x, y)
          const emojiPlane = MeshBuilder.CreatePlane('powerup-emoji', { 
            size: TILE_SIZE * 0.8  // Increased size from 0.6
          }, scene)
          emojiPlane.position.x = pos.x
          emojiPlane.position.y = TILE_SIZE * 0.5
          emojiPlane.position.z = pos.z
          emojiPlane.billboardMode = 7 // Always face camera
          
          // Create dynamic texture for emoji
          const dynamicTexture = new DynamicTexture('powerupTexture' + Math.random(), 256, scene, true)
          const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D
          
          // Solid black circle with white/glow ring for max contrast
          ctx.clearRect(0, 0, 256, 256)
          
          // Outer glow ring
          ctx.beginPath()
          ctx.arc(128, 128, 120, 0, Math.PI * 2)
          ctx.fillStyle = powerUpType === 'extraBomb' ? 'cyan' :
                          powerUpType === 'largerBlast' ? 'yellow' :
                          powerUpType === 'kick' ? 'orange' :
                          powerUpType === 'throw' ? 'pink' : 'cyan'
          ctx.fill()
          
          // Inner dark circle
          ctx.beginPath()
          ctx.arc(128, 128, 110, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(0,0,0,0.9)'
          ctx.fill()
          
          // Draw emoji on top
          ctx.font = 'bold 160px Arial'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = 'white'
          ctx.fillText(powerUpEmoji, 128, 138)
          dynamicTexture.update()
          
          // Create material with emoji texture
          const emojiMaterial = new StandardMaterial('emojiMat' + Math.random(), scene)
          emojiMaterial.diffuseTexture = dynamicTexture
          // High emissive for self-illumination
          emojiMaterial.emissiveColor = new Color3(0.8, 0.8, 0.8) 
          emojiMaterial.opacityTexture = dynamicTexture
          emojiMaterial.disableLighting = true
          emojiMaterial.backFaceCulling = false
          emojiPlane.material = emojiMaterial
          
          // Floating animation - Removed duplicate animation code
          const powerUpSphere = emojiPlane
          
          // Add bobbing animation
          let bobTime = Math.random() * Math.PI * 2
          scene.registerBeforeRender(() => {
            if (powerUpSphere && !powerUpSphere.isDisposed()) {
              bobTime += 0.05
              // Bob higher
              powerUpSphere.position.y = TILE_SIZE * 0.5 + Math.sin(bobTime) * 0.15
              // Remove rotation, it interacts weirdly with billboard mode sometimes
              // powerUpSphere.rotation.y += 0.02
            }
          })
          
          powerUps.push({ x, y, type: powerUpType, mesh: powerUpSphere })
        }
      }

      // Check if player is hit
      if (x === playerGridX && y === playerGridY && !playerInvulnerable) {
        playerLives--
        playerInvulnerable = true
        playerInvulnerableTimer = 2000 // 2 seconds invulnerability
        sessionDamageTaken++
        
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
                  const enemy: Enemy = {
                    x: spawn.x,
                    y: spawn.y,
                    mesh: enemyMesh,
                    moveTimer: Math.random() * 400,
                    lives: difficultyConfig.enemyStartingLives + Math.floor(survivalWave / 3), // Increase health every 3 waves
                    invulnerable: false,
                    invulnerableTimer: 0,
                  }
                  const enemyPos = gridToWorld(enemy.x, enemy.y)
                  enemy.mesh.position.x = enemyPos.x
                  enemy.mesh.position.y = TILE_SIZE * 0.5
                  enemy.mesh.position.z = enemyPos.z
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
        player2Lives--
        player2Invulnerable = true
        player2InvulnerableTimer = 2000
        
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
        }
        updateUI()
      }
    }

    // Remove explosion visuals after a short time
    setTimeout(() => {
      explosionMeshes.forEach(mesh => mesh.dispose())
    }, 300)

    // Chain reaction: explode other bombs
    bombs.forEach(otherBomb => {
      if (otherBomb !== bomb) {
        for (const [x, y] of explosionTiles) {
          if (otherBomb.x === x && otherBomb.y === y) {
            otherBomb.timer = 0
          }
        }
      }
    })
  }

  // Update bombs
  function updateBombs(deltaTime: number) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bomb = bombs[i]
      bomb.timer -= deltaTime

      // Bomb pulsing animation - gets faster and more intense as timer runs out
      const timeRatio = bomb.timer / 2000
      const pulseSpeed = 6 + (1 - timeRatio) * 20 // Speed up dramatically
      const pulseAmount = 0.08 + (1 - timeRatio) * 0.25 // Pulse more as time runs out
      const scale = 1 + Math.sin(Date.now() * pulseSpeed / 1000) * pulseAmount
      bomb.mesh.scaling = new Vector3(scale, scale, scale)
      
      // Make bomb glow red as timer runs out
      if (bomb.mesh.material) {
        if (timeRatio < 0.5) {
          const intensity = (0.5 - timeRatio) * 2 // 0 to 1 over last half
          bomb.mesh.material.emissiveColor = new Color3(intensity, intensity * 0.2, 0)
        }
      }
      
      // Find and animate the spark on the fuse
      const spark = bomb.mesh.getChildMeshes().find((m: any) => m.name === 'spark')
      if (spark && spark.material) {
        // Flicker the spark
        const flicker = 0.7 + Math.random() * 0.3
        spark.material.emissiveColor = new Color3(flicker, flicker * 0.5, 0)
        spark.scaling = new Vector3(
          0.8 + Math.random() * 0.4, 
          0.8 + Math.random() * 0.4, 
          0.8 + Math.random() * 0.4
        )
      }

      if (bomb.timer <= 0) {
        explodeBomb(bomb)
        // Dispose bomb and all children
        bomb.mesh.getChildMeshes().forEach((child: any) => child.dispose())
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
      player.visibility = Math.sin(Date.now() / 100) > 0 ? 0.5 : 1
      
      if (playerInvulnerableTimer <= 0) {
        playerInvulnerable = false
        player.visibility = 1
      }
    }

    // Player 2 (PvP mode)
    if (gameMode === 'pvp' && player2Invulnerable && player2) {
      player2InvulnerableTimer -= deltaTime
      player2.visibility = Math.sin(Date.now() / 100) > 0 ? 0.5 : 1
      
      if (player2InvulnerableTimer <= 0) {
        player2Invulnerable = false
        player2.visibility = 1
      }
    }

    // Enemies
    enemies.forEach(enemy => {
      if (enemy.invulnerable) {
        enemy.invulnerableTimer -= deltaTime
        enemy.mesh.visibility = Math.sin(Date.now() / 100) > 0 ? 0.5 : 1
        
        if (enemy.invulnerableTimer <= 0) {
          enemy.invulnerable = false
          enemy.mesh.visibility = 1
        }
      }
    })
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
        }
        powerUp.mesh.dispose()
        powerUps.splice(i, 1)
        updateUI()
        
        // Play sound and track stats
        if (soundManager) soundManager.playSFX('powerup')
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

    bombs.push({
      x,
      y,
      timer: 2200,
      mesh: bombMesh,
      blastRadius: player2BlastRadius,
      ownerId: -2,
    })
    player2CurrentBombs++
    
    // Play sound
    if (soundManager) soundManager.playSFX('bomb-place')
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

    // D-Pad
    const dpad = document.createElement('div')
    dpad.className = 'dpad'
    mobileContainer.appendChild(dpad)

    const createBtn = (cls: string, key: string) => {
      const btn = document.createElement('div')
      btn.className = `dpad-btn ${cls}`
      dpad.appendChild(btn)
      
      const start = (e: Event) => {
        if (e.cancelable) e.preventDefault()
        if (!keysHeld.has(key)) {
            keysHeld.add(key)
            keyPressTime.set(key, Date.now())
        }
        btn.classList.add('active')
      }
      const end = (e: Event) => {
        if (e.cancelable) e.preventDefault()
        keysHeld.delete(key)
        keyPressTime.delete(key)
        btn.classList.remove('active')
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

    const targetX = playerGridX + dx
    const targetY = playerGridY + dy

    if (targetX < 0 || targetY < 0 || targetX >= GRID_WIDTH || targetY >= GRID_HEIGHT) return false

    // Check if there's a bomb at the target position - kick it!
    const bombAtTarget = bombs.find(b => b.x === targetX && b.y === targetY)
    if (bombAtTarget) {
      if (hasKick) {
        kickBomb(dx, dy)
        lastMoveTime = currentTime
        return true
      }
      return false // Block movement if no kick ability
    }

    if (grid[targetY][targetX] === 'wall' || grid[targetY][targetX] === 'destructible') return false

    // Check collision with enemies (blocking)
    if (enemies.some(e => e.lives > 0 && e.x === targetX && e.y === targetY)) return false
    
    // Check collision with Player 2 (in PvP)
    if (gameMode === 'pvp' && targetX === player2GridX && targetY === player2GridY) return false

    playerGridX = targetX
    playerGridY = targetY
    const newPos = gridToWorld(playerGridX, playerGridY)
    player.position.x = newPos.x
    player.position.y = TILE_SIZE * 0.5
    player.position.z = newPos.z
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
    if (bombs.some(b => b.x === targetX && b.y === targetY) && !player2HasKick) return false

    if (grid[targetY][targetX] === 'wall' || grid[targetY][targetX] === 'destructible') return false

    // Check collision with enemies (blocking)
    if (enemies.some(e => e.lives > 0 && e.x === targetX && e.y === targetY)) return false
    
    // Check collision with Player 1
    if (targetX === playerGridX && targetY === playerGridY) return false

    player2GridX = targetX
    player2GridY = targetY
    const newPos2 = gridToWorld(player2GridX, player2GridY)
    player2.position.x = newPos2.x
    player2.position.y = TILE_SIZE * 0.5
    player2.position.z = newPos2.z
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
      } else {
        placeBomb(playerGridX, playerGridY)
      }
      return
    }
    
    if (ev.key === 'Enter' && gameMode === 'pvp') {
      const bombAtPlayer2 = bombs.find(b => b.x === player2GridX && b.y === player2GridY)
      if (bombAtPlayer2 && player2HasThrow) {
        throwBombPlayer2(lastPlayer2Dx, lastPlayer2Dy)
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

  function updateOffscreenIndicators() {
    // Collect all targets (enemies + player 2 if in PVP)
    const targets: { id: string, x: number, z: number, color: string, active: boolean }[] = []
    
    enemies.forEach((enemy, idx) => {
      if (enemy.lives > 0) {
        // Find the color used for this enemy or default to red
        const color = (idx < enemyColors.length) ? enemyColors[idx] : '#ff4444'
        const pos = gridToWorld(enemy.x, enemy.y)
        targets.push({ id: `enemy-${idx}`, x: pos.x, z: pos.z, color, active: true })
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

        // Project position to screen space
        const targetPos = new Vector3(target.x, TILE_SIZE/2, target.z)
        const screenPos = Vector3.Project(
            targetPos,
            Matrix.Identity(),
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
  scene.onBeforeRenderObservable.add(() => {
    const currentTime = Date.now()
    const deltaTime = currentTime - lastTime
    lastTime = currentTime

    if (!isPaused) {
      // Process held keys for smooth continuous movement
      processHeldKeys()
      
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
      updateEnemies(deltaTime)
      updateInvulnerability(deltaTime)
      
      // Update time attack
      if (gameMode === 'time-attack') {
        gameStateManager.updateTimeAttack(deltaTime)
        updateUI()
        
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
  if (currentEngine) {
    currentEngine.dispose()
  }
  if (currentScene) {
    currentScene.dispose()
  }

  currentEngine = new Engine(canvas, true)
  currentScene = createScene(currentEngine, mode)
  
  // IMMEDIATELY UNLOCK AUDIO on user interaction
  if (soundManager) {
      soundManager.resumeAudio()
  }
  
  // Start paused for countdown
  isPaused = true

  // Handle resize
  const resize = () => {
    currentEngine?.resize()
  }
  window.addEventListener('resize', resize)

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
  })
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
    
    // Clean up game
    if (currentEngine) {
      currentEngine.dispose()
      currentEngine = null
    }
    if (currentScene) {
      currentScene.dispose()
      currentScene = null
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
  soundManager,
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

// Add event listeners for all menu buttons
setTimeout(() => {
  const settingsButton = document.getElementById('settings-button')
  const statsButton = document.getElementById('stats-button')
  const achievementsButton = document.getElementById('achievements-button')
  const tutorialButton = document.getElementById('tutorial-button')
  const mapSelectionButton = document.getElementById('map-selection-button')
  
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      mainMenu.style.display = 'none'
      settingsMenu.style.display = 'flex'
    })
  }
  
  if (statsButton) {
    statsButton.addEventListener('click', () => {
      mainMenu.style.display = 'none'
      statsScreen.style.display = 'flex'
    })
  }
  
  if (achievementsButton) {
    achievementsButton.addEventListener('click', () => {
      // Refresh achievements before showing
      if ((achievementsScreen as any).refresh) {
        ;(achievementsScreen as any).refresh()
      }
      mainMenu.style.display = 'none'
      achievementsScreen.style.display = 'flex'
    })
  }
  
  if (tutorialButton) {
    tutorialButton.addEventListener('click', () => {
      mainMenu.style.display = 'none'
      tutorialScreen.style.display = 'flex'
    })
  }
  
  if (mapSelectionButton) {
    mapSelectionButton.addEventListener('click', () => {
      mainMenu.style.display = 'none'
      mapSelectionScreen.style.display = 'flex'
    })
  }
}, 100)
