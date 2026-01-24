import { Scene, Sound, Engine } from '@babylonjs/core'

export class SoundManager {
  private sounds: Map<string, Sound> = new Map()
  private scene: Scene
  private musicVolume: number = 0.5
  private sfxVolume: number = 0.7
  private currentMusic: Sound | null = null

  constructor(scene: Scene) {
    this.scene = scene
  }

  // Allow unlocking audio context manually
  resumeAudio() {
    if (Engine.audioEngine) {
      Engine.audioEngine.unlock()
      if (Engine.audioEngine.audioContext && Engine.audioEngine.audioContext.state === 'suspended') {
        Engine.audioEngine.audioContext.resume()
      }
      console.log('Audio Context State:', Engine.audioEngine.audioContext?.state)
    }
  }

  // Load a sound
  loadSound(name: string, url: string, options: any = {}) {
    const sound = new Sound(
      name,
      url,
      this.scene,
      null,
      {
        loop: options.loop || false,
        autoplay: false,
        volume: options.isMusic ? this.musicVolume : this.sfxVolume,
        ...options
      }
    )
    this.sounds.set(name, sound)
  }

  // Play a sound effect
  playSFX(name: string) {
    const sound = this.sounds.get(name)
    if (sound && !sound.isPlaying) {
      sound.play()
    }
  }

  // Play background music
  playMusic(name: string) {
    // Stop current music
    if (this.currentMusic && this.currentMusic.isPlaying) {
      this.currentMusic.stop()
    }

    const music = this.sounds.get(name)
    if (music) {
      this.currentMusic = music
      music.play()
    }
  }

  // Stop music
  stopMusic() {
    if (this.currentMusic && this.currentMusic.isPlaying) {
      this.currentMusic.stop()
    }
  }

  // Set volumes
  setMusicVolume(volume: number) {
    this.musicVolume = Math.max(0, Math.min(1, volume))
    if (this.currentMusic) {
      this.currentMusic.setVolume(this.musicVolume)
    }
  }

  setSFXVolume(volume: number) {
    this.sfxVolume = Math.max(0, Math.min(1, volume))
    this.sounds.forEach((sound) => {
      if (sound !== this.currentMusic) {
        sound.setVolume(this.sfxVolume)
      }
    })
  }

  // Create simple beep sounds programmatically (placeholder until real sounds added)
  createPlaceholderSounds() {
    try {
      // Use Babylon's Audio Context
      const audioContext = Engine.audioEngine?.audioContext
      if (!audioContext) {
        console.warn("AudioContext not available from Babylon Engine")
        // Try creating a dummy sound to force init
        new Sound("init", "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", this.scene)
      }
      
      const context = Engine.audioEngine?.audioContext || new (window.AudioContext || (window as any).webkitAudioContext)()
      
      const createBuffer = (duration: number, fn: (t: number, i: number) => number) => {
        const sampleRate = context.sampleRate
        const buffer = context.createBuffer(1, duration * sampleRate, sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < data.length; i++) {
          data[i] = fn(i / sampleRate, i)
        }
        return buffer
      }

      // Bomb Place: High blip
      const bombPlaceBuffer = createBuffer(0.1, (t) => Math.sin(2 * Math.PI * 800 * t) * Math.exp(-10 * t))
      this.sounds.set('bomb-place', new Sound('bomb-place', bombPlaceBuffer, this.scene, null, { volume: 0.5 }))

      // Explosion: Noise decay
      const explosionBuffer = createBuffer(0.5, (t) => (Math.random() * 2 - 1) * Math.exp(-5 * t))
      this.sounds.set('explosion', new Sound('explosion', explosionBuffer, this.scene, null, { volume: 0.6 }))

      // Powerup: Ascending slide
      const powerupBuffer = createBuffer(0.3, (t) => Math.sin(2 * Math.PI * (400 + 1000 * t) * t) * 0.5)
      this.sounds.set('powerup', new Sound('powerup', powerupBuffer, this.scene, null, { volume: 0.5 }))

      // Victory: Major Chord
      const victoryBuffer = createBuffer(1.5, (t) => {
        const n = (freq: number) => Math.sin(2 * Math.PI * freq * t)
        const env = Math.exp(-2 * t)
        return (n(440) + n(554) + n(659)) * 0.3 * env // A Major
      })
      this.sounds.set('victory', new Sound('victory', victoryBuffer, this.scene, null, { volume: 0.7 }))

       // Defeat: Descending slide
      const defeatBuffer = createBuffer(1.0, (t) => Math.sin(2 * Math.PI * (400 - 300 * t) * t) * 0.5 * Math.exp(-1 * t))
      this.sounds.set('defeat', new Sound('defeat', defeatBuffer, this.scene, null, { volume: 0.7 }))

      // Game Start: Ready-Go Whistle
      const startBuffer = createBuffer(1.0, (t) => {
        if (t < 0.2) return Math.sin(2 * Math.PI * 440 * t) * 0.5 // Ready (A4)
        if (t < 0.4) return 0 // Silence
        if (t < 0.6) return Math.sin(2 * Math.PI * 440 * t) * 0.5 // Set (A4)
        if (t < 0.8) return 0 // Silence
        return Math.sin(2 * Math.PI * 880 * t) * 0.5 * Math.exp(-(t-0.8)*5) // GO! (A5)
      })
      this.sounds.set('game-start', new Sound('game-start', startBuffer, this.scene, null, { volume: 0.7 }))

      // BGM: Simple Loop directly in buffer
      // 120 BPM = 0.5s per beat. 4 bars of 4/4 = 16 beats = 8 seconds loop
      const bgmBuffer = createBuffer(8.0, (t) => {
        const beatLen = 0.5
        const beat = Math.floor(t / beatLen)
        const localT = t % beatLen
        
        let output = 0
        
        // Base Line (Square waveish)
        const bassFreq = [110, 110, 110, 110, 82, 82, 98, 98, 110, 110, 110, 110, 146, 146, 130, 130][beat % 16] // A A A A E E G G ...
        output += (Math.sin(2 * Math.PI * bassFreq * t) > 0 ? 0.2 : -0.2) * Math.exp(-localT * 3)
        
        // Kick Drum (every beat)
        output += Math.sin(2 * Math.PI * (150 * Math.exp(-localT * 20)) * localT) * 0.8 * Math.exp(-localT * 10)
        
        // Hi-hat (every off beat)
        if (beat % 2 === 1) {
            output += (Math.random() * 0.5) * Math.exp(-localT * 20)
        }
        
        return output * 0.4
      })
      this.sounds.set('bgm', new Sound('bgm', bgmBuffer, this.scene, null, { 
        loop: true, 
        autoplay: false, 
        volume: this.musicVolume 
      }))

    } catch (e) {
      console.warn('Could not generate placeholder sounds', e)
    }
  }
}
