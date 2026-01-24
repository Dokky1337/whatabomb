import { Scene, Texture, StandardMaterial, Color3, MeshBuilder } from '@babylonjs/core'

export interface SpriteFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface SpriteAnimation {
  frames: SpriteFrame[]
  frameRate: number
  loop: boolean
}

export class AnimatedSprite {
  private plane: any
  private material: StandardMaterial
  private texture: Texture
  private animations: Map<string, SpriteAnimation>
  private currentAnimation: string | null = null
  private currentFrame: number = 0
  private frameTimer: number = 0
  private spriteSheetWidth: number
  private spriteSheetHeight: number

  constructor(
    name: string,
    texturePath: string,
    spriteSheetWidth: number,
    spriteSheetHeight: number,
    size: number,
    scene: Scene
  ) {
    this.spriteSheetWidth = spriteSheetWidth
    this.spriteSheetHeight = spriteSheetHeight
    this.animations = new Map()

    // Create plane for sprite
    this.plane = MeshBuilder.CreatePlane(name, { size }, scene)
    this.plane.billboardMode = 7 // Always face camera

    // Create texture and material
    this.texture = new Texture(texturePath, scene)
    this.material = new StandardMaterial(name + '-mat', scene)
    this.material.diffuseTexture = this.texture
    this.material.emissiveTexture = this.texture
    this.material.emissiveColor = new Color3(0.5, 0.5, 0.5)
    this.material.backFaceCulling = false
    this.material.specularColor = new Color3(0, 0, 0)
    this.material.useAlphaFromDiffuseTexture = true
    
    this.plane.material = this.material
  }

  addAnimation(name: string, animation: SpriteAnimation) {
    this.animations.set(name, animation)
  }

  playAnimation(name: string) {
    if (this.currentAnimation !== name) {
      this.currentAnimation = name
      this.currentFrame = 0
      this.frameTimer = 0
      this.updateFrame()
    }
  }

  update(deltaTime: number) {
    if (!this.currentAnimation) return

    const animation = this.animations.get(this.currentAnimation)
    if (!animation) return

    this.frameTimer += deltaTime
    const frameDuration = 1000 / animation.frameRate

    if (this.frameTimer >= frameDuration) {
      this.frameTimer = 0
      this.currentFrame++

      if (this.currentFrame >= animation.frames.length) {
        if (animation.loop) {
          this.currentFrame = 0
        } else {
          this.currentFrame = animation.frames.length - 1
        }
      }

      this.updateFrame()
    }
  }

  private updateFrame() {
    if (!this.currentAnimation) return

    const animation = this.animations.get(this.currentAnimation)
    if (!animation) return

    const frame = animation.frames[this.currentFrame]
    
    // Update UV coordinates to show the correct frame
    const uOffset = frame.x / this.spriteSheetWidth
    const vOffset = 1 - (frame.y + frame.height) / this.spriteSheetHeight
    const uScale = frame.width / this.spriteSheetWidth
    const vScale = frame.height / this.spriteSheetHeight

    if (this.texture) {
      this.texture.uOffset = uOffset
      this.texture.vOffset = vOffset
      this.texture.uScale = uScale
      this.texture.vScale = vScale
    }
  }

  getMesh() {
    return this.plane
  }

  get position() {
    return this.plane.position
  }

  set visibility(value: number) {
    this.plane.visibility = value
  }

  dispose() {
    this.plane.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}
