import { Scene, ParticleSystem, Texture, Color4, Vector3, Animation, Mesh } from '@babylonjs/core'

import { FLARE_TEXTURE_DATA_URI } from './assets'

export function createConfettiEffect(scene: Scene, position: Vector3) {
  const particleSystem = new ParticleSystem('confetti', 200, scene)
  
  try {
    particleSystem.particleTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
  } catch {
    // Fallback if texture fails to load
  }

  particleSystem.emitter = position
  particleSystem.minEmitBox = new Vector3(-2, 0, -2)
  particleSystem.maxEmitBox = new Vector3(2, 0, 2)

  particleSystem.color1 = new Color4(1, 0, 0, 1)
  particleSystem.color2 = new Color4(0, 1, 0, 1)
  particleSystem.colorDead = new Color4(0, 0, 1, 0)

  particleSystem.minSize = 0.1
  particleSystem.maxSize = 0.3

  particleSystem.minLifeTime = 1
  particleSystem.maxLifeTime = 2

  particleSystem.emitRate = 100
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE

  particleSystem.gravity = new Vector3(0, -5, 0)

  particleSystem.direction1 = new Vector3(-2, 8, -2)
  particleSystem.direction2 = new Vector3(2, 8, 2)

  particleSystem.minAngularSpeed = 0
  particleSystem.maxAngularSpeed = Math.PI

  particleSystem.minEmitPower = 3
  particleSystem.maxEmitPower = 5
  particleSystem.updateSpeed = 0.01

  particleSystem.start()

  setTimeout(() => {
    particleSystem.stop()
    setTimeout(() => particleSystem.dispose(), 2000)
  }, 1000)
}

export function createBlockDestructionAnimation(mesh: Mesh, onComplete: () => void) {
  // Crumble and fade animation
  const fadeAnimation = new Animation(
    'fadeOut',
    'visibility',
    30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )

  const scaleAnimation = new Animation(
    'scaleDown',
    'scaling',
    30,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )

  const rotateAnimation = new Animation(
    'rotate',
    'rotation.y',
    30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )

  fadeAnimation.setKeys([
    { frame: 0, value: 1 },
    { frame: 15, value: 0 }
  ])

  scaleAnimation.setKeys([
    { frame: 0, value: mesh.scaling.clone() },
    { frame: 15, value: new Vector3(0.1, 0.1, 0.1) }
  ])

  rotateAnimation.setKeys([
    { frame: 0, value: 0 },
    { frame: 15, value: Math.PI * 2 }
  ])

  mesh.animations = [fadeAnimation, scaleAnimation, rotateAnimation]
  
  mesh.getScene().beginAnimation(mesh, 0, 15, false, 2, onComplete)
}

export function createPlayerDeathAnimation(mesh: Mesh, onComplete: () => void) {
  // Fade out and scale down
  const fadeAnimation = new Animation(
    'fadeOut',
    'visibility',
    30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )

  const scaleAnimation = new Animation(
    'scaleDown',
    'scaling',
    30,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  )

  fadeAnimation.setKeys([
    { frame: 0, value: 1 },
    { frame: 20, value: 0 }
  ])

  scaleAnimation.setKeys([
    { frame: 0, value: mesh.scaling.clone() },
    { frame: 20, value: new Vector3(0, 0, 0) }
  ])

  mesh.animations = [fadeAnimation, scaleAnimation]
  
  mesh.getScene().beginAnimation(mesh, 0, 20, false, 2, onComplete)
}

export function createPowerUpSparkle(scene: Scene, position: Vector3) {
  const particleSystem = new ParticleSystem('sparkle', 20, scene)
  
  try {
    particleSystem.particleTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
  } catch {
    // Fallback if texture fails to load
  }

  particleSystem.emitter = position
  particleSystem.minEmitBox = new Vector3(-0.2, -0.2, -0.2)
  particleSystem.maxEmitBox = new Vector3(0.2, 0.2, 0.2)

  particleSystem.color1 = new Color4(1, 1, 0, 1)
  particleSystem.color2 = new Color4(1, 0.8, 0, 1)
  particleSystem.colorDead = new Color4(1, 1, 1, 0)

  particleSystem.minSize = 0.05
  particleSystem.maxSize = 0.15

  particleSystem.minLifeTime = 0.3
  particleSystem.maxLifeTime = 0.6

  particleSystem.emitRate = 30
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE

  particleSystem.gravity = new Vector3(0, 1, 0)

  particleSystem.direction1 = new Vector3(-0.5, 0.5, -0.5)
  particleSystem.direction2 = new Vector3(0.5, 1, 0.5)

  particleSystem.minEmitPower = 0.5
  particleSystem.maxEmitPower = 1
  particleSystem.updateSpeed = 0.01

  particleSystem.start()

  return particleSystem
}

export function showScorePopup(text: string, _position: Vector3, _scene: Scene) {
  // Create a simple text popup that floats up and fades
  // This would need a more complex implementation with dynamic textures
  // For now, we'll use DOM elements
  const popup = document.createElement('div')
  popup.textContent = text
  popup.style.position = 'fixed'
  popup.style.color = '#ffd700'
  popup.style.fontSize = '24px'
  popup.style.fontWeight = 'bold'
  popup.style.textShadow = '2px 2px 4px black'
  popup.style.pointerEvents = 'none'
  popup.style.zIndex = '1000'
  popup.style.fontFamily = 'Arial, sans-serif'
  
  // Convert 3D position to screen coordinates (simplified)
  popup.style.left = '50%'
  popup.style.top = '40%'
  popup.style.transform = 'translate(-50%, -50%)'
  
  document.body.appendChild(popup)
  
  // Animate up and fade
  let opacity = 1
  let yOffset = 0
  const interval = setInterval(() => {
    opacity -= 0.02
    yOffset -= 2
    popup.style.opacity = opacity.toString()
    popup.style.transform = `translate(-50%, calc(-50% + ${yOffset}px))`
    
    if (opacity <= 0) {
      clearInterval(interval)
      popup.remove()
    }
  }, 16)
}

export function showHitIndicator(position: Vector3, scene: Scene, isPlayer: boolean = true) {
  // Create a red flash particle effect at hit location
  const particleSystem = new ParticleSystem('hit', 50, scene)
  
  try {
    particleSystem.particleTexture = new Texture(FLARE_TEXTURE_DATA_URI, scene)
  } catch {
    // Fallback if texture fails to load
  }

  particleSystem.emitter = position
  particleSystem.minEmitBox = new Vector3(-0.3, 0, -0.3)
  particleSystem.maxEmitBox = new Vector3(0.3, 0.5, 0.3)

  // Red/orange colors for damage
  particleSystem.color1 = new Color4(1, 0, 0, 1)
  particleSystem.color2 = new Color4(1, 0.3, 0, 1)
  particleSystem.colorDead = new Color4(0.5, 0, 0, 0)

  particleSystem.minSize = 0.1
  particleSystem.maxSize = 0.3

  particleSystem.minLifeTime = 0.3
  particleSystem.maxLifeTime = 0.6

  particleSystem.emitRate = 100
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE

  particleSystem.gravity = new Vector3(0, -2, 0)

  particleSystem.direction1 = new Vector3(-1, 2, -1)
  particleSystem.direction2 = new Vector3(1, 3, 1)

  particleSystem.minEmitPower = 2
  particleSystem.maxEmitPower = 4
  particleSystem.updateSpeed = 0.01

  particleSystem.start()

  // Show damage text
  const damageText = document.createElement('div')
  damageText.textContent = isPlayer ? '-1 LIFE!' : 'HIT!'
  damageText.style.position = 'fixed'
  damageText.style.color = '#ff0000'
  damageText.style.fontSize = '32px'
  damageText.style.fontWeight = 'bold'
  damageText.style.textShadow = '3px 3px 6px black'
  damageText.style.pointerEvents = 'none'
  damageText.style.zIndex = '1500'
  damageText.style.fontFamily = 'Arial, sans-serif'
  damageText.style.left = '50%'
  damageText.style.top = '30%'
  damageText.style.transform = 'translate(-50%, -50%)'
  
  document.body.appendChild(damageText)
  
  // Animate and remove
  let opacity = 1
  let scale = 1
  const interval = setInterval(() => {
    opacity -= 0.03
    scale += 0.05
    damageText.style.opacity = opacity.toString()
    damageText.style.transform = `translate(-50%, -50%) scale(${scale})`
    
    if (opacity <= 0) {
      clearInterval(interval)
      damageText.remove()
    }
  }, 16)

  setTimeout(() => {
    particleSystem.stop()
    setTimeout(() => particleSystem.dispose(), 600)
  }, 300)
}
